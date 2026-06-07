import type { Message, Part } from "@opencode-ai/sdk/v2"
import { formatNum } from "./aggregator"

export type SkillUsageSummary = {
  name: string
  totalEstTokens: number
  turns?: number
  calls?: number
}

type SkillUsageRecord = {
  ts?: number
  skills?: Array<{
    name: string
    estTokens: number
  }>
}

type AnyMessage = {
  id?: string
}

type PartLike = {
  type?: string
  tool?: string
  state?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

const isSkillTool = (tool: unknown): boolean => {
  const normalized = String(tool ?? "").toLowerCase().trim()
  return normalized === "skill" || normalized === "tool:skill"
}

const parseSkillUsageRecords = (content: string): SkillUsageRecord[] => {
  const records: SkillUsageRecord[] = []

  for (const line of content.split("\n")) {
    if (!line) continue
    try {
      records.push(JSON.parse(line) as SkillUsageRecord)
    } catch {
      continue
    }
  }

  return records
}

const getSkillNameFromInput = (input?: Record<string, unknown>): string => {
  if (!input) return ""

  const directKeys = ["name", "skill", "skillName", "skill_name", "id", "command"]
  for (const key of directKeys) {
    const value = input[key]
    if (typeof value === "string" && value.trim()) {
      return value.trim()
    }
  }

  const nestedSkill = input.skill
  if (nestedSkill && typeof nestedSkill === "object") {
    const name = (nestedSkill as Record<string, unknown>).name
    if (typeof name === "string" && name.trim()) {
      return name.trim()
    }
  }

  return ""
}

const collectStringValues = (value: unknown, acc: string[], depth = 0): void => {
  if (depth > 5 || value == null) return
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (trimmed) acc.push(trimmed)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringValues(item, acc, depth + 1)
    return
  }
  if (typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectStringValues(item, acc, depth + 1)
    }
  }
}

const findSkillNameByPattern = (values: string[]): string => {
  const matches = new Set<string>()
  const patterns = [
    /"(?:name|skill|skillName|skill_name|id|command)"\s*:\s*"([^"]+)"/gi,
    /(?:^|[\s{,(])(?:name|skill|skillName|skill_name|id|command)\s*[:=]\s*([A-Za-z0-9._:-]+)/gi,
  ]

  for (const value of values) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0
      for (const match of value.matchAll(pattern)) {
        const candidate = (match[1] ?? "").trim()
        if (candidate) matches.add(candidate)
      }
    }
  }

  return matches.size === 1 ? Array.from(matches)[0] : ""
}

const findSkillNameInStrings = (values: string[], knownSkills: ReadonlySet<string>): string => {
  const normalizedKnown = new Map<string, string>()
  for (const skill of knownSkills) {
    normalizedKnown.set(skill.toLowerCase(), skill)
  }

  const matches = new Set<string>()

  for (const value of values) {
    const lower = value.toLowerCase()

    const exact = normalizedKnown.get(lower)
    if (exact) {
      matches.add(exact)
      continue
    }

    for (const [normalized, original] of normalizedKnown) {
      if (lower.includes(normalized)) {
        matches.add(original)
      }
    }
  }

  return matches.size === 1 ? Array.from(matches)[0] : ""
}

const getRealSkillCalls = (parts: ReadonlyArray<Part>, knownSkills: ReadonlySet<string>): Map<string, number> => {
  const calls = new Map<string, number>()

  for (const raw of parts) {
    const part = raw as PartLike
    if (part.type !== "tool") continue
    if (!isSkillTool(part.tool)) continue

    const skillName =
      getSkillNameFromInput(part.state?.input as Record<string, unknown> | undefined) ||
      getSkillNameFromInput(part.metadata as Record<string, unknown> | undefined) ||
      (() => {
        const values: string[] = []
        collectStringValues(part.state, values)
        collectStringValues(part.metadata, values)
        return findSkillNameInStrings(values, knownSkills) || findSkillNameByPattern(values)
      })()
    if (!skillName) continue

    calls.set(skillName, (calls.get(skillName) ?? 0) + 1)
  }

  return calls
}

export const summarizeRealSkillUsage = (
  messages: ReadonlyArray<Message>,
  partsLookup: (messageID: string) => ReadonlyArray<Part>,
  content: string
): SkillUsageSummary[] => {
  const records = parseSkillUsageRecords(content)
  const knownSkills = new Set<string>()
  const perSkillEstimates = new Map<string, number[]>()
  for (const record of records) {
    for (const skill of record.skills ?? []) {
      knownSkills.add(skill.name)
      const estimates = perSkillEstimates.get(skill.name) ?? []
      estimates.push(skill.estTokens)
      perSkillEstimates.set(skill.name, estimates)
    }
  }

  const callCounts = new Map<string, number>()

  for (const message of messages) {
    const anyMessage = message as AnyMessage
    if (!anyMessage.id) continue

    const calls = getRealSkillCalls(partsLookup(anyMessage.id), knownSkills)
    if (calls.size === 0) continue

    for (const [name, callCount] of calls) {
      callCounts.set(name, (callCounts.get(name) ?? 0) + callCount)
    }
  }

  const summary = new Map<string, SkillUsageSummary>()
  for (const [name, calls] of callCounts) {
    const estimates = perSkillEstimates.get(name) ?? []
    const perCallEstimate =
      estimates.length > 0 ? Math.round(estimates.reduce((sum, value) => sum + value, 0) / estimates.length) : 0
    summary.set(name, {
      name,
      calls,
      totalEstTokens: perCallEstimate * calls,
    })
  }

  return Array.from(summary.values()).sort((a, b) => {
    if (b.totalEstTokens !== a.totalEstTokens) return b.totalEstTokens - a.totalEstTokens
    if ((b.calls ?? 0) !== (a.calls ?? 0)) return (b.calls ?? 0) - (a.calls ?? 0)
    return a.name.localeCompare(b.name)
  })
}

export const summarizeSkillUsageContent = (
  content: string,
  options?: {
    minTimestamp?: number
  }
): SkillUsageSummary[] => {
  const map = new Map<string, SkillUsageSummary>()
  const minTimestamp = options?.minTimestamp ?? Number.NEGATIVE_INFINITY

  for (const rec of parseSkillUsageRecords(content)) {
    if (typeof rec.ts === "number" && rec.ts < minTimestamp) {
      continue
    }

    for (const s of rec.skills ?? []) {
      const cur = map.get(s.name) ?? { name: s.name, totalEstTokens: 0, turns: 0 }
      cur.totalEstTokens += s.estTokens
      cur.turns += 1
      map.set(s.name, cur)
    }
  }

  return Array.from(map.values()).sort((a, b) => b.totalEstTokens - a.totalEstTokens)
}

export const formatSkillUsageDisplay = (usage: SkillUsageSummary): string =>
  typeof usage.calls === "number"
    ? `${formatNum(usage.totalEstTokens)} tok / ${usage.calls}x`
    : `${formatNum(usage.totalEstTokens)} / ${usage.turns ?? 0}t`
