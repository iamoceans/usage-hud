import type { Plugin } from "@opencode-ai/plugin"
import { appendFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { sidecarPath } from "./paths"

/**
 * Server plugin: per-turn per-skill system prompt tracking.
 *
 * Hooks experimental.chat.system.transform. For each turn, parses the
 * system prompt for <skill>...</skill> XML blocks and appends a JSONL
 * record to sidecar/<sessionID>.jsonl:
 *
 *   { turn, ts, sessionID, model, skills: [{name, chars, estTokens}, ...] }
 *
 * The TUI plugin reads this sidecar and renders "actual used" data in
 * place of the static file-size estimate.
 *
 * Install: copy this file to <worktree>/.opencode/plugins/ (or
 * ~/.config/opencode/plugins/) and opencode will auto-load it.
 */

const SKILL_RE = /<skill>\s*<name>([^<]+)<\/name>([\s\S]*?)<\/skill>/g

export const TokenUsageServerPlugin: Plugin = async ({ worktree }) => {
  const file = sidecarPath(worktree ?? process.cwd(), "init")
  const sidecarDir = dirname(file)
  let turn = 0

  return {
    "experimental.chat.system.transform": async (input, output) => {
      try {
        const skillTotals = new Map<string, { name: string; chars: number; estTokens: number }>()
        for (const segment of output.system) {
          for (const m of segment.matchAll(SKILL_RE)) {
            const name = m[1].trim()
            const blockLen = m[0].length
            const cur = skillTotals.get(name) ?? { name, chars: 0, estTokens: 0 }
            cur.chars += blockLen
            cur.estTokens = Math.ceil(cur.chars / 4)
            skillTotals.set(name, cur)
          }
        }

        const skills = Array.from(skillTotals.values()).sort((a, b) => b.chars - a.chars)
        if (skills.length === 0) return

        turn++
        mkdirSync(sidecarDir, { recursive: true })

        const record = {
          turn,
          ts: Date.now(),
          sessionID: input.sessionID,
          model: input.model?.id ?? "unknown",
          skills,
        }

        const out = sidecarPath(worktree ?? process.cwd(), input.sessionID ?? "unknown")
        appendFileSync(out, JSON.stringify(record) + "\n")
      } catch {
        // best effort
      }
    },
  }
}

export default TokenUsageServerPlugin
