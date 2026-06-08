# Claude Code Usage Sidecar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Claude Code sidecar that incrementally parses transcript JSONL files, aggregates truthful session metrics, persists snapshots/checkpoints, and exposes a minimal report command.

**Architecture:** Add a new TypeScript package at `plugins/claude-usage-sidecar/`. The package separates transcript discovery, append-only stream reading, event normalization, session aggregation, snapshot persistence, usage API enrichment, and CLI entrypoints so acquisition, aggregation, and presentation remain decoupled.

**Tech Stack:** TypeScript, Node.js built-ins, Vitest

---

## File Structure

### New package root

- `plugins/claude-usage-sidecar/package.json`
  - Standalone package metadata and scripts for build, test, and CLI execution.
- `plugins/claude-usage-sidecar/tsconfig.json`
  - Strict TypeScript config aligned with the existing `plugins/token-usage-tui/` package.

### Source files

- `plugins/claude-usage-sidecar/src/types.ts`
  - Shared domain types for transcript events, session snapshots, checkpoints, and usage state.
- `plugins/claude-usage-sidecar/src/config.ts`
  - Resolve `~/.claude` paths, cache directories, poll intervals, and environment overrides.
- `plugins/claude-usage-sidecar/src/discover-transcripts.ts`
  - Recursively find transcript JSONL files under `~/.claude/projects`.
- `plugins/claude-usage-sidecar/src/watch-transcript-stream.ts`
  - Incremental append reader that resumes from byte offsets and emits parsed lines safely.
- `plugins/claude-usage-sidecar/src/parse-transcript-line.ts`
  - Convert raw JSONL entries into normalized events.
- `plugins/claude-usage-sidecar/src/aggregate-session-state.ts`
  - Pure reducer that builds truthful per-session state from normalized events.
- `plugins/claude-usage-sidecar/src/store-snapshot.ts`
  - Atomic snapshot writes, checkpoint writes, and index maintenance.
- `plugins/claude-usage-sidecar/src/fetch-usage.ts`
  - Local cache wrapper around Claude OAuth usage fetching, initially adapted from the proven Claude HUD pattern.
- `plugins/claude-usage-sidecar/src/report-session.ts`
  - Read snapshots and print a minimal report for `--latest` and `--session`.
- `plugins/claude-usage-sidecar/src/cli.ts`
  - Command router for `watch` and `report` subcommands.
- `plugins/claude-usage-sidecar/src/index.ts`
  - Public package exports.

### Tests

- `plugins/claude-usage-sidecar/src/discover-transcripts.test.ts`
- `plugins/claude-usage-sidecar/src/watch-transcript-stream.test.ts`
- `plugins/claude-usage-sidecar/src/parse-transcript-line.test.ts`
- `plugins/claude-usage-sidecar/src/aggregate-session-state.test.ts`
- `plugins/claude-usage-sidecar/src/store-snapshot.test.ts`
- `plugins/claude-usage-sidecar/src/fetch-usage.test.ts`
- `plugins/claude-usage-sidecar/src/report-session.test.ts`

### Docs

- Modify: `README.md`
  - Add a short section that points to the new package and clarifies that v1 sidecar exposes truthful counts and unavailable token splits.

## Task 1: Scaffold the Sidecar Package

**Files:**
- Create: `plugins/claude-usage-sidecar/package.json`
- Create: `plugins/claude-usage-sidecar/tsconfig.json`
- Create: `plugins/claude-usage-sidecar/src/index.ts`
- Create: `plugins/claude-usage-sidecar/src/types.ts`
- Create: `plugins/claude-usage-sidecar/src/config.ts`
- Test: `plugins/claude-usage-sidecar/src/discover-transcripts.test.ts`

- [ ] **Step 1: Write the failing package smoke test**

```ts
import { describe, expect, it } from "vitest"
import { getDefaultConfig } from "./config"

describe("getDefaultConfig", () => {
  it("builds the default Claude paths from the provided home directory", () => {
    const config = getDefaultConfig({ homeDir: "C:/Users/admin" })

    expect(config.claudeDir).toBe("C:/Users/admin/.claude")
    expect(config.projectsDir).toBe("C:/Users/admin/.claude/projects")
    expect(config.cacheDir).toBe("C:/Users/admin/.claude/cache/usage-hud")
    expect(config.pollMs).toBe(1000)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- discover-transcripts.test.ts`
Expected: FAIL with module resolution errors for `./config` or missing `getDefaultConfig`

