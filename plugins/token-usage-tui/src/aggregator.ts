import type { Message, Part } from "@opencode-ai/sdk/v2"

export type TokenBucket = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
  steps: number
}

export type SkillSize = {
  name: string
  chars: number
  estTokens: number
  fileCount: number
}

export type Aggregated = {
  total: TokenBucket
  byTool: Record<string, TokenBucket>
  loadedSkills: string[]
  skillSizes: SkillSize[]
  lastUpdated: number
  sessionCount: number
  messageCount: number
}

const empty = (): TokenBucket => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  steps: 0,
})

const add = (a: TokenBucket, b: Partial<TokenBucket>): void => {
  a.input += b.input ?? 0
  a.output += b.output ?? 0
  a.cacheRead += b.cacheRead ?? 0
  a.cacheWrite += b.cacheWrite ?? 0
  a.reasoning += b.reasoning ?? 0
  a.steps += b.steps ?? 0
}

const bucketTotal = (b: TokenBucket): number =>
  (b.input ?? 0) +
  (b.output ?? 0) +
  (b.cacheRead ?? 0) +
  (b.cacheWrite ?? 0) +
  (b.reasoning ?? 0)

export type AssistantMessage = Extract<Message, { role: "assistant" }>
export type UserMessage = Extract<Message, { role: "user" }>

type AnyMessage = { id: string; role?: string; tokens?: any; sessionID?: string }

const isAssistant = (m: AnyMessage): m is AssistantMessage & { tokens?: any } =>
  m?.role === "assistant"

type PartLike = { type?: string; messageID?: string; tool?: string; state?: any }

const getToolOutput = (p: PartLike): string => {
  if (p?.type !== "tool") return ""
  const s = p.state
  if (!s) return ""
  if (s.status === "completed") return String(s.output ?? "")
  if (s.status === "error") return String(s.error ?? "")
  return ""
}

export function aggregate(
  messages: ReadonlyArray<Message>,
  partsLookup: (messageID: string) => ReadonlyArray<Part>,
  loadedSkills: string[],
  skillSizes: SkillSize[] = []
): Aggregated {
  const result: Aggregated = {
    total: empty(),
    byTool: {},
    loadedSkills,
    skillSizes,
    lastUpdated: Date.now(),
    sessionCount: 0,
    messageCount: messages.length,
  }

  const seenSessions = new Set<string>()

  for (const raw of messages) {
    const m = raw as AnyMessage
    if (m.sessionID) seenSessions.add(m.sessionID)
    if (!isAssistant(m)) continue
    if (!m.id) continue

    const t = m.tokens ?? {}
    const increment: Partial<TokenBucket> = {
      input: t.input ?? 0,
      output: t.output ?? 0,
      cacheRead: t.cache?.read ?? 0,
      cacheWrite: t.cache?.write ?? 0,
      reasoning: t.reasoning ?? 0,
      steps: 1,
    }
    add(result.total, increment)

    const parts = partsLookup(m.id)
    const toolOutputs: Array<{ tool: string; chars: number }> = []
    for (const p of parts) {
      const pl = p as PartLike
      if (pl.type !== "tool") continue
      const out = getToolOutput(pl)
      if (!out) continue
      const toolName = String(pl.tool ?? "unknown")
      toolOutputs.push({ tool: toolName, chars: out.length })
    }

    if (toolOutputs.length === 0) continue
    if ((increment.input ?? 0) <= 0) continue

    let totalOutChars = 0
    for (const t of toolOutputs) totalOutChars += t.chars
    if (totalOutChars <= 0) continue

    const estimatedToolInput = Math.ceil(totalOutChars / 4)
    const denom = (increment.input ?? 0) + (increment.cacheRead ?? 0) + 1
    const ratio = Math.min(1, estimatedToolInput / denom)
    const totalAllocated = Math.round(((increment.input ?? 0) + (increment.cacheRead ?? 0)) * ratio)

    for (const { tool, chars } of toolOutputs) {
      const share = totalOutChars > 0 ? chars / totalOutChars : 1 / toolOutputs.length
      const allocated = Math.round(totalAllocated * share)
      const key = tool.startsWith("mcp_") || tool.includes("/") ? tool : `tool:${tool}`
      const bucket = result.byTool[key] ?? empty()
      add(bucket, { input: allocated, steps: 1 })
      result.byTool[key] = bucket
    }
  }

  result.sessionCount = seenSessions.size
  return result
}

export function formatNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K"
  return String(n)
}

export function topTools(byTool: Record<string, TokenBucket>, n = 5): Array<[string, TokenBucket]> {
  return Object.entries(byTool)
    .sort((a, b) => bucketTotal(b[1]) - bucketTotal(a[1]))
    .slice(0, n)
}

export { bucketTotal }
