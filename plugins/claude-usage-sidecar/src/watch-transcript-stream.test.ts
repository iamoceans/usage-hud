import * as fs from "node:fs"
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
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
    const second = readTranscriptDelta(file, first.cursor)

    expect(first.lines).toEqual(['{"a":1}'])
    expect(second.lines).toEqual(['{"b":2}'])
  })

  it("does not return an unterminated trailing line or advance past it", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "usage-sidecar-watch-"))
    tempRoots.push(root)
    const file = path.join(root, "session.jsonl")

    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, '{"a":1}\n{"b":2}')

    const first = readTranscriptDelta(file, 0)

    expect(first.lines).toEqual(['{"a":1}'])
    expect(first.nextOffset).toBe(Buffer.byteLength('{"a":1}\n'))

    appendFileSync(file, '\n{"c":3}\n')

    const second = readTranscriptDelta(file, first.cursor)

    expect(second.lines).toEqual(['{"b":2}', '{"c":3}'])
  })

  it("resets from the beginning when the transcript file is rewritten in place", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "usage-sidecar-watch-"))
    tempRoots.push(root)
    const file = path.join(root, "session.jsonl")

    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, '{"a":1}\n')

    const first = readTranscriptDelta(file, 0)

    writeFileSync(file, '{"b":2}\n')
    utimesSync(file, new Date(), new Date(Date.now() + 1000))

    const second = readTranscriptDelta(file, first.cursor)

    expect(second.lines).toEqual(['{"b":2}'])
    expect(second.nextOffset).toBe(Buffer.byteLength('{"b":2}\n'))
  })

  it("returns an empty delta when the file is temporarily unavailable during stat", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "usage-sidecar-watch-"))
    tempRoots.push(root)
    const file = path.join(root, "session.jsonl")

    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, '{"a":1}\n')

    const first = readTranscriptDelta(file, 0)

    rmSync(file)

    const second = readTranscriptDelta(file, first.cursor)

    expect(second.lines).toEqual([])
    expect(second.nextOffset).toBe(first.nextOffset)
    expect(second.cursor).toEqual(first.cursor)
  })

  it("returns an empty delta when reading the file fails temporarily", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "usage-sidecar-watch-"))
    tempRoots.push(root)
    const file = path.join(root, "session.jsonl")

    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, '{"a":1}\n')

    const first = readTranscriptDelta(file, 0)
    const second = readTranscriptDelta(file, first.cursor, {
      statSync: fs.statSync,
      readFileSync: () => {
        throw new Error("file is temporarily locked")
      },
    })

    expect(second.lines).toEqual([])
    expect(second.nextOffset).toBe(first.nextOffset)
    expect(second.cursor).toEqual(first.cursor)
  })
})
