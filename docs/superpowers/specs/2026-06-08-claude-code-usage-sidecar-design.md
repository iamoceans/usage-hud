# Claude Code Usage Sidecar Design

## Summary

This document defines the first implementation target for a Claude Code usage collector that reproduces the spirit of `usage-hud` without depending on Claude Code's UI plugin APIs.

The selected approach is a pure external sidecar:

- Runs as an independent local process
- Watches Claude Code transcript files under `~/.claude/projects/**/*.jsonl`
- Aggregates only data that can be obtained as real runtime facts
- Writes normalized per-session snapshots for later consumers

The first version explicitly prefers truthful partial visibility over broad but estimated metrics.

## Goals

- Build a standalone sidecar that continuously ingests Claude Code transcript JSONL files
- Produce accurate session-level counts for tool calls, agent activity, todo state, and skill call counts when detectable
- Fetch real Claude subscription usage from the Anthropic OAuth usage API when available
- Persist stable snapshot files that future renderers can read without re-parsing transcripts
- Keep the design independent from Claude Code statusline or plugin rendering surfaces

## Non-Goals

- Do not render a terminal HUD, web dashboard, or statusline in v1
- Do not estimate per-tool token usage from output length
- Do not estimate per-skill token usage from prompt size or text length
- Do not require modifying Claude Code internals
- Do not support multi-machine sync, analytics history, or charts in v1

## Why This Approach

Three approaches were considered:

1. External sidecar only
2. Claude Code plugin internal aggregation
3. Hybrid plugin plus sidecar

The chosen option is external sidecar only because the current requirement is to prioritize real data collection over UI, and because local Claude transcript files already expose enough event detail to support truthful aggregation. This keeps the first version decoupled from Claude Code plugin lifecycles and rendering performance constraints.

## Constraints

### Truthfulness Boundary

The system should only report values that can be justified from first-hand local evidence or official API responses.

Allowed in v1:

- Transcript-derived tool call counts
- Transcript-derived tool status (`running`, `completed`, `error`)
- Transcript-derived task/subagent lifecycle
- Transcript-derived todo state
- Transcript-derived skill call counts when tool invocations can be identified as skill calls
- Official usage API values such as five-hour and seven-day utilization

Not allowed in v1:

- Per-tool token estimation by output length
- Per-skill token estimation by prompt text length
- Any synthetic provider-billed token split that Claude Code does not expose directly

### Host Environment

The collector runs on the same machine as Claude Code and relies on local filesystem access to:

- `~/.claude/projects/**/*.jsonl`
- `~/.claude/settings.json` if needed for configuration discovery
- `~/.claude/.credentials.json` or platform-specific credential flow only if usage API access is implemented through local Claude auth state

The collector must tolerate missing OAuth credentials and continue operating with transcript-only metrics.

## Source Data Model

### Transcript Files

Observed Claude transcript files contain newline-delimited JSON objects with fields such as:

- `type`
- `sessionId`
- `timestamp`
- `message.role`
- `message.content[]`
- `attachment`

Relevant event shapes include:

- `message.content[].type === "tool_use"`
- `message.content[].type === "tool_result"`
- `attachment.type === "hook_success"`
- `attachment.type === "hook_additional_context"`
- `attachment.type === "skill_listing"`

The collector should treat transcript files as append-only logs and parse them incrementally.

### Usage API

The usage fetcher should reuse the proven pattern from existing Claude HUD implementations:

- Read Claude OAuth credentials when available
- Call the official Anthropic OAuth usage endpoint
- Cache responses locally with TTL and rate-limit backoff
- Return `null` or an explicit unavailable state when the API cannot be used

This usage information is global account usage, not per-session token usage.

## Architecture

### Components

The v1 system has five components:

1. `transcript-discovery`
2. `transcript-watcher`
3. `event-parser`
4. `session-aggregator`
5. `snapshot-store`

An optional sixth component, `usage-fetcher`, enriches snapshots with real account usage data.

### Transcript Discovery

Responsibilities:

- Scan `~/.claude/projects` recursively for `*.jsonl`
- Register each file as a transcript stream
- Detect newly created transcript files

Design notes:

