import { join } from "node:path"

export const sanitizeSessionId = (sessionId: string): string => {
  const normalized = sessionId.trim()
  const safe = normalized.replace(/[<>:"/\\|?*\x00-\x1f]+/g, "_").replace(/\.+/g, ".")
  const collapsed = safe.replace(/^\.+|\.+$/g, "").slice(0, 120)
  return collapsed || "unknown"
}

export const sidecarPath = (worktree: string, sessionId: string): string =>
  join(
    worktree,
    ".opencode",
    ".cache",
    "token-usage-tui",
    "sidecar",
    `${sanitizeSessionId(sessionId || "unknown")}.jsonl`
  )