- [ ] **Step 3: Create the new package manifest**

```json
{
  "name": "@usage-hud/claude-usage-sidecar",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Standalone Claude Code usage sidecar",
  "bin": {
    "claude-usage-sidecar": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^24.9.1",
    "typescript": "^5.9.3",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 4: Add TypeScript config and the first config/types implementation**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": false,
    "outDir": "dist",
    "rootDir": "src",
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

```ts
// src/types.ts
export type SidecarConfig = {
  homeDir: string
  claudeDir: string
  projectsDir: string
  cacheDir: string
  checkpointsDir: string
  snapshotsDir: string
  indexFile: string
  usageCacheFile: string
  pollMs: number
}
```

```ts
// src/config.ts
import * as path from "node:path"
import type { SidecarConfig } from "./types.js"

export const getDefaultConfig = (options?: { homeDir?: string; pollMs?: number }): SidecarConfig => {
  const homeDir = options?.homeDir ?? process.env.USERPROFILE ?? process.env.HOME ?? ""
  const claudeDir = path.join(homeDir, ".claude")
  const cacheDir = path.join(claudeDir, "cache", "usage-hud")
  return {
    homeDir,
    claudeDir,
    projectsDir: path.join(claudeDir, "projects"),
    cacheDir,
    checkpointsDir: path.join(cacheDir, "checkpoints"),
    snapshotsDir: path.join(cacheDir, "snapshots"),
    indexFile: path.join(cacheDir, "index.json"),
    usageCacheFile: path.join(cacheDir, "usage-cache.json"),
    pollMs: options?.pollMs ?? 1000,
  }
}
```

```ts
// src/index.ts
export * from "./types.js"
export * from "./config.js"
```

- [ ] **Step 5: Run the package smoke test**

Run: `npm test -- discover-transcripts.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add plugins/claude-usage-sidecar/package.json plugins/claude-usage-sidecar/tsconfig.json plugins/claude-usage-sidecar/src/index.ts plugins/claude-usage-sidecar/src/types.ts plugins/claude-usage-sidecar/src/config.ts plugins/claude-usage-sidecar/src/discover-transcripts.test.ts
git commit -m "feat: scaffold Claude usage sidecar package"
```

## Task 2: Implement Transcript Discovery and Incremental Stream Reading

**Files:**
- Create: `plugins/claude-usage-sidecar/src/discover-transcripts.ts`
- Create: `plugins/claude-usage-sidecar/src/watch-transcript-stream.ts`
- Test: `plugins/claude-usage-sidecar/src/discover-transcripts.test.ts`
- Test: `plugins/claude-usage-sidecar/src/watch-transcript-stream.test.ts`

- [ ] **Step 1: Write the failing discovery test**

```ts
import { mkdirSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { describe, expect, it } from "vitest"
import { discoverTranscripts } from "./discover-transcripts"

describe("discoverTranscripts", () => {
  it("finds jsonl transcripts recursively under the projects directory", () => {
    const root = path.join(process.cwd(), "tmp", "discover")
    const sessionDir = path.join(root, "D--Example")
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(path.join(sessionDir, "abc.jsonl"), "")
    writeFileSync(path.join(sessionDir, "ignore.txt"), "")

    expect(discoverTranscripts(root)).toEqual([path.join(sessionDir, "abc.jsonl")])
  })
})
```

- [ ] **Step 2: Write the failing stream reader test**

```ts
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs"
import * as path from "node:path"
import { describe, expect, it } from "vitest"
import { readTranscriptDelta } from "./watch-transcript-stream"

describe("readTranscriptDelta", () => {
  it("returns only newly appended lines and updates the byte offset", () => {
    const file = path.join(process.cwd(), "tmp", "watch", "session.jsonl")
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, '{"a":1}\n')

    const first = readTranscriptDelta(file, 0)
    appendFileSync(file, '{"b":2}\n')
    const second = readTranscriptDelta(file, first.nextOffset)

    expect(first.lines).toEqual(['{"a":1}'])
    expect(second.lines).toEqual(['{"b":2}'])
  })
})
```

- [ ] **Step 3: Run the discovery and watcher tests to verify they fail**

Run: `npm test -- discover-transcripts.test.ts watch-transcript-stream.test.ts`
Expected: FAIL because `discoverTranscripts` and `readTranscriptDelta` do not exist

- [ ] **Step 4: Implement recursive discovery and append-only reading**

```ts
// src/discover-transcripts.ts
import * as fs from "node:fs"
import * as path from "node:path"

