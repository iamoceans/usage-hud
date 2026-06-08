import { describe, expect, it } from "vitest"
import { getDefaultConfig } from "./config.js"

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
