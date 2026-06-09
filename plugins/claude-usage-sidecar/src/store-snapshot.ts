import { mkdirSync, renameSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { toPersistedSessionSnapshot } from "./aggregate-session-state.js"
import type {
  SessionRuntimeState,
  SessionSnapshot,
  StreamCheckpoint,
} from "./types.js"

const atomicWriteJson = (targetFile: string, value: unknown): void => {
  mkdirSync(path.dirname(targetFile), { recursive: true })

  const tempFile = `${targetFile}.tmp`
  writeFileSync(tempFile, JSON.stringify(value, null, 2), "utf8")
  renameSync(tempFile, targetFile)
}

export const writeSessionSnapshot = (
  snapshotsDir: string,
  snapshot: SessionRuntimeState | SessionSnapshot,
): void => {
  const persistedSnapshot =
    "openToolCalls" in snapshot
      ? toPersistedSessionSnapshot(snapshot)
      : snapshot

  atomicWriteJson(
    path.join(snapshotsDir, `${persistedSnapshot.sessionId}.json`),
    persistedSnapshot,
  )
}

export const writeCheckpoint = (
  checkpointsDir: string,
  streamKey: string,
  checkpoint: StreamCheckpoint,
): void => {
  atomicWriteJson(path.join(checkpointsDir, `${streamKey}.json`), checkpoint)
}