export const discoverTranscripts = (projectsDir: string): string[] => {
  const found: string[] = []
  const stack = [projectsDir]

  while (stack.length > 0) {
    const current = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        found.push(fullPath)
      }
    }
  }

  return found.sort()
}
```

```ts
// src/watch-transcript-stream.ts
import { readFileSync, statSync } from "node:fs"

export type TranscriptDelta = {
  lines: string[]
  nextOffset: number
}

export const readTranscriptDelta = (filePath: string, offset: number): TranscriptDelta => {
  const stat = statSync(filePath)
  const safeOffset = offset > stat.size ? 0 : offset
  const buffer = readFileSync(filePath)
  const chunk = buffer.subarray(safeOffset).toString("utf8")
  const lines = chunk.split("\n").filter((line) => line.length > 0)
  return {
    lines,
    nextOffset: stat.size,
  }
}
```

- [ ] **Step 5: Run the transcript I/O tests**

Run: `npm test -- discover-transcripts.test.ts watch-transcript-stream.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add plugins/claude-usage-sidecar/src/discover-transcripts.ts plugins/claude-usage-sidecar/src/watch-transcript-stream.ts plugins/claude-usage-sidecar/src/discover-transcripts.test.ts plugins/claude-usage-sidecar/src/watch-transcript-stream.test.ts
git commit -m "feat: add transcript discovery and delta reader"
```

## Task 3: Parse Transcript Lines into Normalized Events

**Files:**
- Create: `plugins/claude-usage-sidecar/src/parse-transcript-line.ts`
- Modify: `plugins/claude-usage-sidecar/src/types.ts`
- Test: `plugins/claude-usage-sidecar/src/parse-transcript-line.test.ts`

- [ ] **Step 1: Write the failing parser test for tool calls**

```ts
import { describe, expect, it } from "vitest"
import { parseTranscriptLine } from "./parse-transcript-line"

describe("parseTranscriptLine", () => {
  it("extracts tool_use blocks into normalized tool-start events", () => {
    const line = JSON.stringify({
      sessionId: "session-1",
      timestamp: "2026-06-08T12:00:00.000Z",
      message: {
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "Read",
            input: { file_path: "README.md" },
          },
        ],
      },
    })

    expect(parseTranscriptLine(line)).toEqual([
      {
        sessionId: "session-1",
        timestamp: "2026-06-08T12:00:00.000Z",
        eventType: "tool-start",
        toolCallId: "tool-1",
        toolName: "Read",
        input: { file_path: "README.md" },
      },
    ])
  })
})
```

- [ ] **Step 2: Write the failing parser test for tool results and todo writes**

```ts
it("extracts tool_result and TodoWrite events", () => {
  const line = JSON.stringify({
    sessionId: "session-1",
    timestamp: "2026-06-08T12:00:01.000Z",
    message: {
      content: [
        { type: "tool_result", tool_use_id: "tool-1", is_error: false },
        {
          type: "tool_use",
          id: "todo-1",
          name: "TodoWrite",
          input: {
            todos: [{ content: "Write plan", status: "completed" }],
          },
        },
      ],
    },
  })

  expect(parseTranscriptLine(line)).toEqual([
    {
      sessionId: "session-1",
      timestamp: "2026-06-08T12:00:01.000Z",
      eventType: "tool-end",
      toolCallId: "tool-1",
      status: "completed",
    },
    {
      sessionId: "session-1",
      timestamp: "2026-06-08T12:00:01.000Z",
      eventType: "todo-replace",
      todos: [{ content: "Write plan", status: "completed" }],
    },
  ])
})
```

- [ ] **Step 3: Run the parser tests to verify they fail**

Run: `npm test -- parse-transcript-line.test.ts`
Expected: FAIL with missing parser/type exports

- [ ] **Step 4: Add normalized event types and parser implementation**

```ts
// src/types.ts
export type TodoStatus = "pending" | "in_progress" | "completed"

export type TodoItem = {
  content: string
  status: TodoStatus
}

export type NormalizedEvent =
  | {
      sessionId: string
      timestamp: string
      eventType: "tool-start"
      toolCallId: string
      toolName: string
      input: Record<string, unknown>
    }
  | {
      sessionId: string
      timestamp: string
      eventType: "tool-end"
      toolCallId: string
      status: "completed" | "error"
    }
  | {
      sessionId: string
      timestamp: string
      eventType: "todo-replace"
      todos: TodoItem[]
    }
