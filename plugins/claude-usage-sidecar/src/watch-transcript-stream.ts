import { readFileSync, statSync, type Stats } from "node:fs"

export type TranscriptCursor = {
  offset: number
  size: number
  lastModifiedMs: number
  fileIdentity: string
  tailFingerprint: string
}

export type TranscriptFileAccess = {
  statSync: typeof statSync
  readFileSync: typeof readFileSync
}

export type TranscriptDelta = {
  lines: string[]
  nextOffset: number
  cursor: TranscriptCursor
}

const DEFAULT_FILE_ACCESS: TranscriptFileAccess = {
  statSync,
  readFileSync,
}

const createCursor = (
  offset: number,
  size = offset,
  lastModifiedMs = 0,
  fileIdentity = "",
  tailFingerprint = "",
): TranscriptCursor => ({
  offset,
  size,
  lastModifiedMs,
  fileIdentity,
  tailFingerprint,
})

const normalizeCursor = (cursorOrOffset: number | TranscriptCursor): TranscriptCursor =>
  typeof cursorOrOffset === "number" ? createCursor(cursorOrOffset) : cursorOrOffset

const getFileIdentity = (fileStat: Stats): string => `${fileStat.dev}:${fileStat.ino}:${fileStat.birthtimeMs}`

const getTailFingerprint = (buffer: Buffer, endOffset: number): string => {
  const tailStart = Math.max(0, endOffset - 64)
  return buffer.subarray(tailStart, endOffset).toString("base64")
}

const isResetFile = (
  cursor: TranscriptCursor,
  fileStat: Stats,
  buffer: Buffer,
  fileIdentity: string,
): boolean => {
  if (cursor.offset > buffer.length || cursor.size > buffer.length) {
    return true
  }

  if (cursor.fileIdentity.length > 0 && cursor.fileIdentity !== fileIdentity) {
    return true
  }

  if (cursor.lastModifiedMs === 0 || cursor.size !== buffer.length || cursor.lastModifiedMs === fileStat.mtimeMs) {
    return false
  }

  return cursor.tailFingerprint !== getTailFingerprint(buffer, Math.min(cursor.offset, buffer.length))
}

const emptyDelta = (cursor: TranscriptCursor): TranscriptDelta => ({
  lines: [],
  nextOffset: cursor.offset,
  cursor,
})

export const readTranscriptDelta = (
  filePath: string,
  cursorOrOffset: number | TranscriptCursor,
  fileAccess: TranscriptFileAccess = DEFAULT_FILE_ACCESS,
): TranscriptDelta => {
  const previousCursor = normalizeCursor(cursorOrOffset)
  let fileStat: Stats

  try {
    fileStat = fileAccess.statSync(filePath)
  } catch {
    return emptyDelta(previousCursor)
  }

  let buffer: Buffer

  try {
    buffer = fileAccess.readFileSync(filePath)
  } catch {
    return emptyDelta(previousCursor)
  }

  const fileIdentity = getFileIdentity(fileStat)
  const startOffset = isResetFile(previousCursor, fileStat, buffer, fileIdentity) ? 0 : previousCursor.offset
  const chunk = buffer.subarray(startOffset).toString("utf8")
  const lastNewlineIndex = chunk.lastIndexOf("\n")

  if (lastNewlineIndex < 0) {
    const cursor = createCursor(
      startOffset,
      buffer.length,
      fileStat.mtimeMs,
      fileIdentity,
      getTailFingerprint(buffer, startOffset),
    )

    return emptyDelta(cursor)
  }

  const consumedChunk = chunk.slice(0, lastNewlineIndex + 1)
  const nextOffset = startOffset + Buffer.byteLength(consumedChunk)
  const lines = consumedChunk
    .slice(0, -1)
    .split("\n")
    .filter((line) => line.length > 0)
  const cursor = createCursor(
    nextOffset,
    buffer.length,
    fileStat.mtimeMs,
    fileIdentity,
    getTailFingerprint(buffer, nextOffset),
  )

  return {
    lines,
    nextOffset,
    cursor,
  }
}
