import { describe, expect, it } from "vitest"
import { aggregate } from "./aggregator"

describe("aggregate", () => {
  it("allocates tool usage for cache-read-only turns", () => {
    const messages = [
      {
        id: "assistant-1",
        role: "assistant",
        sessionID: "session-1",
        tokens: {
          input: 0,
          output: 12,
          cache: { read: 80, write: 0 },
        },
      },
    ] as any

    const result = aggregate(
      messages,
      () =>
        [
          {
            type: "tool",
            tool: "read",
            state: { status: "completed", output: "x".repeat(200) },
          },
        ] as any,
      [],
      []
    )

    expect(result.total.cacheRead).toBe(80)
    expect(result.byTool["tool:read"]?.input).toBeGreaterThan(0)
  })

  it("uses structured tool output size instead of [object Object]", () => {
    const messages = [
      {
        id: "assistant-1",
        role: "assistant",
        sessionID: "session-1",
        tokens: {
          input: 100,
          output: 10,
          cache: { read: 0, write: 0 },
        },
      },
    ] as any

    const result = aggregate(
      messages,
      () =>
        [
          {
            type: "tool",
            tool: "json-heavy",
            state: {
              status: "completed",
              output: { text: "x".repeat(120), nested: { ok: true } },
            },
          },
          {
            type: "tool",
            tool: "plain-text",
            state: {
              status: "completed",
              output: "y".repeat(30),
            },
          },
        ] as any,
      [],
      []
    )

    expect(result.byTool["tool:json-heavy"]?.input).toBeGreaterThan(
      result.byTool["tool:plain-text"]?.input ?? 0
    )
  })
})
