import { readFileSync, statSync } from "node:fs"

export type TranscriptDelta = {
  lines: string[]
  nextOffset: number
}

export const readTranscriptDelta = (filePath: string, offset: number): TranscriptDelta => {
  const fileStat = statSync(filePath)
  const safeOffset = offset > fileStat.size ? 0 : offset
  const buffer = readFileSync(filePath)
  const chunk = buffer.subarray(safeOffset).toString("utf8")

  return {
    lines: chunk.split("\n").filter((line) => line.length > 0),
    nextOffset: fileStat.size,
  }
}
