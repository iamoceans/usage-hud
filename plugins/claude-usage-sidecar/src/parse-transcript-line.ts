import type {
  NormalizedEvent,
  TodoItem,
  TodoOperation,
  TodoStatus,
} from "./types.js"

type JsonObject = Record<string, unknown>
type ParseTranscriptLineDebugContext = {
  line: string
  error?: unknown
}

type ParseTranscriptLineOptions = {
  debug?: (message: string, context?: ParseTranscriptLineDebugContext) => void
  logger?: {
    debug?: (message: string, context?: ParseTranscriptLineDebugContext) => void
  }
}

const isRecord = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const getNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null
  }

  return value.trim().length > 0 ? value : null
}

const normalizeTodoStatus = (status: unknown): TodoStatus => {
  if (status === "completed" || status === "done" || status === "complete") {
    return "completed"
  }

  if (status === "in_progress" || status === "running") {
    return "in_progress"
  }

  return "pending"
}

const normalizeTodoItem = (value: unknown): TodoItem | null => {
  if (!isRecord(value)) {
    return null
  }

  const content = getNonEmptyString(value.content)

  if (content === null) {
    return null
  }

  return {
    content,
    status: normalizeTodoStatus(value.status),
  }
}

const toInputRecord = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) {
    return {}
  }

  return value
}

const getDebug = (
  options: ParseTranscriptLineOptions | undefined,
): ((message: string, context?: ParseTranscriptLineDebugContext) => void) | undefined =>
  options?.debug ?? options?.logger?.debug

const debugSkip = (
  debug: ((message: string, context?: ParseTranscriptLineDebugContext) => void) | undefined,
  message: string,
  line: string,
): void => {
  debug?.(message, { line })
}

const readTodoOperation = (value: unknown): TodoOperation | null => {
  if (value === "add" || value === "update" || value === "remove") {
    return value
  }

  return null
}

const readTodoTargetContent = (block: JsonObject): string | null => {
  const directContent = getNonEmptyString(block.content)

  if (directContent !== null) {
    return directContent
  }

  const todoValue = block.todo ?? block.task

  if (!isRecord(todoValue)) {
    return null
  }

  return getNonEmptyString(todoValue.content)
}

const parseIncrementalTodoEvent = (
  sessionId: string,
  timestamp: string,
  block: JsonObject,
): NormalizedEvent | null => {
  if (block.type !== "todo_update" && block.type !== "task_update") {
    return null
  }

  const operation = readTodoOperation(block.operation ?? block.op ?? block.action)

  if (operation === null) {
    return null
  }

  if (operation === "remove") {
    const targetContent = readTodoTargetContent(block)

    if (targetContent === null) {
      return null
    }

    return {
      sessionId,
      timestamp,
      eventType: "todo-update",
      operation,
      targetContent,
    }
  }

  const todo = normalizeTodoItem(block.todo ?? block.task)

  if (todo === null) {
    return null
  }

  return {
    sessionId,
    timestamp,
    eventType: "todo-update",
    operation,
    todo,
  }
}

const parseAttachmentEvent = (
  sessionId: string,
  timestamp: string,
  attachment: unknown,
): NormalizedEvent | null => {
  if (!isRecord(attachment)) {
    return null
  }

  if (attachment.type === "hook_success") {
    return {
      sessionId,
      timestamp,
      eventType: "hook-success",
      hookEventName:
        getNonEmptyString(attachment.hook_event_name) ?? getNonEmptyString(attachment.hookEventName) ?? undefined,
      attachment,
    }
  }

  if (attachment.type === "hook_additional_context") {
    return {
      sessionId,
      timestamp,
      eventType: "hook-additional-context",
      attachment,
    }
  }

  if (attachment.type === "skill_listing") {
    const skills = Array.isArray(attachment.skills)
      ? attachment.skills
          .map((skill) => getNonEmptyString(skill))
          .filter((skill): skill is string => skill !== null)
      : []

    return {
      sessionId,
      timestamp,
      eventType: "skill-listing",
      skills,
      attachment,
    }
  }

  return null
}

export const parseTranscriptLine = (
  line: string,
  options?: ParseTranscriptLineOptions,
): NormalizedEvent[] => {
  let entry: unknown
  const debug = getDebug(options)

  try {
    entry = JSON.parse(line)
  } catch (error) {
    debug?.("Failed to parse transcript line", { line, error })
    return []
  }

  if (!isRecord(entry)) {
    debugSkip(debug, "Skipped transcript line because parsed JSON is not an object", line)
    return []
  }

  const sessionId = getNonEmptyString(entry.sessionId)
  const timestamp = getNonEmptyString(entry.timestamp)

  if (sessionId === null) {
    debugSkip(debug, "Skipped transcript line because sessionId is missing or blank", line)
    return []
  }

  if (timestamp === null) {
    debugSkip(debug, "Skipped transcript line because timestamp is missing or blank", line)
    return []
  }

  const message = entry.message
  const blocks =
    isRecord(message) && Array.isArray(message.content) ? message.content : []
  const events: NormalizedEvent[] = []

  for (const block of blocks) {
    if (!isRecord(block)) {
      continue
    }

    if (block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string") {
      if (block.name === "TodoWrite") {
        const input = block.input
        const todos =
          isRecord(input) && Array.isArray(input.todos)
            ? input.todos
                .map(normalizeTodoItem)
                .filter((todo): todo is TodoItem => todo !== null)
            : null

        if (todos !== null) {
          events.push({
            sessionId,
            timestamp,
            eventType: "todo-replace",
            todos,
          })
        }

        continue
      }

      events.push({
        sessionId,
        timestamp,
        eventType: "tool-start",
        toolCallId: block.id,
        toolName: block.name,
        input: toInputRecord(block.input),
      })
      continue
    }

    const incrementalTodoEvent = parseIncrementalTodoEvent(sessionId, timestamp, block)

    if (incrementalTodoEvent !== null) {
      events.push(incrementalTodoEvent)
      continue
    }

    if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
      events.push({
        sessionId,
        timestamp,
        eventType: "tool-end",
        toolCallId: block.tool_use_id,
        status: block.is_error === true ? "error" : "completed",
      })
    }
  }

  const attachmentEvent = parseAttachmentEvent(sessionId, timestamp, entry.attachment)

  if (attachmentEvent !== null) {
    events.push(attachmentEvent)
  }

  return events
}
