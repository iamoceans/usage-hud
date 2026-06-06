/** @jsxImportSource @opentui/solid */
/** @jsxRuntime automatic */
import type { TuiPlugin } from "@opencode-ai/plugin/tui"
import { createSignal } from "solid-js"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { TokenSidebar } from "./components/TokenSidebar"
import type { SkillSize } from "./aggregator"

const TEXT_EXTS = new Set([".md", ".markdown", ".txt", ".yaml", ".yml", ".json", ".html"])

const walkSkill = (dir: string): { chars: number; fileCount: number } => {
  let chars = 0
  let fileCount = 0
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const full = path.join(cur, e.name)
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue
        stack.push(full)
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase()
        if (!TEXT_EXTS.has(ext)) continue
        try {
          const stat = fs.statSync(full)
          if (stat.size > 1_000_000) continue
          chars += stat.size
          fileCount++
        } catch {}
      }
    }
  }
  return { chars, fileCount }
}

const scanSkillSizes = (worktree: string): { names: string[]; sizes: SkillSize[] } => {
  const seen = new Map<string, { root: string; chars: number; fileCount: number }>()
  const home = os.homedir()
  const roots = [
    path.join(worktree, ".opencode", "skills"),
    path.join(worktree, ".opencode", "skill"),
    path.join(home, ".config", "opencode", "skills"),
    path.join(home, ".config", "opencode", "skill"),
    path.join(home, ".claude", "skills"),
    path.join(home, ".agents", "skills"),
  ]
  for (const root of roots) {
    if (!fs.existsSync(root)) continue
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const skillDir = path.join(root, e.name)
      if (!fs.existsSync(path.join(skillDir, "SKILL.md"))) continue
      const { chars, fileCount } = walkSkill(skillDir)
      const cur = seen.get(e.name)
      if (!cur || chars > cur.chars) {
        seen.set(e.name, { root: skillDir, chars, fileCount })
      }
    }
  }
  const sizes: SkillSize[] = Array.from(seen.entries())
    .map(([name, v]) => ({
      name,
      chars: v.chars,
      estTokens: Math.ceil(v.chars / 4),
      fileCount: v.fileCount,
    }))
    .sort((a, b) => b.estTokens - a.estTokens)
  return { names: sizes.map((s) => s.name), sizes }
}

const plugin: TuiPlugin = async (api, _options, _meta) => {
  const worktree = api.state.path.worktree || process.cwd()
  const scanned = scanSkillSizes(worktree)
  const [loadedSkills] = createSignal<string[]>(scanned.names)
  const [skillSizes] = createSignal<SkillSize[]>(scanned.sizes)

  api.slots.register({
    order: 50,
    slots: {
      sidebar_content: (ctx, props: { session_id: string }) => {
        const sessionId = props.session_id
        if (!sessionId) {
          return <text fg={ctx.theme.current.textMuted}>no active session</text>
        }
        return (
          <TokenSidebar
            sessionId={sessionId}
            getMessages={(id) => {
              try {
                return api.state.session.messages(id)
              } catch {
                return []
              }
            }}
            getParts={(messageID) => {
              try {
                return api.state.part(messageID)
              } catch {
                return []
              }
            }}
            loadedSkills={loadedSkills()}
            skillSizes={skillSizes()}
            theme={ctx.theme}
            refreshMs={750}
          />
        )
      },
    },
  })

  api.lifecycle.onDispose(() => {
    // no-op for now
  })
}

const pluginModule = {
  id: "token-usage-tui",
  tui: plugin,
}

export default pluginModule
