import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { readTranscriptDelta } from "./watch-transcript-stream.js"

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe("readTranscriptDelta", () => {
  it("returns only newly appended lines and updates the byte offset", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "usage-sidecar-watch-"))
    tempRoots.push(root)
    const file = path.join(root, "session.jsonl")

    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, '{"a":1}\n')

    const first = readTranscriptDelta(file, 0)
    appendFileSync(file, '{"b":2}\n')
    const second = readTranscriptDelta(file, first.nextOffset)

    expect(first.lines).toEqual(['{"a":1}'])
    expect(second.lines).toEqual(['{"b":2}'])
  })
})
