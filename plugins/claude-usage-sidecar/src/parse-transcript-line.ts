import type { NormalizedEvent, TodoItem, TodoStatus } from "./types.js"

type JsonObject = Record<string, unknown>

const isRecord = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const normalizeTodoStatus = (status: unknown): TodoStatus => {
  if (status === "completed" || status === "done" || status === "complete") {
    return "completed"
  }

  if (status === "in_progress" || status === "running") {
    return "in_progress"
  }

  return "pending"
}

const normalizeTodoItem = (value: unknown): TodoItem => {
  if (!isRecord(value)) {
    return {
      content: "",
      status: "pending",
    }
  }

  return {
    content: String(value.content ?? ""),
    status: normalizeTodoStatus(value.status),
  }
}

const toInputRecord = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) {
    return {}
  }

  return value
}

export const parseTranscriptLine = (line: string): NormalizedEvent[] => {
  let entry: unknown

  try {
    entry = JSON.parse(line)
  } catch {
    return []
  }

  if (!isRecord(entry)) {
    return []
  }

  const sessionId = String(entry.sessionId ?? "")
  const timestamp = String(entry.timestamp ?? "")
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
          isRecord(input) && Array.isArray(input.todos) ? input.todos.map(normalizeTodoItem) : null

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

  return sessionId.length > 0 && timestamp.length > 0 ? events : []
}