- Discovery should run at startup and on a periodic low-frequency rescan
- File path is a stream identity; `sessionId` is the aggregation identity
- Multiple transcript files may exist across projects; the system must isolate them cleanly

### Transcript Watcher

Responsibilities:

- Track each transcript file's last processed byte offset
- Read only appended content after the last checkpoint
- Handle file growth, truncation, recreation, and temporary read failures

Design notes:

- Use append-oriented polling in v1 for portability and simplicity
- If the file shrinks, treat it as rotation or reset and restart from byte `0`
- Persist checkpoints so the process can resume after restart

### Event Parser

Responsibilities:

- Read appended lines
- Parse each JSON object defensively
- Normalize relevant transcript events into internal event objects

Normalization output should include:

- `sessionId`
- `timestamp`
- `eventType`
- event-specific payload

Malformed lines should be skipped with debug logging and should never stop the stream.

### Session Aggregator

Responsibilities:

- Maintain one in-memory aggregate per `sessionId`
- Update aggregate state as normalized events arrive
- Derive summary counters and last-known states

The session aggregate should track at least:

- `sessionId`
- `projectPath` when inferable
- `startedAt`
- `lastActivityAt`
- `toolStats`
- `skillStats`
- `agentStats`
- `todoState`
- `sourceFiles`
- `usageAccountSnapshot`

### Snapshot Store

Responsibilities:

- Write per-session snapshots as stable JSON files
- Write a global index for discovery
- Persist watcher checkpoints

Suggested layout:

```text
~/.claude/cache/usage-hud/
  checkpoints/
    <stream-hash>.json
  snapshots/
    <session-id>.json
  index.json
  usage-cache.json
```

The precise directory name can be adjusted during implementation, but the structure should remain separate between checkpoints and snapshots.

## Aggregation Rules

### Session Identity

`sessionId` is the primary key for aggregation and output.

Rationale:

- It appears directly in transcript data
- It is stable across lines within a session
- It allows later consumers to read a single session snapshot without inspecting transcript paths

### Tool Calls

For each `tool_use` block:

- Increment tool call count by tool name
- Mark call status as `running`
- Record start timestamp

For each matching `tool_result` block:

- Resolve the referenced tool call by `tool_use_id`
- Mark final status as `completed` or `error`
- Record end timestamp

Derived tool metrics:

- total calls per tool
- completed calls per tool
- error calls per tool
- currently running calls
- most recent tool activity

### Skill Calls

Skill metrics are restricted to real invocation counts.

When a tool invocation can be identified as a skill call:

- Increment the skill call count
- Track status and timestamps using the same call lifecycle rules

The collector must not attach token values to skills in v1.

If a tool call cannot be confidently attributed to a specific skill name, it should not be counted as a named skill invocation.

### Agent Activity

`Task` tool usage should be interpreted as subagent activity.

Track:

- agent type
- agent description when available
- status
- start time
- end time

Derived metrics:

- running agent count
- completed agent count
- recent agent list

### Todo State

Support both bulk todo writes and incremental task operations when present in transcripts.

Track:

- latest task list
- per-task status
- total completed count
- current in-progress task

The output should represent the latest known todo state for the session, not a full event history.

### Account Usage

Usage API data should be attached as account-level metadata:

- `planName`
- `fiveHourUtilization`
- `fiveHourResetAt`
- `sevenDayUtilization`
- `sevenDayResetAt`
- API availability state

This usage data is not session-specific. The same current usage snapshot may appear in multiple session outputs for convenience.

## Snapshot Schema

The v1 per-session snapshot should look roughly like:

