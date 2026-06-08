import { describe, expect, it } from "vitest"
import { parseTranscriptLine } from "./parse-transcript-line.js"

describe("parseTranscriptLine", () => {
  it("extracts tool_use blocks into normalized tool-start events", () => {
    const line = JSON.stringify({
      sessionId: "session-1",
      timestamp: "2026-06-08T12:00:00.000Z",
      message: {
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "Read",
            input: { file_path: "README.md" },
          },
        ],
      },
    })

    expect(parseTranscriptLine(line)).toEqual([
      {
        sessionId: "session-1",
        timestamp: "2026-06-08T12:00:00.000Z",
        eventType: "tool-start",
        toolCallId: "tool-1",
        toolName: "Read",
        input: { file_path: "README.md" },
      },
    ])
  })

  it("extracts tool_result and TodoWrite events", () => {
    const line = JSON.stringify({
      sessionId: "session-1",
      timestamp: "2026-06-08T12:00:01.000Z",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "tool-1", is_error: false },
          {
            type: "tool_use",
            id: "todo-1",
            name: "TodoWrite",
            input: {
              todos: [
                { content: "Write plan", status: "completed" },
                { content: "Run tests", status: "running" },
                { content: "Ship", status: "unknown" },
              ],
            },
          },
        ],
      },
    })

    expect(parseTranscriptLine(line)).toEqual([
      {
        sessionId: "session-1",
        timestamp: "2026-06-08T12:00:01.000Z",
        eventType: "tool-end",
        toolCallId: "tool-1",
        status: "completed",
      },
      {
        sessionId: "session-1",
        timestamp: "2026-06-08T12:00:01.000Z",
        eventType: "todo-replace",
        todos: [
          { content: "Write plan", status: "completed" },
          { content: "Run tests", status: "in_progress" },
          { content: "Ship", status: "pending" },
        ],
      },
    ])
  })

  it("skips malformed transcript lines", () => {
    expect(parseTranscriptLine("{not json}")).toEqual([])
  })
})
