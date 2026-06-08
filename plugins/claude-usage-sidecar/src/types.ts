export type SidecarConfig = {
  homeDir: string
  claudeDir: string
  projectsDir: string
  cacheDir: string
  checkpointsDir: string
  snapshotsDir: string
  indexFile: string
  usageCacheFile: string
  pollMs: number
}

export type TodoStatus = "pending" | "in_progress" | "completed"

export type TodoItem = {
  content: string
  status: TodoStatus
}

export type TodoOperation = "add" | "update" | "remove"

export type ToolCounter = {
  calls: number
  completed: number
  errors: number
  running: number
}

export type SessionAgentState = {
  id: string
  type: string
  description?: string
  status: "running" | "completed" | "error"
  startTime: string
  endTime?: string
}

export type SessionTodoState = {
  total: number
  completed: number
  inProgress: number
  items: TodoItem[]
}

export type SessionUsageState = {
  available: boolean
}

export type SessionLimitations = {
  perToolTokens: "unavailable"
  perSkillTokens: "unavailable"
}

export type SessionSnapshot = {
  sessionId: string
  startedAt: string | null
  lastActivityAt: string | null
  sourceFiles: string[]
  tools: Record<string, ToolCounter>
  skills: Record<string, ToolCounter>
  agents: SessionAgentState[]
  todos: SessionTodoState
  usage: SessionUsageState
  limitations: SessionLimitations
}

export type SessionRuntimeState = SessionSnapshot & {
  openToolCalls: Record<
    string,
    {
      toolName: string
      startedAt: string
      skillName?: string
    }
  >
}

export type NormalizedEvent =
  | {
      sessionId: string
      timestamp: string
      eventType: "tool-start"
      toolCallId: string
      toolName: string
      input: Record<string, unknown>
    }
  | {
      sessionId: string
      timestamp: string
      eventType: "tool-end"
      toolCallId: string
      status: "completed" | "error"
    }
  | {
      sessionId: string
      timestamp: string
      eventType: "todo-replace"
      todos: TodoItem[]
    }
  | {
      sessionId: string
      timestamp: string
      eventType: "todo-update"
      operation: "remove"
      targetContent: string
    }
  | {
      sessionId: string
      timestamp: string
      eventType: "todo-update"
      operation: Exclude<TodoOperation, "remove">
      todo: TodoItem
    }
  | {
      sessionId: string
      timestamp: string
      eventType: "hook-success"
      hookEventName?: string
      attachment: Record<string, unknown>
    }
  | {
      sessionId: string
      timestamp: string
      eventType: "hook-additional-context"
      attachment: Record<string, unknown>
    }
  | {
      sessionId: string
      timestamp: string
      eventType: "skill-listing"
      skills: string[]
      attachment: Record<string, unknown>
    }
