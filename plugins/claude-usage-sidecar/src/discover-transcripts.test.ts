import { describe, expect, it } from "vitest"
import { getDefaultConfig } from "./config.js"

describe("getDefaultConfig", () => {
  it("builds the default Claude paths from the provided home directory", () => {
    const config = getDefaultConfig({ homeDir: "C:/Users/admin" })

    expect(config.claudeDir).toBe("C:/Users/admin/.claude")
    expect(config.projectsDir).toBe("C:/Users/admin/.claude/projects")
    expect(config.cacheDir).toBe("C:/Users/admin/.claude/cache/usage-hud")
    expect(config.pollMs).toBe(1000)
  })
})
