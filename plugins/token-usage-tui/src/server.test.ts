import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, it } from "vitest"
import { sidecarPath } from "./paths"
import { TokenUsageServerPlugin } from "./server"

describe("TokenUsageServerPlugin", () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("does not write a sidecar record when no skill blocks are present", async () => {
    const worktree = mkdtempSync(join(tmpdir(), "usage-hud-server-"))
    tempDirs.push(worktree)

    const plugin = await TokenUsageServerPlugin({ worktree } as any)
    await plugin["experimental.chat.system.transform"]?.(
      { sessionID: "session-1", model: { id: "model-a" } } as any,
      { system: ["plain system prompt without skills"] } as any
    )

    expect(existsSync(sidecarPath(worktree, "session-1"))).toBe(false)
  })

  it("starts turn numbering from 1 for each fresh plugin instance", async () => {
    const worktree = mkdtempSync(join(tmpdir(), "usage-hud-server-"))
    tempDirs.push(worktree)

    const first = await TokenUsageServerPlugin({ worktree } as any)
    await first["experimental.chat.system.transform"]?.(
      { sessionID: "session-a", model: { id: "model-a" } } as any,
      { system: ["<skill><name>alpha</name>prompt</skill>"] } as any
    )

    const second = await TokenUsageServerPlugin({ worktree } as any)
    await second["experimental.chat.system.transform"]?.(
      { sessionID: "session-b", model: { id: "model-a" } } as any,
      { system: ["<skill><name>beta</name>prompt</skill>"] } as any
    )

    const record = JSON.parse(readFileSync(sidecarPath(worktree, "session-b"), "utf8").trim())
    expect(record.turn).toBe(1)
  })
})
