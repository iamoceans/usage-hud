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
