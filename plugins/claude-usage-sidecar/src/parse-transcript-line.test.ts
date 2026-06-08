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

  it("skips invalid todo elements instead of emitting empty tasks", () => {
    const line = JSON.stringify({
      sessionId: "session-1",
      timestamp: "2026-06-08T12:00:02.000Z",
      message: {
        content: [
          {
            type: "tool_use",
            id: "todo-2",
            name: "TodoWrite",
            input: {
              todos: [
                null,
                {},
                { content: "" },
                { content: "   " },
                { content: "Keep me", status: "done" },
              ],
            },
          },
        ],
      },
    })

    expect(parseTranscriptLine(line)).toEqual([
      {
        sessionId: "session-1",
        timestamp: "2026-06-08T12:00:02.000Z",
        eventType: "todo-replace",
        todos: [{ content: "Keep me", status: "completed" }],
      },
    ])
  })

  it("returns no events when sessionId or timestamp are not non-empty strings", () => {
    const missingSession = JSON.stringify({
      sessionId: 123,
      timestamp: "2026-06-08T12:00:03.000Z",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "tool-1", is_error: false },
        ],
      },
    })
    const blankTimestamp = JSON.stringify({
      sessionId: "session-1",
      timestamp: "   ",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "tool-1", is_error: false },
        ],
      },
    })

    expect(parseTranscriptLine(missingSession)).toEqual([])
    expect(parseTranscriptLine(blankTimestamp)).toEqual([])
  })

  it("extracts supported attachment events into normalized attachment events", () => {
    const line = JSON.stringify({
      sessionId: "session-1",
      timestamp: "2026-06-08T12:00:04.000Z",
      attachment: {
        type: "hook_success",
        hook_event_name: "PostToolUse",
        matcher: "Edit",
      },
    })
    const secondLine = JSON.stringify({
      sessionId: "session-1",
      timestamp: "2026-06-08T12:00:05.000Z",
      attachment: {
        type: "hook_additional_context",
        content: "extra context",
      },
    })
    const thirdLine = JSON.stringify({
      sessionId: "session-1",
      timestamp: "2026-06-08T12:00:06.000Z",
      attachment: {
        type: "skill_listing",
        skills: ["debugger", "reviewer"],
      },
    })

    expect(parseTranscriptLine(line)).toEqual([
      {
        sessionId: "session-1",
        timestamp: "2026-06-08T12:00:04.000Z",
        eventType: "hook-success",
        hookEventName: "PostToolUse",
        attachment: {
          type: "hook_success",
          hook_event_name: "PostToolUse",
          matcher: "Edit",
        },
      },
    ])
    expect(parseTranscriptLine(secondLine)).toEqual([
      {
        sessionId: "session-1",
        timestamp: "2026-06-08T12:00:05.000Z",
        eventType: "hook-additional-context",
        attachment: {
          type: "hook_additional_context",
          content: "extra context",
        },
      },
    ])
    expect(parseTranscriptLine(thirdLine)).toEqual([
      {
        sessionId: "session-1",
        timestamp: "2026-06-08T12:00:06.000Z",
        eventType: "skill-listing",
        skills: ["debugger", "reviewer"],
        attachment: {
          type: "skill_listing",
          skills: ["debugger", "reviewer"],
        },
      },
    ])
  })

  it("logs malformed transcript lines through the optional debug callback", () => {
    const debugCalls: Array<{ message: string; line: string }> = []

    expect(
      parseTranscriptLine("{not json}", {
        debug: (message, context) => {
          debugCalls.push({
            message,
            line: String(context?.line ?? ""),
          })
        },
      }),
    ).toEqual([])

    expect(debugCalls).toEqual([
      {
        message: "Failed to parse transcript line",
        line: "{not json}",
      },
    ])
  })

  it("emits a narrow incremental todo event only for clearly identifiable task updates", () => {
    const line = JSON.stringify({
      sessionId: "session-1",
      timestamp: "2026-06-08T12:00:07.000Z",
      message: {
        content: [
          {
            type: "todo_update",
            operation: "update",
            todo: {
              content: "Review parser",
              status: "running",
            },
          },
          {
            type: "task_update",
            operation: "remove",
            content: "Old item",
          },
        ],
      },
    })

    expect(parseTranscriptLine(line)).toEqual([
      {
        sessionId: "session-1",
        timestamp: "2026-06-08T12:00:07.000Z",
        eventType: "todo-update",
        operation: "update",
        todo: {
          content: "Review parser",
          status: "in_progress",
        },
      },
      {
        sessionId: "session-1",
        timestamp: "2026-06-08T12:00:07.000Z",
        eventType: "todo-update",
        operation: "remove",
        targetContent: "Old item",
      },
    ])
  })

  it("ignores malformed lines and unsupported incremental todo shapes by default", () => {
    const malformedLine = "{not json}"
    const ambiguousIncremental = JSON.stringify({
      sessionId: "session-1",
      timestamp: "2026-06-08T12:00:08.000Z",
      message: {
        content: [
          {
            type: "todo_update",
            operation: "update",
          },
          {
            type: "task_update",
            operation: "remove",
          },
        ],
      },
    })

    expect(parseTranscriptLine(malformedLine)).toEqual([])
    expect(parseTranscriptLine(ambiguousIncremental)).toEqual([])
  })
})
