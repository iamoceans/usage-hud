import { describe, expect, it, vi } from "vitest"
import * as path from "node:path"
import { runCli, runWatchCycle } from "./cli.js"
import type { SessionIndex, SessionSnapshot } from "./types.js"

const createIo = () => {
  let stdout = ""
  let stderr = ""

  return {
    io: {
      stdout: {
        write: (chunk: string) => {
          stdout += chunk
        },
      },
      stderr: {
        write: (chunk: string) => {
          stderr += chunk
        },
      },
    },
    readStdout: () => stdout,
    readStderr: () => stderr,
  }
}

const createSnapshot = (sessionId: string, lastActivityAt: string): SessionSnapshot => ({
  sessionId,
  startedAt: null,
  lastActivityAt,
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
})

describe("runCli", () => {
  it("renders a report for an explicit --session id", async () => {
    const { io, readStdout, readStderr } = createIo()
    const snapshot = createSnapshot("session-42", "2026-06-10T00:00:00.000Z")
    const readFileSync = (filePath: string): string => {
      expect(path.normalize(filePath)).toBe(
        path.normalize("C:/cache/snapshots/session-42.json"),
      )
      return JSON.stringify(snapshot)
    }

    const exitCode = await runCli(["node", "cli", "report", "--session", "session-42"], {
      io,
      deps: {
        readFileSync,
        fetchUsageSummary: async () => ({ available: false }),
        getDefaultConfig: () =>
          ({
            snapshotsDir: "C:/cache/snapshots",
            indexFile: "C:/cache/index.json",
          }) as any,
      },
    })

    expect(exitCode).toBe(0)
    expect(readStdout()).toContain("session: session-42")
    expect(readStderr()).toBe("")
  })

  it("renders the latest indexed snapshot for --latest", async () => {
    const { io, readStdout, readStderr } = createIo()
    const index: SessionIndex = {
      sessions: [
        {
          sessionId: "older",
          snapshotFile: "older.json",
          startedAt: "2026-06-10T00:00:00.000Z",
          lastActivityAt: "2026-06-10T00:01:00.000Z",
        },
        {
          sessionId: "newer",
          snapshotFile: "newer.json",
          startedAt: "2026-06-10T00:02:00.000Z",
          lastActivityAt: "2026-06-10T00:03:00.000Z",
        },
      ],
    }
    const newerSnapshot = createSnapshot("newer", "2026-06-10T00:03:00.000Z")
    const readFileSync = (filePath: string): string => {
      if (path.normalize(filePath) === path.normalize("C:/cache/index.json")) {
        return JSON.stringify(index)
      }

      expect(path.normalize(filePath)).toBe(path.normalize("C:/cache/snapshots/newer.json"))
      return JSON.stringify(newerSnapshot)
    }

    const exitCode = await runCli(["node", "cli", "report", "--latest"], {
      io,
      deps: {
        readFileSync,
        fetchUsageSummary: async () => ({ available: false }),
        getDefaultConfig: () =>
          ({
            snapshotsDir: "C:/cache/snapshots",
            indexFile: "C:/cache/index.json",
          }) as any,
      },
    })

    expect(exitCode).toBe(0)
    expect(readStdout()).toContain("session: newer")
    expect(readStderr()).toBe("")
  })

  it("accepts encoded snapshot file names emitted by store-snapshot", async () => {
    const { io, readStdout, readStderr } = createIo()
    const index: SessionIndex = {
      sessions: [
        {
          sessionId: "../session/a",
          snapshotFile: "..%2Fsession%2Fa.json",
          startedAt: "2026-06-10T00:02:00.000Z",
          lastActivityAt: "2026-06-10T00:03:00.000Z",
        },
      ],
    }
    const encodedSnapshot = createSnapshot("../session/a", "2026-06-10T00:03:00.000Z")
    const readFileSync = (filePath: string): string => {
      if (path.normalize(filePath) === path.normalize("C:/cache/index.json")) {
        return JSON.stringify(index)
      }

      expect(path.normalize(filePath)).toBe(
        path.normalize("C:/cache/snapshots/..%2Fsession%2Fa.json"),
      )
      return JSON.stringify(encodedSnapshot)
    }

    const exitCode = await runCli(["node", "cli", "report", "--latest"], {
      io,
      deps: {
        readFileSync,
        fetchUsageSummary: async () => ({ available: false }),
        getDefaultConfig: () =>
          ({
            snapshotsDir: "C:/cache/snapshots",
            indexFile: "C:/cache/index.json",
          }) as any,
      },
    })

    expect(exitCode).toBe(0)
    expect(readStdout()).toContain("session: ../session/a")
    expect(readStderr()).toBe("")
  })

  it("rejects unsafe snapshot file names in index.json for --latest", async () => {
    const { io, readStdout, readStderr } = createIo()
    const index: SessionIndex = {
      sessions: [
        {
          sessionId: "bad",
          snapshotFile: "../escape.json",
          startedAt: "2026-06-10T00:00:00.000Z",
          lastActivityAt: "2026-06-10T00:01:00.000Z",
        },
      ],
    }
    const readFileSync = (filePath: string): string => {
      expect(path.normalize(filePath)).toBe(path.normalize("C:/cache/index.json"))
      return JSON.stringify(index)
    }

    const exitCode = await runCli(["node", "cli", "report", "--latest"], {
      io,
      deps: {
        readFileSync,
        fetchUsageSummary: async () => ({ available: false }),
        getDefaultConfig: () =>
          ({
            snapshotsDir: "C:/cache/snapshots",
            indexFile: "C:/cache/index.json",
          }) as any,
      },
    })

    expect(exitCode).toBe(1)
    expect(readStdout()).toBe("")
    expect(readStderr()).toContain("index.json does not contain any sessions")
  })

  it("prints usage when report arguments are missing", async () => {
    const { io, readStdout, readStderr } = createIo()

    const exitCode = await runCli(["node", "cli", "report"], {
      io,
    })

    expect(exitCode).toBe(1)
    expect(readStdout()).toContain("report --session <session-id>")
    expect(readStdout()).toContain("report --latest")
    expect(readStderr()).toBe("")
  })

  it("does not accept the removed positional session-id form", async () => {
    const { io, readStdout, readStderr } = createIo()

    const exitCode = await runCli(["node", "cli", "report", "session-42"], {
      io,
    })

    expect(exitCode).toBe(1)
    expect(readStdout()).toContain("report --session <session-id>")
    expect(readStderr()).toBe("")
  })
})