```

```ts
// src/parse-transcript-line.ts
import type { NormalizedEvent, TodoItem } from "./types.js"

const normalizeTodoStatus = (status: unknown): TodoItem["status"] => {
  if (status === "completed" || status === "done" || status === "complete") return "completed"
  if (status === "in_progress" || status === "running") return "in_progress"
  return "pending"
}

export const parseTranscriptLine = (line: string): NormalizedEvent[] => {
  let entry: any
  try {
    entry = JSON.parse(line)
  } catch {
    return []
  }

  const sessionId = String(entry.sessionId ?? "")
  const timestamp = String(entry.timestamp ?? "")
  const blocks = Array.isArray(entry.message?.content) ? entry.message.content : []
  const events: NormalizedEvent[] = []

  for (const block of blocks) {
    if (block?.type === "tool_use" && typeof block?.id === "string" && typeof block?.name === "string") {
      if (block.name === "TodoWrite" && Array.isArray(block.input?.todos)) {
        events.push({
          sessionId,
          timestamp,
          eventType: "todo-replace",
          todos: block.input.todos.map((todo: any) => ({
            content: String(todo.content ?? ""),
            status: normalizeTodoStatus(todo.status),
          })),
        })
        continue
      }

      events.push({
        sessionId,
        timestamp,
        eventType: "tool-start",
        toolCallId: block.id,
        toolName: block.name,
        input: (block.input ?? {}) as Record<string, unknown>,
      })
    }

    if (block?.type === "tool_result" && typeof block?.tool_use_id === "string") {
      events.push({
        sessionId,
        timestamp,
        eventType: "tool-end",
        toolCallId: block.tool_use_id,
        status: block.is_error ? "error" : "completed",
      })
    }
  }

  return sessionId && timestamp ? events : []
}
```

- [ ] **Step 5: Run the parser tests**

Run: `npm test -- parse-transcript-line.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add plugins/claude-usage-sidecar/src/types.ts plugins/claude-usage-sidecar/src/parse-transcript-line.ts plugins/claude-usage-sidecar/src/parse-transcript-line.test.ts
git commit -m "feat: normalize Claude transcript events"
```

## Task 4: Build the Pure Session Aggregator

**Files:**
- Create: `plugins/claude-usage-sidecar/src/aggregate-session-state.ts`
- Modify: `plugins/claude-usage-sidecar/src/types.ts`
- Test: `plugins/claude-usage-sidecar/src/aggregate-session-state.test.ts`

- [ ] **Step 1: Write the failing reducer test**

```ts
import { describe, expect, it } from "vitest"
import { reduceSessionEvents, createEmptySessionSnapshot } from "./aggregate-session-state"

describe("reduceSessionEvents", () => {
  it("tracks tool counts, task activity, and todo state without token estimates", () => {
    const start = createEmptySessionState("session-1")
    const next = reduceSessionEvents(start, [
      {
        sessionId: "session-1",
        timestamp: "2026-06-08T12:00:00.000Z",
        eventType: "tool-start",
        toolCallId: "task-1",
        toolName: "Task",
        input: { subagent_type: "search", description: "scan repo" },
      },
      {
        sessionId: "session-1",
        timestamp: "2026-06-08T12:00:01.000Z",
        eventType: "tool-end",
        toolCallId: "task-1",
        status: "completed",
      },
      {
        sessionId: "session-1",
        timestamp: "2026-06-08T12:00:02.000Z",
        eventType: "todo-replace",
        todos: [{ content: "write plan", status: "completed" }],
      },
    ])

    expect(next.tools.Task.calls).toBe(1)
    expect(next.tools.Task.completed).toBe(1)
    expect(next.todos.completed).toBe(1)
    expect(next.limitations.perSkillTokens).toBe("unavailable")
  })
})
```

- [ ] **Step 2: Run the reducer test to verify it fails**

Run: `npm test -- aggregate-session-state.test.ts`
Expected: FAIL because reducer helpers are missing

- [ ] **Step 3: Add snapshot types and reducer implementation**

```ts
// src/types.ts
export type ToolCounter = {
  calls: number
  completed: number
  errors: number
  running: number
}

