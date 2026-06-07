import { existsSync } from "node:fs"
import { join } from "node:path"

export const sanitizeSessionId = (sessionId: string): string => {
  const normalized = sessionId.trim()
  const safe = normalized.replace(/[<>:"/\\|?*\x00-\x1f]+/g, "_").replace(/\.+/g, ".")
  const collapsed = safe.replace(/^\.+|\.+$/g, "").slice(0, 120)
  return collapsed || "unknown"
}

const unique = (items: string[]): string[] => Array.from(new Set(items.filter(Boolean)))

const stripWindowsDisplayPrefix = (value: string): string => value.replace(/^[/\\]+(?=[A-Za-z]:[\\/])/, "")

const stripBranchSuffix = (value: string): string => {
  const stripped = stripWindowsDisplayPrefix(value)
  const lastColon = stripped.lastIndexOf(":")
  if (lastColon <= 1) return stripped
  const suffix = stripped.slice(lastColon + 1)
  if (suffix.includes("/") || suffix.includes("\\")) return stripped
  return stripped.slice(0, lastColon)
}

export const normalizeWorktreePath = (worktree: string): string => {
  const normalized = worktree.trim()
  const candidates = unique([
    normalized,
    stripWindowsDisplayPrefix(normalized),
    stripBranchSuffix(normalized),
    stripBranchSuffix(stripWindowsDisplayPrefix(normalized)),
  ])

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return candidates[candidates.length - 1] || normalized
}

export const sidecarPath = (worktree: string, sessionId: string): string =>
  join(
    normalizeWorktreePath(worktree),
    ".opencode",
    ".cache",
    "token-usage-tui",
    "sidecar",
    `${sanitizeSessionId(sessionId || "unknown")}.jsonl`
  )
