import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { getDefaultConfig } from "./config.js"
import { discoverTranscripts } from "./discover-transcripts.js"

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe("getDefaultConfig", () => {
  it("builds the default Claude paths from the provided home directory", () => {
    const config = getDefaultConfig({ homeDir: "C:/Users/admin" })

    expect(config.claudeDir).toBe("C:/Users/admin/.claude")
    expect(config.projectsDir).toBe("C:/Users/admin/.claude/projects")
    expect(config.cacheDir).toBe("C:/Users/admin/.claude/cache/usage-hud")
    expect(config.checkpointsDir).toBe("C:/Users/admin/.claude/cache/usage-hud/checkpoints")
    expect(config.snapshotsDir).toBe("C:/Users/admin/.claude/cache/usage-hud/snapshots")
    expect(config.indexFile).toBe("C:/Users/admin/.claude/cache/usage-hud/index.json")
    expect(config.usageCacheFile).toBe("C:/Users/admin/.claude/cache/usage-hud/usage-cache.json")
    expect(config.pollMs).toBe(1000)
  })

  it("normalizes Windows-style backslash home paths", () => {
    const config = getDefaultConfig({ homeDir: "C:\\Users\\admin" })

    expect(config.homeDir).toBe("C:/Users/admin")
    expect(config.claudeDir).toBe("C:/Users/admin/.claude")
    expect(config.checkpointsDir).toBe("C:/Users/admin/.claude/cache/usage-hud/checkpoints")
    expect(config.snapshotsDir).toBe("C:/Users/admin/.claude/cache/usage-hud/snapshots")
    expect(config.indexFile).toBe("C:/Users/admin/.claude/cache/usage-hud/index.json")
    expect(config.usageCacheFile).toBe("C:/Users/admin/.claude/cache/usage-hud/usage-cache.json")
  })

  it("throws when no home directory can be resolved", () => {
    expect(() => getDefaultConfig({ homeDir: "" })).toThrow(
      "Unable to resolve Claude home directory. Pass homeDir explicitly or set USERPROFILE/HOME.",
    )
  })
})

describe("discoverTranscripts", () => {
  it("finds jsonl transcripts recursively under the projects directory", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "usage-sidecar-discover-"))
    tempRoots.push(root)
    const sessionDir = path.join(root, "D--Example")

    mkdirSync(path.join(sessionDir, "nested"), { recursive: true })
    writeFileSync(path.join(sessionDir, "abc.jsonl"), "")
    writeFileSync(path.join(sessionDir, "ignore.txt"), "")
    writeFileSync(path.join(sessionDir, "nested", "def.jsonl"), "")

    expect(discoverTranscripts(root)).toEqual([
      path.join(sessionDir, "abc.jsonl"),
      path.join(sessionDir, "nested", "def.jsonl"),
    ])
  })
})