```json
{
  "sessionId": "uuid",
  "startedAt": "2026-06-08T12:00:00.000Z",
  "lastActivityAt": "2026-06-08T12:34:56.000Z",
  "sourceFiles": [
    "C:/Users/admin/.claude/projects/D--Example/session.jsonl"
  ],
  "tools": {
    "Read": { "calls": 12, "completed": 12, "errors": 0, "running": 0 },
    "Task": { "calls": 2, "completed": 1, "errors": 0, "running": 1 }
  },
  "skills": {
    "using-superpowers": { "calls": 1, "completed": 1, "errors": 0, "running": 0 }
  },
  "agents": [
    {
      "id": "call_1",
      "type": "search",
      "description": "search codebase",
      "status": "completed",
      "startTime": "2026-06-08T12:10:00.000Z",
      "endTime": "2026-06-08T12:10:03.000Z"
    }
  ],
  "todos": {
    "total": 3,
    "completed": 1,
    "inProgress": 1,
    "items": [
      { "content": "inspect repo", "status": "completed" },
      { "content": "write spec", "status": "in_progress" }
    ]
  },
  "usage": {
    "planName": "Max",
    "fiveHourUtilization": 25,
    "fiveHourResetAt": "2026-06-08T15:00:00.000Z",
    "sevenDayUtilization": 81,
    "sevenDayResetAt": "2026-06-13T00:00:00.000Z",
    "available": true
  },
  "limitations": {
    "perToolTokens": "unavailable",
    "perSkillTokens": "unavailable"
  }
}
```

Exact field names may change during implementation, but the schema must preserve the distinction between real values and unavailable values.

## Reliability Requirements

- The sidecar must continue running if one transcript file contains malformed lines
- A failed usage API refresh must not block transcript aggregation
- Snapshot writes should be atomic to avoid partial reads
- Checkpoint writes should lag only after successful parse and aggregation
- Reprocessing the same transcript lines should be safe and idempotent where practical

## Performance Requirements

- Incremental reads only; never rescan entire transcript files on every tick
- Batch appended lines per file read cycle
- Throttle snapshot writes to avoid writing on every single parsed line
- Cache usage API responses with TTL and rate-limit awareness

The expected workload is modest, but long-running sessions and large transcript files should remain efficient.

## Security and Privacy

- Do not write OAuth access tokens into snapshots or logs
- Avoid storing raw transcript content in output snapshots unless needed for derived state
- Log only operational diagnostics, not sensitive prompt content
- Treat all transcript fields as untrusted input and parse defensively

## CLI for Verification

Even though v1 has no UI, it should expose one minimal verification interface, for example:

```bash
claude-usage-sidecar report --session <session-id>
claude-usage-sidecar report --latest
```

The command should read snapshots, not transcripts, so that the output path matches future consumers.

## MVP Scope

### In Scope

- Standalone sidecar process
- Transcript discovery under `~/.claude/projects`
- Incremental JSONL parsing
- Session aggregation by `sessionId`
- Tool, agent, todo, and skill call count tracking
- Usage API fetch plus cache
- Snapshot and checkpoint persistence
- Minimal report command for manual validation

### Out of Scope

- HUD rendering
- Historical charts
- Cross-session rollups beyond the simple index
- Estimated per-tool or per-skill tokens
- Remote sync

## Open Questions Resolved

### Should session identity come from file path or transcript data?

Use `sessionId` from transcript data as the primary identity. File paths are only stream locations.

### Should missing token splits be estimated?

No. Missing token splits remain unavailable in v1.

### Should the sidecar own presentation?

No. The sidecar only produces snapshots and a minimal report command.

## Risks

### Transcript Shape Drift

Claude Code may evolve transcript schemas. The parser must be defensive and event-shape driven rather than overly strict.

### Session Discovery Edge Cases

The current session may not always be trivially inferable from the latest modified file alone. The design avoids that problem by aggregating all discovered sessions and letting consumers choose the relevant one.

### Usage API Availability

Some users may not have OAuth usage data available, especially API-only or custom endpoint setups. The collector must degrade gracefully.

## Implementation Guidance

The implementation should be split into small modules with single responsibilities:

- `discover-transcripts`
- `watch-transcript-stream`
- `parse-transcript-line`
- `aggregate-session-state`
- `store-snapshot`
- `fetch-usage`
- `report-session`

This keeps the design aligned with the original `usage-hud` principle of separating acquisition, aggregation, and presentation.

## Acceptance Criteria

- Starting the sidecar creates checkpoints and snapshots after Claude transcript activity is detected
- Re-running the sidecar does not duplicate previously processed transcript lines
- Session snapshots show truthful tool, task, todo, and skill call counts from transcript evidence
- Usage snapshots include official usage API values when available and explicit unavailable states otherwise
- No per-tool or per-skill token estimates appear in v1 output
- A minimal report command can display the latest snapshot without parsing raw transcripts directly
