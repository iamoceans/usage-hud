import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import * as path from "node:path"
import { toPersistedSessionSnapshot } from "./aggregate-session-state.js"
import type {
  SessionIndex,
  SessionIndexEntry,
  SessionRuntimeState,
  SessionSnapshot,
  StreamCheckpoint,
} from "./types.js"

const atomicWriteJson = (targetFile: string, value: unknown): void => {
  mkdirSync(path.dirname(targetFile), { recursive: true })

  const tempFile = `${targetFile}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`

  try {
    writeFileSync(tempFile, JSON.stringify(value, null, 2), "utf8")
    renameSync(tempFile, targetFile)
  } catch (error) {
    rmSync(tempFile, { force: true })
    throw error
  }
}

const normalizeSessionId = (sessionId: string): string => {
  if (sessionId.trim().length === 0) {
    throw new Error("sessionId must be a non-empty string")
  }

  return sessionId
}

const toSnapshotFileName = (sessionId: string): string =>
  `${encodeURIComponent(normalizeSessionId(sessionId))}.json`

const readSessionIndex = (indexFile: string): SessionIndex => {
  if (!existsSync(indexFile)) {
    return { sessions: [] }
  }

  const parsed = JSON.parse(readFileSync(indexFile, "utf8")) as unknown

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("sessions" in parsed) ||
    !Array.isArray(parsed.sessions)
  ) {
    return { sessions: [] }
  }

  const sessions = parsed.sessions.filter(
    (entry): entry is SessionIndexEntry =>
      typeof entry === "object" &&
      entry !== null &&
      typeof entry.sessionId === "string" &&
      typeof entry.snapshotFile === "string" &&
      ("startedAt" in entry ? entry.startedAt === null || typeof entry.startedAt === "string" : false) &&
      ("lastActivityAt" in entry
        ? entry.lastActivityAt === null || typeof entry.lastActivityAt === "string"
        : false),
  )

  return { sessions }
}

const upsertSessionIndexEntry = (
  indexFile: string,
  snapshot: SessionSnapshot,
  snapshotFile: string,
): void => {
  const nextEntry: SessionIndexEntry = {
    sessionId: snapshot.sessionId,
    snapshotFile,
    startedAt: snapshot.startedAt,
    lastActivityAt: snapshot.lastActivityAt,
  }
  const current = readSessionIndex(indexFile)
  const remaining = current.sessions.filter(
    (entry) => entry.sessionId !== snapshot.sessionId,
  )

  atomicWriteJson(indexFile, {
    sessions: [...remaining, nextEntry].sort((left, right) =>
      left.sessionId.localeCompare(right.sessionId),
    ),
  } satisfies SessionIndex)
}

export const writeSessionSnapshot = (
  snapshotsDir: string,
  snapshot: SessionRuntimeState | SessionSnapshot,
  options?: {
    indexFile?: string
  },
): void => {
  const persistedSnapshot =
    "openToolCalls" in snapshot
      ? toPersistedSessionSnapshot(snapshot)
      : snapshot
  const snapshotFile = toSnapshotFileName(persistedSnapshot.sessionId)

  atomicWriteJson(path.join(snapshotsDir, snapshotFile), persistedSnapshot)

  if (typeof options?.indexFile === "string" && options.indexFile.length > 0) {
    upsertSessionIndexEntry(options.indexFile, persistedSnapshot, snapshotFile)
  }
}

export const writeCheckpoint = (
  checkpointsDir: string,
  streamKey: string,
  checkpoint: StreamCheckpoint,
): void => {
  atomicWriteJson(path.join(checkpointsDir, `${streamKey}.json`), checkpoint)
}