export type SessionSnapshot = {
  sessionId: string
  startedAt: string | null
  lastActivityAt: string | null
  sourceFiles: string[]
  tools: Record<string, ToolCounter>
  skills: Record<string, ToolCounter>
  agents: Array<{
    id: string
    type: string
    description?: string
    status: "running" | "completed" | "error"
    startTime: string
    endTime?: string
  }>
  todos: {
    total: number
    completed: number
    inProgress: number
    items: TodoItem[]
  }
  usage: {
    available: boolean
  }
  limitations: {
    perToolTokens: "unavailable"
    perSkillTokens: "unavailable"
  }
}

export type SessionRuntimeState = SessionSnapshot & {
  openToolCalls: Record<
    string,
    {
      toolName: string
      startedAt: string
    }
  >
}

export type SessionRuntimeState = SessionSnapshot & {
  openToolCalls: Record<
    string,
    {
      toolName: string
      startedAt: string
    }
  >
}
```

```ts
// src/aggregate-session-state.ts
import type { NormalizedEvent, SessionRuntimeState, SessionSnapshot, ToolCounter } from "./types.js"

const ensureCounter = (map: Record<string, ToolCounter>, key: string): ToolCounter => {
  const current = map[key]
  if (current) return current
  const next = { calls: 0, completed: 0, errors: 0, running: 0 }
  map[key] = next
  return next
}

export const createEmptySessionState = (sessionId: string): SessionRuntimeState => ({
  sessionId,
  startedAt: null,
  lastActivityAt: null,
  sourceFiles: [],
  tools: {},
  skills: {},
  agents: [],
  todos: { total: 0, completed: 0, inProgress: 0, items: [] },
  usage: { available: false },
  limitations: {
    perToolTokens: "unavailable",
    perSkillTokens: "unavailable",
  },
  openToolCalls: {},
})

export const reduceSessionEvents = (
  snapshot: SessionRuntimeState,
  events: NormalizedEvent[],
): SessionRuntimeState => {
  const next: SessionRuntimeState = structuredClone(snapshot)

  for (const event of events) {
    if (next.startedAt == null) next.startedAt = event.timestamp
    next.lastActivityAt = event.timestamp

    if (event.eventType === "tool-start") {
      const counter = ensureCounter(next.tools, event.toolName)
      counter.calls += 1
      counter.running += 1
      next.openToolCalls[event.toolCallId] = {
        toolName: event.toolName,
        startedAt: event.timestamp,
      }

      if (event.toolName === "Task") {
        next.agents.push({
          id: event.toolCallId,
          type: String(event.input.subagent_type ?? "unknown"),
          description: typeof event.input.description === "string" ? event.input.description : undefined,
          status: "running",
          startTime: event.timestamp,
        })
      }
    }

    if (event.eventType === "tool-end") {
      const activeCall = next.openToolCalls[event.toolCallId]
      if (activeCall) {
        const counter = ensureCounter(next.tools, activeCall.toolName)
        counter.running = Math.max(0, counter.running - 1)
        if (event.status === "completed") counter.completed += 1
        else counter.errors += 1
        delete next.openToolCalls[event.toolCallId]
      }

      const agent = next.agents.find((item) => item.id === event.toolCallId)
      if (agent) {
        agent.status = event.status
        agent.endTime = event.timestamp
      }
    }

    if (event.eventType === "todo-replace") {
      next.todos.items = event.todos
      next.todos.total = event.todos.length
      next.todos.completed = event.todos.filter((todo) => todo.status === "completed").length
      next.todos.inProgress = event.todos.filter((todo) => todo.status === "in_progress").length
    }
  }

  return next
}

export const toPersistedSessionSnapshot = (state: SessionRuntimeState): SessionSnapshot => ({
  sessionId: state.sessionId,
  startedAt: state.startedAt,
  lastActivityAt: state.lastActivityAt,
  sourceFiles: state.sourceFiles,
  tools: state.tools,
  skills: state.skills,
  agents: state.agents,
  todos: state.todos,
  usage: state.usage,
  limitations: state.limitations,
})
```

- [ ] **Step 4: Run the reducer test**

Run: `npm test -- aggregate-session-state.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/claude-usage-sidecar/src/types.ts plugins/claude-usage-sidecar/src/aggregate-session-state.ts plugins/claude-usage-sidecar/src/aggregate-session-state.test.ts
git commit -m "feat: add truthful session aggregation"
```

## Task 5: Persist Checkpoints and Snapshots Atomically

**Files:**
- Create: `plugins/claude-usage-sidecar/src/store-snapshot.ts`
- Test: `plugins/claude-usage-sidecar/src/store-snapshot.test.ts`

- [ ] **Step 1: Write the failing snapshot store test**

```ts
import { mkdtempSync, readFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, expect, it } from "vitest"
import { writeSessionSnapshot, writeCheckpoint } from "./store-snapshot"

