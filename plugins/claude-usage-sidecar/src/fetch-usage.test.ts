import { describe, expect, it } from "vitest"
import { createEmptySessionState, toPersistedSessionSnapshot } from "./aggregate-session-state.js"
import { mergeUsageIntoSnapshot } from "./fetch-usage.js"

describe("mergeUsageIntoSnapshot", () => {
  it("attaches usage availability without inventing session token splits", () => {
    const snapshot = toPersistedSessionSnapshot(createEmptySessionState("session-1"))

    const next = mergeUsageIntoSnapshot(snapshot, {
      planName: "Max",
      fiveHourUtilization: 24,
      sevenDayUtilization: 80,
      available: true,
    })

    expect(next).not.toBe(snapshot)
    expect(next.usage).toEqual({
      available: true,
      planName: "Max",
      fiveHourUtilization: 24,
      sevenDayUtilization: 80,
    })
    expect(next.limitations).toEqual({
      perToolTokens: "unavailable",
      perSkillTokens: "unavailable",
    })
    expect(next.usage).not.toHaveProperty("sessionInputTokens")
    expect(next.usage).not.toHaveProperty("sessionOutputTokens")
  })
})
