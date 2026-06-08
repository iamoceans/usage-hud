import type {
  NormalizedEvent,
  SessionAgentState,
  SessionRuntimeState,
  SessionSnapshot,
  SessionTodoState,
  TodoItem,
  ToolCounter,
} from "./types.js"

const createCounter = (): ToolCounter => ({
  calls: 0,
  completed: 0,
  errors: 0,
  running: 0,
})

const cloneCounterMap = (
  counters: Record<string, ToolCounter>,
): Record<string, ToolCounter> =>
  Object.fromEntries(
    Object.entries(counters).map(([key, value]) => [
      key,
      {
        calls: value.calls,
        completed: value.completed,
        errors: value.errors,
        running: value.running,
      },
    ]),
  )

const cloneTodoItem = (todo: TodoItem): TodoItem => ({
  content: todo.content,
  status: todo.status,
})

const cloneTodoState = (todos: SessionTodoState): SessionTodoState => ({
  total: todos.total,
  completed: todos.completed,
  inProgress: todos.inProgress,
  items: todos.items.map(cloneTodoItem),
})

const cloneAgent = (agent: SessionAgentState): SessionAgentState => ({
  id: agent.id,
  type: agent.type,
  description: agent.description,
  status: agent.status,
  startTime: agent.startTime,
  endTime: agent.endTime,
})

const cloneState = (state: SessionRuntimeState): SessionRuntimeState => ({
  sessionId: state.sessionId,
  startedAt: state.startedAt,
  lastActivityAt: state.lastActivityAt,
  sourceFiles: [...state.sourceFiles],
  tools: cloneCounterMap(state.tools),
  skills: cloneCounterMap(state.skills),
  agents: state.agents.map(cloneAgent),
  todos: cloneTodoState(state.todos),
  usage: { available: state.usage.available },
  limitations: {
    perToolTokens: state.limitations.perToolTokens,
    perSkillTokens: state.limitations.perSkillTokens,
  },
  openToolCalls: Object.fromEntries(
    Object.entries(state.openToolCalls).map(([key, value]) => [
      key,
      {
        toolName: value.toolName,
        startedAt: value.startedAt,
        skillName: value.skillName,
      },
    ]),
  ),
})

const ensureCounter = (
  counters: Record<string, ToolCounter>,
  key: string,
): ToolCounter => {
  const existing = counters[key]

  if (existing !== undefined) {
    return existing
  }

  const created = createCounter()
  counters[key] = created
  return created
}

const recountTodos = (items: TodoItem[]): SessionTodoState => ({
  total: items.length,
  completed: items.filter((todo) => todo.status === "completed").length,
  inProgress: items.filter((todo) => todo.status === "in_progress").length,
  items,
})

const applyTodoUpdate = (
  current: TodoItem[],
  event: Extract<NormalizedEvent, { eventType: "todo-update" }>,
): TodoItem[] => {
  if (event.operation === "remove") {
    const indexToRemove = current.findIndex(
      (todo) => todo.content === event.targetContent,
    )

    if (indexToRemove < 0) {
      return current
    }

    return current.filter((_, index) => index !== indexToRemove)
  }

  const nextTodo = cloneTodoItem(event.todo)
  const existingIndex = current.findIndex(
    (todo) => todo.content === nextTodo.content,
  )

  if (existingIndex >= 0) {
    return current.map((todo, index) => (index === existingIndex ? nextTodo : todo))
  }

  return [...current, nextTodo]
}

const readSkillName = (
  event: Extract<NormalizedEvent, { eventType: "tool-start" }>,
): string | null =>
  event.toolName === "Skill" && typeof event.input.name === "string"
    ? event.input.name
    : null

export const createEmptySessionState = (
  sessionId: string,
): SessionRuntimeState => ({
  sessionId,
  startedAt: null,
  lastActivityAt: null,
  sourceFiles: [],
  tools: {},
  skills: {},
  agents: [],
  todos: {
    total: 0,
    completed: 0,
    inProgress: 0,
    items: [],
  },
  usage: { available: false },
  limitations: {
    perToolTokens: "unavailable",
    perSkillTokens: "unavailable",
  },
  openToolCalls: {},
})

export const reduceSessionEvents = (
  snapshot: SessionRuntimeState,
  events: NormalizedEvent[],
): SessionRuntimeState => {
  const next = cloneState(snapshot)

  for (const event of events) {
    if (event.sessionId !== next.sessionId) {
      continue
    }

    if (next.startedAt === null) {
      next.startedAt = event.timestamp
    }

    next.lastActivityAt = event.timestamp

    if (
      typeof event.sourceFile === "string" &&
      event.sourceFile.length > 0 &&
      !next.sourceFiles.includes(event.sourceFile)
    ) {
      next.sourceFiles = [...next.sourceFiles, event.sourceFile]
    }

    if (event.eventType === "tool-start") {
      const toolCounter = ensureCounter(next.tools, event.toolName)
      toolCounter.calls += 1
      toolCounter.running += 1

      const skillName = readSkillName(event)

      if (skillName !== null) {
        const skillCounter = ensureCounter(next.skills, skillName)
        skillCounter.calls += 1
        skillCounter.running += 1
      }

      next.openToolCalls[event.toolCallId] = {
        toolName: event.toolName,
        startedAt: event.timestamp,
        ...(skillName !== null ? { skillName } : {}),
      }

      if (event.toolName === "Task") {
        next.agents = [
          ...next.agents,
          {
            id: event.toolCallId,
            type:
              typeof event.input.subagent_type === "string"
                ? event.input.subagent_type
                : "unknown",
            description:
              typeof event.input.description === "string"
                ? event.input.description
                : undefined,
            status: "running",
            startTime: event.timestamp,
          },
        ]
      }

      continue
    }

    if (event.eventType === "tool-end") {
      const activeCall = next.openToolCalls[event.toolCallId]

      if (activeCall !== undefined) {
        const toolCounter = ensureCounter(next.tools, activeCall.toolName)
        toolCounter.running = Math.max(0, toolCounter.running - 1)

        if (event.status === "completed") {
          toolCounter.completed += 1
        } else {
          toolCounter.errors += 1
        }

        if (activeCall.skillName !== undefined) {
          const skillCounter = ensureCounter(next.skills, activeCall.skillName)
          skillCounter.running = Math.max(0, skillCounter.running - 1)

          if (event.status === "completed") {
            skillCounter.completed += 1
          } else {
            skillCounter.errors += 1
          }
        }

        delete next.openToolCalls[event.toolCallId]
      }

      next.agents = next.agents.map((agent) =>
        agent.id === event.toolCallId
          ? {
              ...agent,
              status: event.status,
              endTime: event.timestamp,
            }
          : agent,
      )

      continue
    }

    if (event.eventType === "todo-replace") {
      next.todos = recountTodos(event.todos.map(cloneTodoItem))
      continue
    }

    if (event.eventType === "todo-update") {
      next.todos = recountTodos(applyTodoUpdate(next.todos.items, event))
    }
  }

  return next
}

export const toPersistedSessionSnapshot = (
  state: SessionRuntimeState,
): SessionSnapshot => ({
  sessionId: state.sessionId,
  startedAt: state.startedAt,
  lastActivityAt: state.lastActivityAt,
  sourceFiles: [...state.sourceFiles],
  tools: cloneCounterMap(state.tools),
  skills: cloneCounterMap(state.skills),
  agents: state.agents.map(cloneAgent),
  todos: cloneTodoState(state.todos),
  usage: { available: state.usage.available },
  limitations: {
    perToolTokens: state.limitations.perToolTokens,
    perSkillTokens: state.limitations.perSkillTokens,
  },
})
