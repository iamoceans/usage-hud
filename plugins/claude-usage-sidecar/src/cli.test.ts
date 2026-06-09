import { describe, expect, it } from "vitest"
import * as path from "node:path"
import { runCli } from "./cli.js"
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
