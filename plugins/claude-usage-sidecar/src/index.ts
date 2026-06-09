export { getDefaultConfig } from "./config.js"
export type { SidecarConfig } from "./types.js"
export { discoverTranscripts } from "./discover-transcripts.js"
export { readTranscriptDelta } from "./watch-transcript-stream.js"
export type { TranscriptDelta } from "./watch-transcript-stream.js"
export { parseTranscriptLine } from "./parse-transcript-line.js"
export type { NormalizedEvent } from "./types.js"
export {
  createEmptySessionState,
  reduceSessionEvents,
  toPersistedSessionSnapshot,
} from "./aggregate-session-state.js"
export type {
  SessionRuntimeState,
  SessionSnapshot,
} from "./types.js"
export { writeSessionSnapshot, writeCheckpoint, readCheckpoint } from "./store-snapshot.js"
export type { StreamCheckpoint } from "./types.js"
export { fetchUsageSummary, mergeUsageIntoSnapshot } from "./fetch-usage.js"
export type { UsageSummary } from "./fetch-usage.js"
export { renderSessionReport } from "./report-session.js"
