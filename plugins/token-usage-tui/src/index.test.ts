import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, it } from "vitest"
import { createInitialSkillState, scanSkillSizes } from "./index"

describe("scanSkillSizes", () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("counts UTF-8 text by characters instead of bytes", () => {
    const worktree = mkdtempSync(join(tmpdir(), "usage-hud-worktree-"))
    tempDirs.push(worktree)

    const skillDir = join(worktree, ".opencode", "skills", "zh-skill")
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, "SKILL.md"), "你好abc", "utf8")

    const result = scanSkillSizes(worktree, { homeDir: join(worktree, "fake-home") })
    const skill = result.sizes.find((item) => item.name === "zh-skill")

    expect(skill).toBeDefined()
    expect(skill?.chars).toBe("你好abc".length)
    expect(skill?.estTokens).toBe(Math.ceil("你好abc".length / 4))
  })

  it("does not scan global skills unless explicitly enabled", () => {
    const root = mkdtempSync(join(tmpdir(), "usage-hud-roots-"))
    tempDirs.push(root)

    const worktree = join(root, "worktree")
    const homeDir = join(root, "home")

    const localSkill = join(worktree, ".opencode", "skills", "local-skill")
    mkdirSync(localSkill, { recursive: true })
    writeFileSync(join(localSkill, "SKILL.md"), "local only", "utf8")

    const globalSkill = join(homeDir, ".claude", "skills", "private-skill")
    mkdirSync(globalSkill, { recursive: true })
    writeFileSync(join(globalSkill, "SKILL.md"), "secret", "utf8")

    const result = scanSkillSizes(worktree, { homeDir })

    expect(result.names).toContain("local-skill")
    expect(result.names).not.toContain("private-skill")
  })

  it("uses an empty initial skill state on startup", () => {
    expect(createInitialSkillState()).toEqual({
      names: [],
      sizes: [],
    })
  })
})
