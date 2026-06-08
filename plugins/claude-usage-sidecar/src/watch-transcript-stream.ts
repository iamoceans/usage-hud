import {
  closeSync,
  openSync,
  readSync,
  statSync,
  type Stats,
} from "node:fs"

type TranscriptCursor = {
  offset: number
  size: number
  lastModifiedMs: number
  fileIdentity: string
  tailFingerprint: string
}

type TranscriptFileAccess = {
  statSync: typeof statSync
  openSync: typeof openSync
  readSync: typeof readSync
  closeSync: typeof closeSync
}

export type TranscriptDelta = {
  lines: string[]
  nextOffset: number
}

const DEFAULT_FILE_ACCESS: TranscriptFileAccess = {
  statSync,
  openSync,
  readSync,
  closeSync,
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

const getFileIdentity = (fileStat: Stats): string => `${fileStat.dev}:${fileStat.ino}:${fileStat.birthtimeMs}`
const transcriptCursorCache = new Map<string, TranscriptCursor>()

const readRange = (
  filePath: string,
  startOffset: number,
  length: number,
  fileAccess: TranscriptFileAccess,
): Buffer => {
  if (length <= 0) {
    return Buffer.alloc(0)
  }

  const fileDescriptor = fileAccess.openSync(filePath, "r")

  try {
    const buffer = Buffer.alloc(length)
    let bytesReadTotal = 0

    while (bytesReadTotal < length) {
      const bytesRead = fileAccess.readSync(
        fileDescriptor,
        buffer,
        bytesReadTotal,
        length - bytesReadTotal,
        startOffset + bytesReadTotal,
      )

      if (bytesRead === 0) {
        return buffer.subarray(0, bytesReadTotal)
      }

      bytesReadTotal += bytesRead
    }

    return buffer
  } finally {
    fileAccess.closeSync(fileDescriptor)
  }
}

const readTailFingerprint = (
  filePath: string,
  endOffset: number,
  fileAccess: TranscriptFileAccess,
): string => {
  if (endOffset <= 0) {
    return ""
  }

  const tailStart = Math.max(0, endOffset - 64)
  return readRange(filePath, tailStart, endOffset - tailStart, fileAccess).toString("base64")
}

const isResetFile = (
  filePath: string,
  cursor: TranscriptCursor,
  fileStat: Stats,
  fileIdentity: string,
  fileAccess: TranscriptFileAccess,
): boolean => {
  if (cursor.offset > fileStat.size || cursor.size > fileStat.size) {
    return true
  }

  if (cursor.fileIdentity.length > 0 && cursor.fileIdentity !== fileIdentity) {
    return true
  }

  if (cursor.lastModifiedMs === 0 || cursor.lastModifiedMs === fileStat.mtimeMs) {
    return false
  }

  return cursor.tailFingerprint !== readTailFingerprint(filePath, cursor.offset, fileAccess)
}

const emptyDelta = (cursor: TranscriptCursor): TranscriptDelta => ({
  lines: [],
  nextOffset: cursor.offset,
})

export const readTranscriptDelta = (
  filePath: string,
  offset: number,
  fileAccess: TranscriptFileAccess = DEFAULT_FILE_ACCESS,
): TranscriptDelta => {
  const cachedCursor = transcriptCursorCache.get(filePath)
  const cursor =
    cachedCursor != null && cachedCursor.offset === offset ? cachedCursor : createCursor(offset)
  let fileStat: Stats

  try {
    fileStat = fileAccess.statSync(filePath)
  } catch {
    return emptyDelta(cursor)
  }

  try {
    const fileIdentity = getFileIdentity(fileStat)
    const startOffset = isResetFile(filePath, cursor, fileStat, fileIdentity, fileAccess) ? 0 : cursor.offset
    const chunk = readRange(filePath, startOffset, fileStat.size - startOffset, fileAccess).toString("utf8")
    const lastNewlineIndex = chunk.lastIndexOf("\n")

    if (lastNewlineIndex < 0) {
      const nextCursor = createCursor(
        startOffset,
        fileStat.size,
        fileStat.mtimeMs,
        fileIdentity,
        startOffset === cursor.offset ? cursor.tailFingerprint : "",
      )

      transcriptCursorCache.set(filePath, nextCursor)
      return emptyDelta(nextCursor)
    }

    const consumedChunk = chunk.slice(0, lastNewlineIndex + 1)
    const nextOffset = startOffset + Buffer.byteLength(consumedChunk)
    const lines = consumedChunk
      .slice(0, -1)
      .split("\n")
      .filter((line) => line.length > 0)

    transcriptCursorCache.set(
      filePath,
      createCursor(
        nextOffset,
        fileStat.size,
        fileStat.mtimeMs,
        fileIdentity,
        readTailFingerprint(filePath, nextOffset, fileAccess),
      ),
    )

    return {
      lines,
      nextOffset,
    }
  } catch {
    return emptyDelta(cursor)
  }
}
