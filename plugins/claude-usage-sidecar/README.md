# @usage-hud/claude-usage-sidecar

Standalone Claude Code usage sidecar that incrementally parses transcript JSONL
files, aggregates truthful session metrics, and persists snapshots + checkpoints
under `~/.claude/cache/usage-hud/`.

## Status

The repository also contains a standalone Claude Code sidecar package at
`plugins/claude-usage-sidecar/`.

Version 1 intentionally exposes only truthful values:

- tool call counts
- task and todo state
- skill call counts when detectable
- unavailable per-tool and per-skill token splits

## Public API

Re-exported from `src/index.ts`:

- `getDefaultConfig`, `SidecarConfig` (`./config.js`, `./types.js`)
- `discoverTranscripts` (`./discover-transcripts.js`)
- `readTranscriptDelta`, `TranscriptDelta` (`./watch-transcript-stream.js`)
- `parseTranscriptLine`, `NormalizedEvent` (`./parse-transcript-line.js`)
- `createEmptySessionState`, `reduceSessionEvents`,
  `toPersistedSessionSnapshot`, `SessionRuntimeState`, `SessionSnapshot`
  (`./aggregate-session-state.js`, `./types.js`)
- `writeSessionSnapshot`, `writeCheckpoint`, `StreamCheckpoint`
  (`./store-snapshot.js`)
- `fetchUsageSummary`, `mergeUsageIntoSnapshot`, `UsageSummary`
  (`./fetch-usage.js`)
- `renderSessionReport` (`./report-session.js`)

The CLI entrypoint (`./cli.js`) is intentionally **not** re-exported from
`index.ts`. `runCli` and `runWatchCycle` must be imported from `./cli.js`
directly. `runWatchCycle` is provided as a dependency-injected hook so tests
and the daemon loop can drive the watch cycle without touching the filesystem.

## CLI

```bash
claude-usage-sidecar report --session <session-id>
claude-usage-sidecar report --latest
```
