import type { SessionSnapshot, SessionUsageState } from "./types.js"

export type UsageSummary = SessionUsageState

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
