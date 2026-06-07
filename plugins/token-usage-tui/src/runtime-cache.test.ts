import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createAggregateReader, createSkillUsageReader } from "./runtime-cache"
import { sidecarPath } from "./paths"

const createMessage = (id: string, created: number) =>
  ({
    id,
    role: "assistant",
    time: { created },
  }) as any

const createSkillReader = (
  worktree: string,
  messages: any[],
  partsByMessage: Record<string, any[]>
) =>
  createSkillUsageReader(
    worktree,
    () => messages,
    (messageID) => partsByMessage[messageID] ?? []
  )

describe("runtime-cache", () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("reuses aggregated session data when message list is unchanged", () => {
    const messages = [
      {
        id: "assistant-1",
        role: "assistant",
        sessionID: "session-1",
        tokens: { input: 12, output: 3, cache: { read: 0, write: 0 } },
      },
    ] as any

    const getParts = vi.fn(() => [{ type: "tool", tool: "read", state: { status: "completed", output: "x" } }] as any)
    const reader = createAggregateReader(
      () => messages,
      getParts
    )

    const first = reader("session-1")
    const second = reader("session-1")

    expect(first).toBe(second)
    expect(getParts).toHaveBeenCalledTimes(1)
  })

  it("re-parses skill sidecar only after the file changes", () => {
    const worktree = mkdtempSync(join(tmpdir(), "usage-hud-runtime-cache-"))
    tempDirs.push(worktree)
    const firstTs = 1_000
    const secondTs = 2_000

    const sidecar = sidecarPath(worktree, "session-1")
    mkdirSync(join(worktree, ".opencode", ".cache", "token-usage-tui", "sidecar"), { recursive: true })
    writeFileSync(
      sidecar,
      JSON.stringify({
        ts: firstTs,
        skills: [{ name: "xlsx", estTokens: 120 }],
      }) + "\n",
      "utf8"
    )

    const messages = [createMessage("assistant-1", firstTs + 100)]
    const reader = createSkillReader(worktree, messages, {
      "assistant-1": [{ type: "tool", tool: "skill", state: { status: "completed", input: { name: "xlsx" } } }],
    })

    const first = reader("session-1")
    const second = reader("session-1")

    expect(second).toBe(first)
    expect(second).toEqual([{ name: "xlsx", totalEstTokens: 120, calls: 1 }])

    writeFileSync(
      sidecar,
      [
        JSON.stringify({
          ts: firstTs,
          skills: [{ name: "xlsx", estTokens: 120 }],
        }),
        JSON.stringify({
          ts: secondTs,
          skills: [{ name: "xlsx", estTokens: 80 }, { name: "docx", estTokens: 30 }],
        }),
      ].join("\n") + "\n",
      "utf8"
    )
    messages[0].time.created = secondTs + 100

    const third = reader("session-1")

    expect(third).not.toBe(second)
    expect(third).toEqual([{ name: "xlsx", totalEstTokens: 100, calls: 1 }])
  })

  it("counts the whole sidecar when the file is created after startup", () => {
    const worktree = mkdtempSync(join(tmpdir(), "usage-hud-runtime-cache-"))
    tempDirs.push(worktree)

    const sidecar = sidecarPath(worktree, "session-2")
    mkdirSync(join(worktree, ".opencode", ".cache", "token-usage-tui", "sidecar"), { recursive: true })

    const messages = [createMessage("assistant-2", Date.now())]
    const reader = createSkillReader(worktree, messages, {
      "assistant-2": [{ type: "tool", tool: "skill", state: { status: "error", input: { name: "xlsx" } } }],
    })

    expect(reader("session-2")).toEqual([{ name: "xlsx", totalEstTokens: 0, calls: 1 }])

    writeFileSync(
      sidecar,
      JSON.stringify({ skills: [{ name: "xlsx", estTokens: 120 }] }) + "\n",
      "utf8"
    )

    expect(reader("session-2")).toEqual([{ name: "xlsx", totalEstTokens: 120, calls: 1 }])
  })

  it("still shows real skill calls when the sidecar file is missing", () => {
    const worktree = mkdtempSync(join(tmpdir(), "usage-hud-runtime-cache-"))
    tempDirs.push(worktree)

    const messages = [createMessage("assistant-missing", Date.now())]
    const reader = createSkillReader(worktree, messages, {
      "assistant-missing": [{ type: "tool", tool: "tool:skill", state: { status: "completed", input: { name: "aihot" } } }],
    })

    expect(reader("session-missing")).toEqual([{ name: "aihot", totalEstTokens: 0, calls: 1 }])
  })

  it("reads the full session sidecar even when the first read happens after later turns", () => {
    const worktree = mkdtempSync(join(tmpdir(), "usage-hud-runtime-cache-"))
    tempDirs.push(worktree)

    const sidecar = sidecarPath(worktree, "session-3")
    mkdirSync(join(worktree, ".opencode", ".cache", "token-usage-tui", "sidecar"), { recursive: true })
    writeFileSync(
      sidecar,
      JSON.stringify({
        ts: Date.now() - 10_000,
        skills: [{ name: "xlsx", estTokens: 120 }],
      }) + "\n",
      "utf8"
    )

    const messages = [
      createMessage("assistant-3a", Date.now() - 9_000),
      createMessage("assistant-3b", Date.now() + 2_000),
    ]
    const reader = createSkillReader(worktree, messages, {
      "assistant-3a": [{ type: "tool", tool: "skill", state: { status: "completed", input: { name: "xlsx" } } }],
      "assistant-3b": [{ type: "tool", tool: "skill", state: { status: "running", input: { name: "aihot" } } }],
    })

    writeFileSync(
      sidecar,
      [
        JSON.stringify({
          ts: Date.now() - 10_000,
          skills: [{ name: "xlsx", estTokens: 120 }],
        }),
        JSON.stringify({
          ts: Date.now() + 1_000,
          skills: [{ name: "aihot", estTokens: 170 }],
        }),
      ].join("\n") + "\n",
      "utf8"
    )

    expect(reader("session-3")).toEqual([
      { name: "aihot", totalEstTokens: 170, calls: 1 },
      { name: "xlsx", totalEstTokens: 120, calls: 1 },
    ])
  })

  it("reads existing session sidecar content on first access", () => {
    const worktree = mkdtempSync(join(tmpdir(), "usage-hud-runtime-cache-"))
    tempDirs.push(worktree)

    const sidecar = sidecarPath(worktree, "session-4")
    mkdirSync(join(worktree, ".opencode", ".cache", "token-usage-tui", "sidecar"), { recursive: true })

    writeFileSync(
      sidecar,
      JSON.stringify({
        ts: Date.now(),
        skills: [{ name: "aihot", estTokens: 170 }],
      }) + "\n",
      "utf8"
    )

    const messages = [createMessage("assistant-4", Date.now() + 1_000)]
    const reader = createSkillReader(worktree, messages, {
      "assistant-4": [{ type: "tool", tool: "skill", state: { status: "completed", input: { name: "aihot" } } }],
    })

    expect(reader("session-4")).toEqual([{ name: "aihot", totalEstTokens: 170, calls: 1 }])
  })

  it("does not discard existing records for a session-scoped sidecar file", () => {
    const worktree = mkdtempSync(join(tmpdir(), "usage-hud-runtime-cache-"))
    tempDirs.push(worktree)
    const firstTs = 1_000
    const secondTs = 2_000

    const sidecar = sidecarPath(worktree, "session-5")
    mkdirSync(join(worktree, ".opencode", ".cache", "token-usage-tui", "sidecar"), { recursive: true })
    const content =
      [
        JSON.stringify({
          ts: firstTs,
          skills: [{ name: "xlsx", estTokens: 120 }],
        }),
        JSON.stringify({
          ts: secondTs,
          skills: [{ name: "aihot", estTokens: 170 }],
        }),
      ].join("\n") + "\n"
    writeFileSync(sidecar, content, "utf8")

    const messages = [
      createMessage("assistant-5a", firstTs + 100),
      createMessage("assistant-5b", secondTs + 100),
    ]
    const reader = createSkillReader(worktree, messages, {
      "assistant-5a": [{ type: "tool", tool: "skill", state: { status: "completed", input: { name: "xlsx" } } }],
      "assistant-5b": [{ type: "tool", tool: "skill", state: { status: "completed", input: { name: "aihot" } } }],
    })

    expect(reader("session-5")).toEqual([
      { name: "aihot", totalEstTokens: 170, calls: 1 },
      { name: "xlsx", totalEstTokens: 120, calls: 1 },
    ])
  })

  it("recomputes when a skill part is added to an existing assistant message", () => {
    const worktree = mkdtempSync(join(tmpdir(), "usage-hud-runtime-cache-"))
    tempDirs.push(worktree)

    const sidecar = sidecarPath(worktree, "session-6")
    mkdirSync(join(worktree, ".opencode", ".cache", "token-usage-tui", "sidecar"), { recursive: true })
    writeFileSync(
      sidecar,
      JSON.stringify({
        ts: Date.now(),
        skills: [{ name: "aihot", estTokens: 170 }],
      }) + "\n",
      "utf8"
    )

    const messages = [createMessage("assistant-6", Date.now())]
    const partsByMessage: Record<string, any[]> = { "assistant-6": [] }
    const reader = createSkillReader(worktree, messages, partsByMessage)

    expect(reader("session-6")).toEqual([])

    partsByMessage["assistant-6"] = [
      {
        type: "tool",
        tool: "skill",
        state: { status: "completed", input: { name: "aihot" } },
      },
    ]

    expect(reader("session-6")).toEqual([{ name: "aihot", totalEstTokens: 170, calls: 1 }])
  })
})