describe("runWatchCycle", () => {
  it("discovers transcripts, resumes from checkpoints, reduces events, and persists outputs", () => {
    const discoverTranscripts = vi.fn(() => ["C:/tmp/session.jsonl"])
    const loadCheckpoint = vi.fn(() => ({
      filePath: "C:/tmp/session.jsonl",
      offset: 4,
    }))
    const readTranscriptDelta = vi.fn(() => ({
      lines: [
        JSON.stringify({
          sessionId: "session-1",
          timestamp: "2026-06-10T12:00:00.000Z",
          message: {
            content: [
              {
                type: "tool_use",
                id: "tool-1",
                name: "Skill",
                input: { name: "aihot" },
              },
            ],
          },
        }),
        JSON.stringify({
          sessionId: "session-1",
          timestamp: "2026-06-10T12:00:01.000Z",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool-1",
                is_error: false,
              },
            ],
          },
        }),
      ],
      nextOffset: 128,
    }))
    const writeSessionSnapshot = vi.fn()
    const writeCheckpoint = vi.fn()

    runWatchCycle({
      getDefaultConfig: () =>
        ({
          projectsDir: "C:/claude/projects",
          checkpointsDir: "C:/claude/cache/checkpoints",
          snapshotsDir: "C:/claude/cache/snapshots",
          indexFile: "C:/claude/cache/index.json",
        }) as any,
      discoverTranscripts,
      loadCheckpoint,
      readTranscriptDelta,
      writeSessionSnapshot,
      writeCheckpoint,
    })

    expect(discoverTranscripts).toHaveBeenCalledWith("C:/claude/projects")
    expect(loadCheckpoint).toHaveBeenCalledTimes(1)
    expect(loadCheckpoint).toHaveBeenCalledWith(
      "C:/claude/cache/checkpoints",
      expect.any(String),
    )
    expect(readTranscriptDelta).toHaveBeenCalledWith("C:/tmp/session.jsonl", 4)
    expect(writeSessionSnapshot).toHaveBeenCalledTimes(1)
    expect(writeSessionSnapshot).toHaveBeenLastCalledWith(
      "C:/claude/cache/snapshots",
      expect.objectContaining({
        sessionId: "session-1",
        lastActivityAt: "2026-06-10T12:00:01.000Z",
        sourceFiles: ["C:/tmp/session.jsonl"],
        tools: {
          Skill: {
            calls: 1,
            completed: 1,
            errors: 0,
            running: 0,
          },
        },
        skills: {
          aihot: {
            calls: 1,
            completed: 1,
            errors: 0,
            running: 0,
          },
        },
      }),
      {
        indexFile: "C:/claude/cache/index.json",
      },
    )
    expect(writeCheckpoint).toHaveBeenCalledWith(
      "C:/claude/cache/checkpoints",
      expect.any(String),
      {
        filePath: "C:/tmp/session.jsonl",
        offset: 128,
      },
    )
  })

  it("writes one snapshot per session per file and reports counts", () => {
    const discoverTranscripts = vi.fn(() => ["C:/tmp/a.jsonl", "C:/tmp/b.jsonl"])
    const loadCheckpoint = vi.fn(() => null)
    const readTranscriptDelta = vi.fn((filePath: string) => {
      if (filePath === "C:/tmp/a.jsonl") {
        return {
          lines: [
            JSON.stringify({
              sessionId: "session-a",
              timestamp: "2026-06-10T12:00:00.000Z",
              message: {
                content: [
                  {
                    type: "tool_use",
                    id: "tool-a1",
                    name: "Read",
                    input: {},
                  },
                ],
              },
            }),
          ],
          nextOffset: 64,
        }
      }

      return {
        lines: [
          JSON.stringify({
            sessionId: "session-b",
            timestamp: "2026-06-10T12:00:02.000Z",
            message: {
              content: [
                {
                  type: "tool_use",
                  id: "tool-b1",
                  name: "Skill",
                  input: { name: "aihot" },
                },
              ],
            },
          }),
        ],
        nextOffset: 80,
      }
    })
    const writeSessionSnapshot = vi.fn()
    const writeCheckpoint = vi.fn()

    const result = runWatchCycle(
      {
        getDefaultConfig: () =>
          ({
            projectsDir: "C:/claude/projects",
            checkpointsDir: "C:/claude/cache/checkpoints",
            snapshotsDir: "C:/claude/cache/snapshots",
            indexFile: "C:/claude/cache/index.json",
          }) as any,
        discoverTranscripts,
        loadCheckpoint,
        readTranscriptDelta,
        writeSessionSnapshot,
        writeCheckpoint,
      },
    )

    expect(writeSessionSnapshot).toHaveBeenCalledTimes(2)
    expect(writeCheckpoint).toHaveBeenCalledTimes(2)
    expect(result).toEqual({
      filesProcessed: 2,
      sessionsUpdated: 2,
      bytesConsumed: 64 + 80,
      aborted: false,
    })
  })

  it("aborts the cycle when the AbortSignal is set and reports aborted=true", () => {
    const controller = new AbortController()
    controller.abort()
    const discoverTranscripts = vi.fn(() => ["C:/tmp/a.jsonl"])
    const loadCheckpoint = vi.fn(() => null)
    const readTranscriptDelta = vi.fn()
    const writeSessionSnapshot = vi.fn()
    const writeCheckpoint = vi.fn()

    const result = runWatchCycle(
      {
        getDefaultConfig: () =>
          ({
            projectsDir: "C:/claude/projects",
            checkpointsDir: "C:/claude/cache/checkpoints",
            snapshotsDir: "C:/claude/cache/snapshots",
            indexFile: "C:/claude/cache/index.json",
          }) as any,
        discoverTranscripts,
        loadCheckpoint,
        readTranscriptDelta,
        writeSessionSnapshot,
        writeCheckpoint,
      },
      { signal: controller.signal },
    )

    expect(readTranscriptDelta).not.toHaveBeenCalled()
    expect(writeSessionSnapshot).not.toHaveBeenCalled()
    expect(writeCheckpoint).not.toHaveBeenCalled()
    expect(result.aborted).toBe(true)
  })

  it("logs and continues when a file fails, instead of throwing", () => {
    const discoverTranscripts = vi.fn(() => ["C:/tmp/a.jsonl", "C:/tmp/b.jsonl"])
    const loadCheckpoint = vi.fn(() => null)
    const readTranscriptDelta = vi.fn((filePath: string) => {
      if (filePath === "C:/tmp/a.jsonl") {
        throw new Error("simulated read failure")
      }

      return {
        lines: [
          JSON.stringify({
            sessionId: "session-b",
            timestamp: "2026-06-10T12:00:02.000Z",
            message: {
              content: [
                {
                  type: "tool_use",
                  id: "tool-b1",
                  name: "Skill",
                  input: { name: "aihot" },
                },
              ],
            },
          }),
        ],
        nextOffset: 80,
      }
    })
    const writeSessionSnapshot = vi.fn()
    const writeCheckpoint = vi.fn()
    const logs: string[] = []

    const result = runWatchCycle(
      {
        getDefaultConfig: () =>
          ({
            projectsDir: "C:/claude/projects",
            checkpointsDir: "C:/claude/cache/checkpoints",
            snapshotsDir: "C:/claude/cache/snapshots",
            indexFile: "C:/claude/cache/index.json",
          }) as any,
        discoverTranscripts,
        loadCheckpoint,
        readTranscriptDelta,
        writeSessionSnapshot,
        writeCheckpoint,
      },
      { logger: (line) => logs.push(line) },
    )

    expect(writeCheckpoint).toHaveBeenCalledTimes(1)
    expect(writeCheckpoint).toHaveBeenLastCalledWith(
      "C:/claude/cache/checkpoints",
      expect.any(String),
      { filePath: "C:/tmp/b.jsonl", offset: 80 },
    )
    expect(writeSessionSnapshot).toHaveBeenCalledTimes(1)
    expect(logs.some((line) => line.includes("C:/tmp/a.jsonl"))).toBe(true)
    expect(result.aborted).toBe(false)
    expect(result.filesProcessed).toBe(2)
  })

  it("drops the cursor cache after a successful checkpoint so rotated files re-stat next cycle", () => {
    const discoverTranscripts = vi.fn(() => ["C:/tmp/session.jsonl"])
    const loadCheckpoint = vi.fn(() => null)
    const readTranscriptDelta = vi.fn(() => ({
      lines: [
        JSON.stringify({
          sessionId: "session-1",
          timestamp: "2026-06-10T12:00:00.000Z",
          message: {
            content: [
              {
                type: "tool_use",
                id: "tool-1",
                name: "Read",
                input: {},
              },
            ],
          },
        }),
      ],
      nextOffset: 64,
    }))
    const writeSessionSnapshot = vi.fn()
    const writeCheckpoint = vi.fn()
    const dropTranscriptCursorCacheEntry = vi.fn(() => true)

    runWatchCycle({
      getDefaultConfig: () =>
        ({
          projectsDir: "C:/claude/projects",
          checkpointsDir: "C:/claude/cache/checkpoints",
          snapshotsDir: "C:/claude/cache/snapshots",
          indexFile: "C:/claude/cache/index.json",
        }) as any,
      discoverTranscripts,
      loadCheckpoint,
      readTranscriptDelta,
      writeSessionSnapshot,
      writeCheckpoint,
      dropTranscriptCursorCacheEntry,
    })

    expect(dropTranscriptCursorCacheEntry).toHaveBeenCalledWith("C:/tmp/session.jsonl")
  })

  it("writes a no-op checkpoint + drops the cache when the file delta is empty and no checkpoint exists", () => {
    const discoverTranscripts = vi.fn(() => ["C:/tmp/empty.jsonl"])
    const loadCheckpoint = vi.fn(() => null)
    const readTranscriptDelta = vi.fn(() => ({ lines: [], nextOffset: 0 }))
    const writeSessionSnapshot = vi.fn()
    const writeCheckpoint = vi.fn()
    const dropTranscriptCursorCacheEntry = vi.fn(() => true)

    runWatchCycle({
      getDefaultConfig: () =>
        ({
          projectsDir: "C:/claude/projects",
          checkpointsDir: "C:/claude/cache/checkpoints",
          snapshotsDir: "C:/claude/cache/snapshots",
          indexFile: "C:/claude/cache/index.json",
        }) as any,
      discoverTranscripts,
      loadCheckpoint,
      readTranscriptDelta,
      writeSessionSnapshot,
      writeCheckpoint,
      dropTranscriptCursorCacheEntry,
    })

    expect(writeSessionSnapshot).not.toHaveBeenCalled()
    expect(writeCheckpoint).toHaveBeenCalledTimes(1)
    expect(writeCheckpoint).toHaveBeenCalledWith(
      "C:/claude/cache/checkpoints",
      expect.any(String),
      { filePath: "C:/tmp/empty.jsonl", offset: 0 },
    )
    expect(dropTranscriptCursorCacheEntry).toHaveBeenCalledWith("C:/tmp/empty.jsonl")
  })

  it("does NOT re-write the checkpoint on empty deltas when one already exists, but still drops the cache", () => {
    const discoverTranscripts = vi.fn(() => ["C:/tmp/empty.jsonl"])
    const loadCheckpoint = vi.fn(() => ({ filePath: "C:/tmp/empty.jsonl", offset: 128 }))
    const readTranscriptDelta = vi.fn(() => ({ lines: [], nextOffset: 128 }))
    const writeSessionSnapshot = vi.fn()
    const writeCheckpoint = vi.fn()
    const dropTranscriptCursorCacheEntry = vi.fn(() => true)

    runWatchCycle({
      getDefaultConfig: () =>
        ({
          projectsDir: "C:/claude/projects",
          checkpointsDir: "C:/claude/cache/checkpoints",
          snapshotsDir: "C:/claude/cache/snapshots",
          indexFile: "C:/claude/cache/index.json",
        }) as any,
      discoverTranscripts,
      loadCheckpoint,
      readTranscriptDelta,
      writeSessionSnapshot,
      writeCheckpoint,
      dropTranscriptCursorCacheEntry,
    })

    expect(writeCheckpoint).not.toHaveBeenCalled()
    expect(writeSessionSnapshot).not.toHaveBeenCalled()
    expect(dropTranscriptCursorCacheEntry).toHaveBeenCalledWith("C:/tmp/empty.jsonl")
  })
})
