import { describe, expect, it } from "vitest"
import {
  createEmptySessionState,
  reduceSessionEvents,
  toPersistedSessionSnapshot,
} from "./aggregate-session-state.js"
import type { NormalizedEvent } from "./types.js"

describe("aggregate-session-state", () => {
  it("tracks tool counts, Task agent activity, and todo state without token estimates", () => {
    const start = createEmptySessionState("session-1")
    const events: NormalizedEvent[] = [
      {
        sessionId: "session-1",
        timestamp: "2026-06-08T12:00:00.000Z",
        sourceFile: "C:/Users/admin/.claude/projects/project-a/session-1.jsonl",
        eventType: "tool-start",
        toolCallId: "read-1",
        toolName: "Read",
        input: { file_path: "README.md" },
      },
      {
        sessionId: "session-1",
        timestamp: "2026-06-08T12:00:01.000Z",
        eventType: "tool-end",
        toolCallId: "read-1",
        status: "completed",
      },
      {
        sessionId: "session-1",
        timestamp: "2026-06-08T12:00:02.000Z",
        eventType: "tool-start",
        toolCallId: "task-1",
        toolName: "Task",
        input: {
          subagent_type: "search",
          description: "scan repo",
          estimated_tokens: 9999,
        },
      },
      {
        sessionId: "session-1",
        timestamp: "2026-06-08T12:00:03.000Z",
        eventType: "todo-replace",
        todos: [
          { content: "write tests", status: "completed" },
          { content: "implement reducer", status: "in_progress" },
        ],
      },
      {
        sessionId: "session-1",
        timestamp: "2026-06-08T12:00:04.000Z",
        eventType: "todo-update",
        operation: "update",
        todo: { content: "implement reducer", status: "completed" },
      },
      {
        sessionId: "session-1",
        timestamp: "2026-06-08T12:00:05.000Z",
        eventType: "todo-update",
        operation: "add",
        todo: { content: "ship task 4", status: "pending" },
      },
      {
        sessionId: "session-1",
        timestamp: "2026-06-08T12:00:06.000Z",
        eventType: "todo-update",
        operation: "remove",
        targetContent: "ship task 4",
      },
      {
        sessionId: "session-1",
        timestamp: "2026-06-08T12:00:07.000Z",
        eventType: "tool-end",
        toolCallId: "task-1",
        status: "completed",
      },
      {
        sessionId: "session-2",
        timestamp: "2026-06-08T12:00:08.000Z",
        eventType: "tool-start",
        toolCallId: "foreign-1",
        toolName: "Read",
        input: { file_path: "ignored.md" },
      },
    ]

    const next = reduceSessionEvents(start, events)

    expect(next).not.toBe(start)
    expect(start).toEqual(createEmptySessionState("session-1"))
    expect(next.startedAt).toBe("2026-06-08T12:00:00.000Z")
    expect(next.lastActivityAt).toBe("2026-06-08T12:00:07.000Z")
    expect(next.sourceFiles).toEqual([
      "C:/Users/admin/.claude/projects/project-a/session-1.jsonl",
    ])
    expect(next.tools).toEqual({
      Read: { calls: 1, completed: 1, errors: 0, running: 0 },
      Task: { calls: 1, completed: 1, errors: 0, running: 0 },
    })
    expect(next.agents).toEqual([
      {
        id: "task-1",
        type: "search",
        description: "scan repo",
        status: "completed",
        startTime: "2026-06-08T12:00:02.000Z",
        endTime: "2026-06-08T12:00:07.000Z",
      },
    ])
    expect(next.todos).toEqual({
      total: 2,
      completed: 2,
      inProgress: 0,
      items: [
        { content: "write tests", status: "completed" },
        { content: "implement reducer", status: "completed" },
      ],
    })
    expect(next.limitations).toEqual({
      perToolTokens: "unavailable",
      perSkillTokens: "unavailable",
    })
    expect(next.usage).toEqual({ available: false })
  })

  it("tracks named Skill calls truthfully and ignores unnamed ones", () => {
    const next = reduceSessionEvents(createEmptySessionState("session-skill"), [
      {
        sessionId: "session-skill",
        timestamp: "2026-06-08T12:15:00.000Z",
        eventType: "tool-start",
        toolCallId: "skill-1",
        toolName: "Skill",
        input: { name: "using-superpowers" },
      },
      {
        sessionId: "session-skill",
        timestamp: "2026-06-08T12:15:01.000Z",
        eventType: "tool-end",
        toolCallId: "skill-1",
        status: "completed",
      },
      {
        sessionId: "session-skill",
        timestamp: "2026-06-08T12:15:02.000Z",
        eventType: "tool-start",
        toolCallId: "skill-2",
        toolName: "Skill",
        input: { name: "requesting-code-review" },
      },
      {
        sessionId: "session-skill",
        timestamp: "2026-06-08T12:15:03.000Z",
        eventType: "tool-end",
        toolCallId: "skill-2",
        status: "error",
      },
      {
        sessionId: "session-skill",
        timestamp: "2026-06-08T12:15:04.000Z",
        eventType: "tool-start",
        toolCallId: "skill-3",
        toolName: "Skill",
        input: {},
      },
      {
        sessionId: "session-skill",
        timestamp: "2026-06-08T12:15:05.000Z",
        eventType: "tool-end",
        toolCallId: "skill-3",
        status: "completed",
      },
    ])

    expect(next.tools.Skill).toEqual({
      calls: 3,
      completed: 2,
      errors: 1,
      running: 0,
    })
    expect(next.skills).toEqual({
      "using-superpowers": {
        calls: 1,
        completed: 1,
        errors: 0,
        running: 0,
      },
      "requesting-code-review": {
        calls: 1,
        completed: 0,
        errors: 1,
        running: 0,
      },
    })
  })

  it("keeps counters truthful when tool ends arrive without a matching start", () => {
    const next = reduceSessionEvents(createEmptySessionState("session-2"), [
      {
        sessionId: "session-2",
        timestamp: "2026-06-08T12:10:00.000Z",
        eventType: "tool-end",
        toolCallId: "missing-call",
        status: "error",
      },
    ])

    expect(next.tools).toEqual({})
    expect(next.agents).toEqual([])
    expect(next.todos).toEqual({
      total: 0,
      completed: 0,
      inProgress: 0,
      items: [],
    })
    expect(next.startedAt).toBe("2026-06-08T12:10:00.000Z")
    expect(next.lastActivityAt).toBe("2026-06-08T12:10:00.000Z")
  })

  it("creates a persisted snapshot without runtime-only fields", () => {
    const state = reduceSessionEvents(createEmptySessionState("session-3"), [
      {
        sessionId: "session-3",
        timestamp: "2026-06-08T12:20:00.000Z",
        eventType: "tool-start",
        toolCallId: "task-open",
        toolName: "Task",
        input: { subagent_type: "review", description: "review reducer" },
      },
    ])
    state.usage = {
      available: true,
      planName: "Max",
      fiveHourUtilization: 24,
      fiveHourResetAt: "2026-06-08T15:00:00.000Z",
      sevenDayUtilization: 80,
      sevenDayResetAt: "2026-06-13T00:00:00.000Z",
    }

    const snapshot = toPersistedSessionSnapshot(state)

    expect(snapshot).toEqual({
      sessionId: "session-3",
      startedAt: "2026-06-08T12:20:00.000Z",
      lastActivityAt: "2026-06-08T12:20:00.000Z",
      sourceFiles: [],
      tools: {
        Task: { calls: 1, completed: 0, errors: 0, running: 1 },
      },
      skills: {},
      agents: [
        {
          id: "task-open",
          type: "review",
          description: "review reducer",
          status: "running",
          startTime: "2026-06-08T12:20:00.000Z",
          endTime: undefined,
        },
      ],
      todos: {
        total: 0,
        completed: 0,
        inProgress: 0,
        items: [],
      },
      usage: {
        available: true,
        planName: "Max",
        fiveHourUtilization: 24,
        fiveHourResetAt: "2026-06-08T15:00:00.000Z",
        sevenDayUtilization: 80,
        sevenDayResetAt: "2026-06-13T00:00:00.000Z",
      },
      limitations: {
        perToolTokens: "unavailable",
        perSkillTokens: "unavailable",
      },
    })
    expect("openToolCalls" in snapshot).toBe(false)
  })

  it("removes only the first matching todo item for duplicate content", () => {
    const next = reduceSessionEvents(createEmptySessionState("session-dup"), [
      {
        sessionId: "session-dup",
        timestamp: "2026-06-08T12:30:00.000Z",
        eventType: "todo-replace",
        todos: [
          { content: "duplicate", status: "pending" },
          { content: "duplicate", status: "completed" },
        ],
      },
      {
        sessionId: "session-dup",
        timestamp: "2026-06-08T12:30:01.000Z",
        eventType: "todo-update",
        operation: "remove",
        targetContent: "duplicate",
      },
    ])

    expect(next.todos).toEqual({
      total: 1,
      completed: 1,
      inProgress: 0,
      items: [{ content: "duplicate", status: "completed" }],
    })
  })
})