describe("store-snapshot", () => {
  it("writes a session snapshot and checkpoint to the configured cache layout", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "usage-sidecar-"))
    const snapshot = {
      sessionId: "session-1",
      startedAt: null,
      lastActivityAt: null,
      sourceFiles: [],
      tools: {},
      skills: {},
      agents: [],
      todos: { total: 0, completed: 0, inProgress: 0, items: [] },
      usage: { available: false },
      limitations: { perToolTokens: "unavailable", perSkillTokens: "unavailable" },
    }

    writeSessionSnapshot(path.join(root, "snapshots"), snapshot)
    writeCheckpoint(path.join(root, "checkpoints"), "stream-a", { filePath: "a.jsonl", offset: 42 })

    const savedSnapshot = JSON.parse(readFileSync(path.join(root, "snapshots", "session-1.json"), "utf8"))
    const savedCheckpoint = JSON.parse(readFileSync(path.join(root, "checkpoints", "stream-a.json"), "utf8"))

    expect(savedSnapshot.sessionId).toBe("session-1")
    expect(savedCheckpoint.offset).toBe(42)
  })
})
```

- [ ] **Step 2: Run the snapshot store test to verify it fails**

Run: `npm test -- store-snapshot.test.ts`
Expected: FAIL because snapshot store functions do not exist

- [ ] **Step 3: Implement atomic write helpers**

```ts
// src/store-snapshot.ts
import { mkdirSync, renameSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import type { SessionRuntimeState, SessionSnapshot } from "./types.js"
import { toPersistedSessionSnapshot } from "./aggregate-session-state.js"

export type StreamCheckpoint = {
  filePath: string
  offset: number
}

const atomicWriteJson = (target: string, value: unknown): void => {
  mkdirSync(path.dirname(target), { recursive: true })
  const temp = `${target}.tmp`
  writeFileSync(temp, JSON.stringify(value, null, 2), "utf8")
  renameSync(temp, target)
}

export const writeSessionSnapshot = (
  snapshotsDir: string,
  snapshot: SessionSnapshot | SessionRuntimeState,
): void => {
  const persisted = "openToolCalls" in snapshot ? toPersistedSessionSnapshot(snapshot) : snapshot
  atomicWriteJson(path.join(snapshotsDir, `${persisted.sessionId}.json`), persisted)
}

export const writeCheckpoint = (
  checkpointsDir: string,
  streamKey: string,
  checkpoint: StreamCheckpoint,
): void => {
  atomicWriteJson(path.join(checkpointsDir, `${streamKey}.json`), checkpoint)
}
```

- [ ] **Step 4: Run the snapshot store test**

Run: `npm test -- store-snapshot.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/claude-usage-sidecar/src/store-snapshot.ts plugins/claude-usage-sidecar/src/store-snapshot.test.ts
git commit -m "feat: persist sidecar snapshots and checkpoints"
```

## Task 6: Add Usage Fetching and the Report Command

**Files:**
- Create: `plugins/claude-usage-sidecar/src/fetch-usage.ts`
- Create: `plugins/claude-usage-sidecar/src/report-session.ts`
- Create: `plugins/claude-usage-sidecar/src/cli.ts`
- Test: `plugins/claude-usage-sidecar/src/fetch-usage.test.ts`
- Test: `plugins/claude-usage-sidecar/src/report-session.test.ts`

- [ ] **Step 1: Write the failing usage fetch test**

```ts
import { describe, expect, it } from "vitest"
import { mergeUsageIntoSnapshot } from "./fetch-usage"
import { createEmptySessionState, toPersistedSessionSnapshot } from "./aggregate-session-state"

describe("mergeUsageIntoSnapshot", () => {
  it("attaches usage availability without inventing session token splits", () => {
    const snapshot = toPersistedSessionSnapshot(createEmptySessionState("session-1"))
    const next = mergeUsageIntoSnapshot(snapshot, {
      planName: "Max",
      fiveHourUtilization: 24,
      sevenDayUtilization: 80,
      available: true,
    })

    expect(next.usage.available).toBe(true)
    expect(next.limitations.perToolTokens).toBe("unavailable")
  })
})
```

- [ ] **Step 2: Write the failing report test**

```ts
import { describe, expect, it } from "vitest"
import { renderSessionReport } from "./report-session"

describe("renderSessionReport", () => {
  it("prints a concise truthful summary from a stored snapshot", () => {
    const output = renderSessionReport({
      sessionId: "session-1",
      startedAt: null,
      lastActivityAt: "2026-06-08T12:00:00.000Z",
      sourceFiles: [],
      tools: { Read: { calls: 2, completed: 2, errors: 0, running: 0 } },
      skills: {},
      agents: [],
      todos: { total: 1, completed: 1, inProgress: 0, items: [{ content: "write plan", status: "completed" }] },
      usage: { available: false },
      limitations: { perToolTokens: "unavailable", perSkillTokens: "unavailable" },
    })

    expect(output).toContain("session-1")
    expect(output).toContain("Read: 2 calls")
    expect(output).toContain("per-tool tokens: unavailable")
  })
})
```

- [ ] **Step 3: Run the usage and report tests to verify they fail**

Run: `npm test -- fetch-usage.test.ts report-session.test.ts`
Expected: FAIL because usage/report helpers are missing

- [ ] **Step 4: Implement the minimal usage merge and report renderer**

```ts
// src/fetch-usage.ts
import type { SessionSnapshot } from "./types.js"

export type UsageSummary = {
  planName?: string
  fiveHourUtilization?: number
  sevenDayUtilization?: number
  available: boolean
}

export const mergeUsageIntoSnapshot = (
  snapshot: SessionSnapshot,
  usage: UsageSummary,
): SessionSnapshot => ({
  ...snapshot,
  usage: {
    ...snapshot.usage,
    ...usage,
  },
})
```

```ts
// src/report-session.ts
import type { SessionSnapshot } from "./types.js"

export const renderSessionReport = (snapshot: SessionSnapshot): string => {
  const toolLines = Object.entries(snapshot.tools).map(
    ([name, counter]) => `${name}: ${counter.calls} calls (${counter.completed} completed, ${counter.errors} errors)`,
  )

  return [
    `session: ${snapshot.sessionId}`,
    `last activity: ${snapshot.lastActivityAt ?? "unknown"}`,
    ...toolLines,
    `todos: ${snapshot.todos.completed}/${snapshot.todos.total} completed`,
    `per-tool tokens: ${snapshot.limitations.perToolTokens}`,
    `per-skill tokens: ${snapshot.limitations.perSkillTokens}`,
  ].join("\n")
}
```

```ts
// src/cli.ts
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { getDefaultConfig } from "./config.js"
import { renderSessionReport } from "./report-session.js"

const run = (): void => {
  const [, , command, sessionId] = process.argv
  const config = getDefaultConfig()

  if (command === "report" && sessionId) {
    const file = path.join(config.snapshotsDir, `${sessionId}.json`)
    const snapshot = JSON.parse(readFileSync(file, "utf8"))
    process.stdout.write(renderSessionReport(snapshot))
    return
  }

  process.stdout.write("usage: claude-usage-sidecar report <session-id>\n")
}

run()
```

- [ ] **Step 5: Run the usage and report tests**

Run: `npm test -- fetch-usage.test.ts report-session.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add plugins/claude-usage-sidecar/src/fetch-usage.ts plugins/claude-usage-sidecar/src/report-session.ts plugins/claude-usage-sidecar/src/cli.ts plugins/claude-usage-sidecar/src/fetch-usage.test.ts plugins/claude-usage-sidecar/src/report-session.test.ts
git commit -m "feat: add usage merge and report command"
```

## Task 7: Wire the Watch Loop and Document the Package

**Files:**
- Modify: `plugins/claude-usage-sidecar/src/index.ts`
- Modify: `plugins/claude-usage-sidecar/src/cli.ts`
- Modify: `README.md`
- Test: `plugins/claude-usage-sidecar/src/cli.test.ts`

- [ ] **Step 1: Write the failing watch loop test**

```ts
import { describe, expect, it, vi } from "vitest"
import { runWatchCycle } from "./cli"

describe("runWatchCycle", () => {
  it("discovers transcripts, resumes from checkpoints, reduces state, and persists snapshots", () => {
    const discover = vi.fn(() => ["C:/tmp/session.jsonl"])
    const readDelta = vi.fn(() => ({ lines: ['{"sessionId":"s1","timestamp":"2026-06-08T12:00:00.000Z","message":{"content":[]}}'], nextOffset: 10 }))
    const loadCheckpoint = vi.fn(() => ({ filePath: "C:/tmp/session.jsonl", offset: 4 }))
    const writeSnapshot = vi.fn()
    const writeCheckpoint = vi.fn()

    runWatchCycle({
      discoverTranscripts: discover,
      readTranscriptDelta: readDelta,
      loadCheckpoint,
      writeSessionSnapshot: writeSnapshot,
      writeCheckpoint,
    })

    expect(discover).toHaveBeenCalled()
    expect(readDelta).toHaveBeenCalledWith("C:/tmp/session.jsonl", 4)
    expect(writeSnapshot).toHaveBeenCalled()
    expect(writeCheckpoint).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the watch loop test to verify it fails**

Run: `npm test -- cli.test.ts`
Expected: FAIL because `runWatchCycle` is missing

- [ ] **Step 3: Implement the watch orchestration and README update**

```ts
// src/index.ts
export * from "./config.js"
export * from "./types.js"
export * from "./discover-transcripts.js"
export * from "./watch-transcript-stream.js"
export * from "./parse-transcript-line.js"
export * from "./aggregate-session-state.js"
export * from "./store-snapshot.js"
export * from "./fetch-usage.js"
export * from "./report-session.js"
```

```ts
// src/cli.ts
import { getDefaultConfig } from "./config.js"
import { discoverTranscripts } from "./discover-transcripts.js"
import { readTranscriptDelta } from "./watch-transcript-stream.js"
import { parseTranscriptLine } from "./parse-transcript-line.js"
import { createEmptySessionState, reduceSessionEvents } from "./aggregate-session-state.js"
import { writeCheckpoint, writeSessionSnapshot } from "./store-snapshot.js"

export const runWatchCycle = (deps = {
  discoverTranscripts,
  readTranscriptDelta,
  loadCheckpoint: (_checkpointsDir: string, _streamKey: string) => null as null | { filePath: string; offset: number },
  writeSessionSnapshot,
  writeCheckpoint,
}): void => {
  const config = getDefaultConfig()
  const files = deps.discoverTranscripts(config.projectsDir)
  const sessionStates = new Map<string, ReturnType<typeof createEmptySessionState>>()

  for (const filePath of files) {
    const streamKey = Buffer.from(filePath).toString("base64url")
    const checkpoint = deps.loadCheckpoint(config.checkpointsDir, streamKey)
    const delta = deps.readTranscriptDelta(filePath, checkpoint?.offset ?? 0)
    if (delta.lines.length === 0) continue

    for (const line of delta.lines) {
      const events = parseTranscriptLine(line)
      if (events.length === 0) continue
      const sessionId = events[0].sessionId
      const current = sessionStates.get(sessionId) ?? createEmptySessionState(sessionId)
      const reduced = reduceSessionEvents(current, events)
      sessionStates.set(sessionId, reduced)
      deps.writeSessionSnapshot(config.snapshotsDir, reduced)
    }

    deps.writeCheckpoint(config.checkpointsDir, streamKey, { filePath, offset: delta.nextOffset })
  }
}
```

```md
## Claude Code Sidecar

The repository also contains a standalone Claude Code sidecar package at `plugins/claude-usage-sidecar/`.

Version 1 intentionally exposes only truthful values:

- tool call counts
- task and todo state
- skill call counts when detectable
- unavailable per-tool and per-skill token splits
```

- [ ] **Step 4: Run the watch loop test and the full sidecar test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/claude-usage-sidecar/src/index.ts plugins/claude-usage-sidecar/src/cli.ts plugins/claude-usage-sidecar/src/cli.test.ts README.md
git commit -m "docs: wire sidecar watch loop and document truthful metrics"
```

## Self-Review

### Spec Coverage

- Transcript discovery: covered in Task 2
- Incremental append reading: covered in Task 2
- Defensive event normalization: covered in Task 3
- Truthful session aggregation: covered in Task 4
- Snapshot/checkpoint persistence: covered in Task 5
- Usage enrichment: covered in Task 6
- Minimal report command: covered in Task 6
- No token estimation: enforced in Task 4, Task 6, and README text in Task 7

### Placeholder Scan

- No `TODO`, `TBD`, or "implement later" placeholders remain
- Every task contains explicit file paths, commands, and code snippets
- No step says "write tests for the above" without showing actual test content

### Type Consistency

- `SessionRuntimeState` is used during reduction and converted to `SessionSnapshot` before persistence
- `NormalizedEvent` fields match parser output and reducer input
- `perToolTokens` and `perSkillTokens` remain `"unavailable"` consistently across reducer, report, and docs
