import { describe, expect, it } from "vitest"
import * as publicApi from "./index.js"

const EXPECTED_PUBLIC_NAMES = [
  "getDefaultConfig",
  "discoverTranscripts",
  "readTranscriptDelta",
  "parseTranscriptLine",
  "createEmptySessionState",
  "reduceSessionEvents",
  "toPersistedSessionSnapshot",
  "writeSessionSnapshot",
  "writeCheckpoint",
  "readCheckpoint",
  "fetchUsageSummary",
  "mergeUsageIntoSnapshot",
  "renderSessionReport",
] as const

const INTERNAL_LEAK_NAMES = [
  "TodoStatus",
  "TodoItem",
  "TodoOperation",
  "ToolCounter",
  "SessionAgentState",
  "SessionTodoState",
  "SessionUsageState",
  "SessionLimitations",
  "SessionIndexEntry",
  "SessionIndex",
] as const

describe("public package exports", () => {
  it("exposes the documented public API and nothing else", () => {
    for (const name of EXPECTED_PUBLIC_NAMES) {
      expect(publicApi).toHaveProperty(name)
    }

    for (const name of INTERNAL_LEAK_NAMES) {
      expect(publicApi).not.toHaveProperty(name)
    }

    expect(publicApi).not.toHaveProperty("runCli")
    expect(publicApi).not.toHaveProperty("runWatchCycle")
  })
})
