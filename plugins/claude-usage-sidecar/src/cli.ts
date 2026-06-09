#!/usr/bin/env node

import { readFileSync } from "node:fs"
import * as path from "node:path"
import { pathToFileURL } from "node:url"
import { getDefaultConfig } from "./config.js"
import { fetchUsageSummary, mergeUsageIntoSnapshot } from "./fetch-usage.js"
import { renderSessionReport } from "./report-session.js"
import type { SessionIndex, SessionIndexEntry, SessionSnapshot, SidecarConfig } from "./types.js"

type CliIO = {
  stdout: {
    write: (chunk: string) => void
  }
  stderr: {
    write: (chunk: string) => void
  }
}

type CliDeps = {
  readFileSync: typeof readFileSync
  getDefaultConfig: typeof getDefaultConfig
  fetchUsageSummary: typeof fetchUsageSummary
}

const usageText =
  "usage: claude-usage-sidecar report --session <session-id>\n" +
  "       claude-usage-sidecar report --latest\n"

const toSnapshotFileName = (sessionId: string): string =>
  `${encodeURIComponent(sessionId)}.json`

const readSnapshot = (
  snapshotFile: string,
  deps: CliDeps,
): SessionSnapshot => JSON.parse(deps.readFileSync(snapshotFile, "utf8")) as SessionSnapshot

const isSafeSnapshotFile = (value: string): boolean =>
  value.trim().length > 0 &&
  value.endsWith(".json") &&
  !path.isAbsolute(value) &&
  path.basename(value) === value &&
  !value.includes("..") &&
  !value.includes("/") &&
  !value.includes("\\")

const readIndex = (indexFile: string, deps: CliDeps): SessionIndex => {
  const parsed = JSON.parse(deps.readFileSync(indexFile, "utf8")) as unknown

  if (typeof parsed !== "object" || parsed === null || !("sessions" in parsed)) {
    throw new Error("index.json is malformed")
  }

  const sessions = (parsed as { sessions: unknown }).sessions

  if (!Array.isArray(sessions)) {
    throw new Error("index.json is malformed")
  }

  const normalizedSessions = sessions.filter(
    (entry): entry is SessionIndexEntry =>
      typeof entry === "object" &&
      entry !== null &&
      typeof entry.sessionId === "string" &&
      typeof entry.snapshotFile === "string" &&
      isSafeSnapshotFile(entry.snapshotFile) &&
      ("startedAt" in entry ? entry.startedAt === null || typeof entry.startedAt === "string" : false) &&
      ("lastActivityAt" in entry
        ? entry.lastActivityAt === null || typeof entry.lastActivityAt === "string"
        : false),
  )

  return { sessions: normalizedSessions }
}

const scoreIndexEntry = (entry: SessionIndexEntry): number => {
  const lastActivityScore =
    entry.lastActivityAt === null ? Number.NEGATIVE_INFINITY : Date.parse(entry.lastActivityAt)

  if (Number.isFinite(lastActivityScore)) {
    return lastActivityScore
  }

  const startedAtScore =
    entry.startedAt === null ? Number.NEGATIVE_INFINITY : Date.parse(entry.startedAt)

  return Number.isFinite(startedAtScore) ? startedAtScore : Number.NEGATIVE_INFINITY
}

const resolveSnapshotFile = (
  argv: string[],
  config: SidecarConfig,
  deps: CliDeps,
): string | null => {
  if (argv[3] === "--latest") {
    const index = readIndex(config.indexFile, deps)

    if (!Array.isArray(index.sessions) || index.sessions.length === 0) {
      throw new Error("index.json does not contain any sessions")
    }

    const latestEntry = [...index.sessions].sort(
      (left, right) => scoreIndexEntry(right) - scoreIndexEntry(left),
    )[0]

    if (latestEntry === undefined || latestEntry.snapshotFile.trim().length === 0) {
      throw new Error("index.json does not contain a valid latest snapshot")
    }

    return path.join(config.snapshotsDir, latestEntry.snapshotFile)
  }

  const sessionFlagIndex = argv.indexOf("--session")

  if (sessionFlagIndex >= 0) {
    const sessionId = argv[sessionFlagIndex + 1]

    if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
      return null
    }

    return path.join(config.snapshotsDir, toSnapshotFileName(sessionId))
  }

  return null
}

export const runCli = (
  argv: string[],
  options?: {
    io?: CliIO
    deps?: Partial<CliDeps>
  },
): Promise<number> => {
  const io = options?.io ?? process
  const deps: CliDeps = {
    readFileSync: options?.deps?.readFileSync ?? readFileSync,
    getDefaultConfig: options?.deps?.getDefaultConfig ?? getDefaultConfig,
    fetchUsageSummary: options?.deps?.fetchUsageSummary ?? fetchUsageSummary,
  }
  const [, , command] = argv

  if (command !== "report") {
    io.stdout.write(usageText)
    return Promise.resolve(1)
  }

  return (async () => {
    try {
    const config = deps.getDefaultConfig()
    const snapshotFile = resolveSnapshotFile(argv, config, deps)

    if (snapshotFile === null) {
      io.stdout.write(usageText)
      return 1
    }

      const snapshot = readSnapshot(snapshotFile, deps)
      const usage = await deps.fetchUsageSummary({
        usageCacheFile: config.usageCacheFile,
        claudeDir: config.claudeDir,
      })
      const mergedSnapshot = mergeUsageIntoSnapshot(snapshot, usage)

      io.stdout.write(`${renderSessionReport(mergedSnapshot)}\n`)
    return 0
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      io.stderr.write(`failed to render report: ${message}\n`)
      return 1
    }
  })()
}

const isDirectExecution =
  typeof process.argv[1] === "string" &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url

if (isDirectExecution) {
  void runCli(process.argv).then((exitCode) => {
    process.exitCode = exitCode
  })
}
