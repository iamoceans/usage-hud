import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { normalizeWorktreePath, sidecarPath } from "./paths"

describe("sidecarPath", () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("keeps sidecar files inside the sidecar directory", () => {
    const worktree = "D:\\worktree"
    const file = sidecarPath(worktree, "../escape/outside")
    const sidecarDir = join(worktree, ".opencode", ".cache", "token-usage-tui", "sidecar")

    expect(file.startsWith(sidecarDir)).toBe(true)
    expect(file.endsWith(".jsonl")).toBe(true)
  })

  it("normalizes decorated Windows worktree labels back to the real path", () => {
    const worktree = mkdtempSync(join(tmpdir(), "usage-hud-paths-"))
    tempDirs.push(worktree)

    const decorated = `/${worktree}:main`

    expect(normalizeWorktreePath(decorated)).toBe(worktree)
    expect(dirname(sidecarPath(decorated, "session-1"))).toBe(
      join(worktree, ".opencode", ".cache", "token-usage-tui", "sidecar")
    )
  })
})
