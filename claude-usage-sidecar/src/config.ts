import * as path from "node:path"
import type { SidecarConfig } from "./types.js"

const normalizePath = (value: string): string => value.replaceAll("\\", "/")
const resolveHomeDir = (homeDir?: string): string => {
  const resolved = normalizePath(homeDir ?? process.env.USERPROFILE ?? process.env.HOME ?? "").trim()

  if (resolved.length === 0) {
    throw new Error("Unable to resolve Claude home directory. Pass homeDir explicitly or set USERPROFILE/HOME.")
  }

  return resolved
}

export const getDefaultConfig = (options?: {
  homeDir?: string
  pollMs?: number
}): SidecarConfig => {
  const homeDir = resolveHomeDir(options?.homeDir)
  const claudeDir = normalizePath(path.join(homeDir, ".claude"))
  const cacheDir = normalizePath(path.join(claudeDir, "cache", "usage-hud"))

  return {
    homeDir,
    claudeDir,
    projectsDir: normalizePath(path.join(claudeDir, "projects")),
    cacheDir,
    checkpointsDir: normalizePath(path.join(cacheDir, "checkpoints")),
    snapshotsDir: normalizePath(path.join(cacheDir, "snapshots")),
    indexFile: normalizePath(path.join(cacheDir, "index.json")),
    usageCacheFile: normalizePath(path.join(cacheDir, "usage-cache.json")),
    pollMs: options?.pollMs ?? 1000,
  }
}
