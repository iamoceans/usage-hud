import { describe, expect, it } from "vitest"
import { renderSessionReport } from "./report-session.js"
import type { SessionSnapshot } from "./types.js"

describe("renderSessionReport", () => {
  it("prints a concise truthful summary from a stored snapshot", () => {
    const snapshot: SessionSnapshot = {
      sessionId: "session-1",
      startedAt: null,
      lastActivityAt: "2026-06-08T12:00:00.000Z",
      sourceFiles: [],
      tools: {
        Read: { calls: 2, completed: 2, errors: 0, running: 0 },
      },
      skills: {},
      agents: [],
      todos: {
        total: 1,
        completed: 1,
        inProgress: 0,
        items: [{ content: "write plan", status: "completed" }],
      },
      usage: { available: false },
      limitations: {
        perToolTokens: "unavailable",
        perSkillTokens: "unavailable",
      },
    }

    const output = renderSessionReport(snapshot)

    expect(output).toBe(
      [
        "session: session-1",
        "last activity: 2026-06-08T12:00:00.000Z",
        "tools:",
        "- Read: 2 calls (2 completed, 0 errors, 0 running)",
        "todos: 1/1 completed",
        "usage available: no",
        "per-tool tokens: unavailable",
        "per-skill tokens: unavailable",
      ].join("\n"),
    )
    expect(output).not.toContain("estimated")
    expect(output).not.toContain("session tokens")
  })
})
