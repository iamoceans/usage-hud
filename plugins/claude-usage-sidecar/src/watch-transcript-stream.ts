import {
  closeSync,
  openSync,
  readSync,
  statSync,
  type Stats,
} from "node:fs"

export type TranscriptCursor = {
  offset: number
  size: number
  lastModifiedMs: number
  fileIdentity: string
  tailFingerprint: string
}

export type TranscriptFileAccess = {
  statSync: typeof statSync
  openSync: typeof openSync
  readSync: typeof readSync
  closeSync: typeof closeSync
}

export type TranscriptDelta = {
  lines: string[]
  cursor: TranscriptCursor
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

export const createInitialTranscriptCursor = (): TranscriptCursor => createCursor(0)

const getFileIdentity = (fileStat: Stats): string => `${fileStat.dev}:${fileStat.ino}:${fileStat.birthtimeMs}`

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
  cursor,
})

export const readTranscriptDelta = (
  filePath: string,
  cursor: TranscriptCursor,
  fileAccess: TranscriptFileAccess = DEFAULT_FILE_ACCESS,
): TranscriptDelta => {
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
      return emptyDelta(
        createCursor(
          startOffset,
          fileStat.size,
          fileStat.mtimeMs,
          fileIdentity,
          startOffset === cursor.offset ? cursor.tailFingerprint : "",
        ),
      )
    }

    const consumedChunk = chunk.slice(0, lastNewlineIndex + 1)
    const nextOffset = startOffset + Buffer.byteLength(consumedChunk)
    const lines = consumedChunk
      .slice(0, -1)
      .split("\n")
      .filter((line) => line.length > 0)

    return {
      lines,
      cursor: createCursor(
        nextOffset,
        fileStat.size,
        fileStat.mtimeMs,
        fileIdentity,
        readTailFingerprint(filePath, nextOffset, fileAccess),
      ),
    }
  } catch {
    return emptyDelta(cursor)
  }
}
