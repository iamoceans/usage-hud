import * as fs from "node:fs"
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createInitialTranscriptCursor, readTranscriptDelta } from "./watch-transcript-stream.js"

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

    const first = readTranscriptDelta(file, createInitialTranscriptCursor())
    appendFileSync(file, '{"b":2}\n')
    const second = readTranscriptDelta(file, first.cursor)

    expect(first.lines).toEqual(['{"a":1}'])
    expect(second.lines).toEqual(['{"b":2}'])
    expect(second.cursor.offset).toBe(Buffer.byteLength('{"a":1}\n{"b":2}\n'))
  })

  it("does not return an unterminated trailing line or advance past it", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "usage-sidecar-watch-"))
    tempRoots.push(root)
    const file = path.join(root, "session.jsonl")

    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, '{"a":1}\n{"b":2}')

    const first = readTranscriptDelta(file, createInitialTranscriptCursor())

    expect(first.lines).toEqual(['{"a":1}'])
    expect(first.cursor.offset).toBe(Buffer.byteLength('{"a":1}\n'))

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

    const first = readTranscriptDelta(file, createInitialTranscriptCursor())
    const restoredCursor = JSON.parse(JSON.stringify(first.cursor))

    writeFileSync(file, '{"b":2}\n')
    utimesSync(file, new Date(), new Date(Date.now() + 1000))

    const second = readTranscriptDelta(file, restoredCursor)

    expect(second.lines).toEqual(['{"b":2}'])
    expect(second.cursor.offset).toBe(Buffer.byteLength('{"b":2}\n'))
  })

  it("returns an empty delta when the file is temporarily unavailable during stat", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "usage-sidecar-watch-"))
    tempRoots.push(root)
    const file = path.join(root, "session.jsonl")

    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, '{"a":1}\n')

    const first = readTranscriptDelta(file, createInitialTranscriptCursor())

    rmSync(file)

    const second = readTranscriptDelta(file, first.cursor)

    expect(second.lines).toEqual([])
    expect(second.cursor).toEqual(first.cursor)
  })

  it("reads appended bytes from the current offset instead of re-reading the whole file", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "usage-sidecar-watch-"))
    tempRoots.push(root)
    const file = path.join(root, "session.jsonl")
    const firstLine = `${"a".repeat(96)}\n`
    const secondLine = `${"b".repeat(12)}\n`
    const readPositions: number[] = []

    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, firstLine)

    const first = readTranscriptDelta(file, createInitialTranscriptCursor())
    appendFileSync(file, secondLine)

    const second = readTranscriptDelta(file, first.cursor, {
      statSync: fs.statSync,
      openSync: fs.openSync,
      readSync: (fd, buffer, offset, length, position) => {
        if (typeof position === "number") {
          readPositions.push(position)
        }

        return fs.readSync(fd, buffer, offset, length, position)
      },
      closeSync: fs.closeSync,
    })

    expect(second.lines).toEqual([secondLine.trimEnd()])
    expect(readPositions).toContain(first.cursor.offset)
    expect(readPositions).not.toContain(0)
    expect(second.cursor.offset).toBe(firstLine.length + secondLine.length)
  })

  it("returns an empty delta when reading the file fails temporarily", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "usage-sidecar-watch-"))
    const file = path.join(root, "session.jsonl")

    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, '{"a":1}\n')

    const first = readTranscriptDelta(file, createInitialTranscriptCursor())
    const second = readTranscriptDelta(file, first.cursor, {
      statSync: fs.statSync,
      openSync: fs.openSync,
      readSync: () => {
        throw new Error("file is temporarily locked")
      },
      closeSync: fs.closeSync,
    })

    expect(second.lines).toEqual([])
    expect(second.cursor).toEqual(first.cursor)
  })
})
