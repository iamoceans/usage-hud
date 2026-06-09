#!/usr/bin/env node

import { readFileSync } from "node:fs"
import * as path from "node:path"
import { pathToFileURL } from "node:url"
import { getDefaultConfig } from "./config.js"
import { renderSessionReport } from "./report-session.js"
import type { SessionSnapshot } from "./types.js"

type CliIO = {
  stdout: {
    write: (chunk: string) => void
  }
  stderr: {
    write: (chunk: string) => void
  }
}

type CliDeps = {
  readFileSync: typeof readFileSync
}

const usageText = "usage: claude-usage-sidecar report <session-id>\n"

const toSnapshotFileName = (sessionId: string): string =>
  `${encodeURIComponent(sessionId)}.json`

const readSnapshot = (
  snapshotFile: string,
  deps: CliDeps,
): SessionSnapshot => JSON.parse(deps.readFileSync(snapshotFile, "utf8")) as SessionSnapshot

export const runCli = (
  argv: string[],
  options?: {
    io?: CliIO
    deps?: Partial<CliDeps>
  },
): number => {
  const io = options?.io ?? process
  const deps: CliDeps = {
    readFileSync: options?.deps?.readFileSync ?? readFileSync,
  }
  const [, , command, sessionId] = argv

  if (command !== "report" || typeof sessionId !== "string" || sessionId.trim().length === 0) {
    io.stdout.write(usageText)
    return 1
  }

  try {
    const config = getDefaultConfig()
    const snapshotFile = path.join(config.snapshotsDir, toSnapshotFileName(sessionId))
    const snapshot = readSnapshot(snapshotFile, deps)

    io.stdout.write(`${renderSessionReport(snapshot)}\n`)
    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    io.stderr.write(`failed to render report: ${message}\n`)
    return 1
  }
}

const isDirectExecution =
  typeof process.argv[1] === "string" &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url

if (isDirectExecution) {
  process.exitCode = runCli(process.argv)
}
