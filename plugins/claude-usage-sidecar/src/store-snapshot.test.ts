import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createEmptySessionState } from "./aggregate-session-state.js"
import { writeCheckpoint, writeSessionSnapshot } from "./store-snapshot.js"
import type { SessionSnapshot, StreamCheckpoint } from "./types.js"

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

const readJson = <T>(filePath: string): T =>
  JSON.parse(readFileSync(filePath, "utf8")) as T

describe("store-snapshot", () => {
  it("writes a session snapshot and checkpoint to the configured cache layout", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "usage-sidecar-store-"))
    tempRoots.push(root)
    const snapshot: SessionSnapshot = {
      sessionId: "session-1",
      startedAt: null,
      lastActivityAt: null,
      sourceFiles: [],
      tools: {},
      skills: {},
      agents: [],
      todos: { total: 0, completed: 0, inProgress: 0, items: [] },
      usage: { available: false },
      limitations: {
        perToolTokens: "unavailable",
        perSkillTokens: "unavailable",
      },
    }
    const checkpoint: StreamCheckpoint = {
      filePath: "C:/Users/admin/.claude/projects/demo/session-1.jsonl",
      offset: 42,
    }

    writeSessionSnapshot(path.join(root, "snapshots"), snapshot)
    writeCheckpoint(path.join(root, "checkpoints"), "stream-a", checkpoint)

    const savedSnapshot = readJson<SessionSnapshot>(
      path.join(root, "snapshots", "session-1.json"),
    )
    const savedCheckpoint = readJson<StreamCheckpoint>(
      path.join(root, "checkpoints", "stream-a.json"),
    )

    expect(savedSnapshot).toEqual(snapshot)
    expect(savedCheckpoint).toEqual(checkpoint)
  })

  it("converts a runtime session snapshot before persisting it", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "usage-sidecar-store-"))
    tempRoots.push(root)
    const runtimeSnapshot = createEmptySessionState("session-runtime")

    runtimeSnapshot.tools.Read = {
      calls: 1,
      completed: 0,
      errors: 0,
      running: 1,
    }
    runtimeSnapshot.openToolCalls["tool-1"] = {
      toolName: "Read",
      startedAt: "2026-06-09T00:00:00.000Z",
    }

    writeSessionSnapshot(path.join(root, "snapshots"), runtimeSnapshot)

    const savedSnapshot = readJson<Record<string, unknown>>(
      path.join(root, "snapshots", "session-runtime.json"),
    )

    expect(savedSnapshot).toMatchObject({
      sessionId: "session-runtime",
      tools: {
        Read: { calls: 1, completed: 0, errors: 0, running: 1 },
      },
    })
    expect(savedSnapshot).not.toHaveProperty("openToolCalls")
  })
})
