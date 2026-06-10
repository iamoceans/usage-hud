import { readFileSync, statSync } from "node:fs"
import type { Message, Part } from "@opencode-ai/sdk/v2"
import { aggregate, type Aggregated } from "./aggregator"
import { sidecarPath } from "./paths"
import { summarizeRealSkillUsage, type SkillUsageSummary } from "./skill-usage"

type MessageLike = {
  id?: string
}

type PartLike = {
  type?: string
  tool?: string
  state?: unknown
  metadata?: unknown
}

const isSkillTool = (tool: unknown): boolean => {
  const normalized = String(tool ?? "").toLowerCase().trim()
  return normalized === "skill" || normalized === "tool:skill"
}

const getLastMessageId = (messages: ReadonlyArray<Message>): string => {
  const last = messages[messages.length - 1] as MessageLike | undefined
  return typeof last?.id === "string" ? last.id : ""
}

const getSkillPartsFingerprint = (
  messages: ReadonlyArray<Message>,
  getParts: (messageID: string) => ReadonlyArray<Part>
): string => {
  const samples: string[] = []
  let count = 0

  for (const rawMessage of messages) {
    const message = rawMessage as MessageLike
    if (!message.id) continue

    for (const rawPart of getParts(message.id)) {
      const part = rawPart as PartLike
      if (part.type !== "tool" || !isSkillTool(part.tool)) continue

      count++
      if (samples.length < 4) {
        try {
          samples.push(`${message.id}:${JSON.stringify({ state: part.state, metadata: part.metadata }).slice(0, 120)}`)
        } catch {
          samples.push(`${message.id}:${String(part.state ?? part.metadata ?? "")}`.slice(0, 120))
        }
      }
    }
  }

  return `${count}|${samples.join("|")}`
}

export const createAggregateReader = (
  getMessages: (id: string) => ReadonlyArray<Message>,
  getParts: (messageID: string) => ReadonlyArray<Part>
): ((sessionId: string) => Aggregated) => {
  let cachedSessionId = ""
  let cachedMessageCount = -1
  let cachedLastMessageId = ""
  let cachedResult: Aggregated | null = null

  return (sessionId: string) => {
    const messages = getMessages(sessionId)
    const messageCount = messages.length
    const lastMessageId = getLastMessageId(messages)

    if (
      cachedResult &&
      cachedSessionId === sessionId &&
      cachedMessageCount === messageCount &&
      cachedLastMessageId === lastMessageId
    ) {
      return cachedResult
    }

    const next = aggregate(messages, (messageID) => getParts(messageID), [], [])
    cachedSessionId = sessionId
    cachedMessageCount = messageCount
    cachedLastMessageId = lastMessageId
    cachedResult = next
    return next
  }
}

export const createSkillUsageReader = (
  worktree: string,
  getMessages: (id: string) => ReadonlyArray<Message>,
  getParts: (messageID: string) => ReadonlyArray<Part>
): ((sessionId: string) => SkillUsageSummary[]) => {
  type SkillUsageCacheEntry = {
    cachedMessageCount: number
    cachedLastMessageId: string
    cachedSkillFingerprint: string
    cachedSize: number
    cachedMtimeMs: number
    cachedResult: SkillUsageSummary[]
  }

  const cache = new Map<string, SkillUsageCacheEntry>()

  return (sessionId: string) => {
    const messages = getMessages(sessionId)
    const messageCount = messages.length
    const lastMessageId = getLastMessageId(messages)
    const skillFingerprint = getSkillPartsFingerprint(messages, getParts)
    const filePath = sidecarPath(worktree, sessionId)
    const hadEntry = cache.has(filePath)
    const entry = cache.get(filePath) ?? {
      cachedMessageCount: -1,
      cachedLastMessageId: "",
      cachedSkillFingerprint: "",
      cachedSize: -1,
      cachedMtimeMs: -1,
      cachedResult: [],
    }

    try {
      const stat = statSync(filePath)
      if (
        hadEntry &&
        entry.cachedMessageCount === messageCount &&
        entry.cachedLastMessageId === lastMessageId &&
        entry.cachedSkillFingerprint === skillFingerprint &&
        entry.cachedSize === stat.size &&
        entry.cachedMtimeMs === stat.mtimeMs
      ) {
        return entry.cachedResult
      }

      const content = readFileSync(filePath, "utf8")
      if (entry.cachedSize === -1 && !hadEntry) {
        entry.cachedMessageCount = messageCount
        entry.cachedLastMessageId = lastMessageId
        entry.cachedSkillFingerprint = skillFingerprint
        entry.cachedSize = stat.size
        entry.cachedMtimeMs = stat.mtimeMs
        entry.cachedResult = summarizeRealSkillUsage(messages, (messageID) => getParts(messageID), content)
        cache.set(filePath, entry)
        return entry.cachedResult
      }

      const next = summarizeRealSkillUsage(messages, (messageID) => getParts(messageID), content)
      entry.cachedMessageCount = messageCount
      entry.cachedLastMessageId = lastMessageId
      entry.cachedSkillFingerprint = skillFingerprint
      entry.cachedSize = stat.size
      entry.cachedMtimeMs = stat.mtimeMs
      entry.cachedResult = next
      cache.set(filePath, entry)
      return next
    } catch {
      const fallback = summarizeRealSkillUsage(messages, (messageID) => getParts(messageID), "")

      if (
        hadEntry &&
        entry.cachedMessageCount === messageCount &&
        entry.cachedLastMessageId === lastMessageId &&
        entry.cachedSkillFingerprint === skillFingerprint &&
        entry.cachedSize === -1
      ) {
        return entry.cachedResult
      }

      if (entry.cachedSize === -1 && entry.cachedMessageCount === -1) {
        entry.cachedMessageCount = messageCount
        entry.cachedLastMessageId = lastMessageId
        entry.cachedSkillFingerprint = skillFingerprint
        entry.cachedResult = fallback
        cache.set(filePath, entry)
        return entry.cachedResult
      }

      entry.cachedMessageCount = messageCount
      entry.cachedLastMessageId = lastMessageId
      entry.cachedSkillFingerprint = skillFingerprint
      entry.cachedSize = -1
      entry.cachedMtimeMs = -1
      entry.cachedResult = fallback
      cache.set(filePath, entry)
      return entry.cachedResult
    }
  }
}
