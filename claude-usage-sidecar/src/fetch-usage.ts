import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { getDefaultConfig } from "./config.js"
import type { SessionSnapshot, SessionUsageState } from "./types.js"

export type UsageSummary = SessionUsageState

type ClaudeOauthBlob = {
  accessToken: string
  expiresAt?: number
  subscriptionType?: string
  rateLimitTier?: string
}

type UsageCacheRecord = {
  fetchedAt: string
  usage: SessionUsageState
  retryAt?: string
}

type UsageResponseLike = {
  ok: boolean
  status: number
  json: () => Promise<unknown>
  headers?: {
    get: (name: string) => string | null
  }
}

type UsageDeps = {
  existsSync: typeof existsSync
  mkdirSync: typeof mkdirSync
  readFileSync: typeof readFileSync
  writeFileSync: typeof writeFileSync
  fetch: (input: string, init?: RequestInit) => Promise<UsageResponseLike>
}

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
const BETA_HEADER = "oauth-2025-04-20"
const DEFAULT_CACHE_TTL_MS = 60_000
const DEFAULT_FAILURE_BACKOFF_MS = 30_000
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 60_000

const defaultDeps: UsageDeps = {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  fetch: (input, init) => fetch(input, init),
}

const unavailableUsage = (): SessionUsageState => ({
  available: false,
})

const readJsonFile = <T>(filePath: string, deps: UsageDeps): T | null => {
  try {
    return JSON.parse(deps.readFileSync(filePath, "utf8")) as T
  } catch {
    return null
  }
}

const readCachedUsage = (
  cacheFile: string,
  ttlMs: number,
  nowMs: number,
  deps: UsageDeps,
): SessionUsageState | null => {
  const cached = readJsonFile<UsageCacheRecord>(cacheFile, deps)

  if (
    cached === null ||
    typeof cached.fetchedAt !== "string" ||
    typeof cached.usage !== "object" ||
    cached.usage === null
  ) {
    return null
  }

  const fetchedAtMs = Date.parse(cached.fetchedAt)
  const retryAtMs =
    typeof cached.retryAt === "string" ? Date.parse(cached.retryAt) : Number.NaN

  if (Number.isFinite(retryAtMs) && retryAtMs > nowMs) {
    return cached.usage
  }

  if (!Number.isFinite(fetchedAtMs) || nowMs - fetchedAtMs > ttlMs) {
    return null
  }

  return cached.usage
}

const readOauthCredentials = (
  claudeDir: string,
  deps: UsageDeps,
): ClaudeOauthBlob | null => {
  const parsed = readJsonFile<{
    claudeAiOauth?: Partial<ClaudeOauthBlob>
  }>(path.join(claudeDir, ".credentials.json"), deps)

  if (
    parsed?.claudeAiOauth === undefined ||
    typeof parsed.claudeAiOauth.accessToken !== "string" ||
    parsed.claudeAiOauth.accessToken.trim().length === 0
  ) {
    return null
  }

  return {
    accessToken: parsed.claudeAiOauth.accessToken,
    expiresAt:
      typeof parsed.claudeAiOauth.expiresAt === "number"
        ? parsed.claudeAiOauth.expiresAt
        : undefined,
    subscriptionType:
      typeof parsed.claudeAiOauth.subscriptionType === "string"
        ? parsed.claudeAiOauth.subscriptionType
        : undefined,
    rateLimitTier:
      typeof parsed.claudeAiOauth.rateLimitTier === "string"
        ? parsed.claudeAiOauth.rateLimitTier
        : undefined,
  }
}

const isExpired = (credentials: ClaudeOauthBlob, nowMs: number): boolean =>
  typeof credentials.expiresAt === "number" && credentials.expiresAt <= nowMs

type UsageWindow = {
  utilization: number
  resets_at: string
}

const normalizeUsageWindow = (value: unknown): UsageWindow | null => {
  if (typeof value !== "object" || value === null) {
    return null
  }

  const record = value as Record<string, unknown>

  if (
    typeof record.utilization !== "number" ||
    typeof record.resets_at !== "string"
  ) {
    return null
  }

  return {
    utilization: record.utilization,
    resets_at: record.resets_at,
  }
}

const normalizeUsageSummary = (
  payload: unknown,
  planName?: string,
): SessionUsageState | null => {
  if (typeof payload !== "object" || payload === null) {
    return null
  }

  const record = payload as Record<string, unknown>
  const fiveHour = normalizeUsageWindow(record.five_hour)
  const sevenDay = normalizeUsageWindow(record.seven_day)

  if (fiveHour === null || sevenDay === null) {
    return null
  }

  return {
    available: true,
    planName,
    fiveHourUtilization: fiveHour.utilization,
    fiveHourResetAt: fiveHour.resets_at,
    sevenDayUtilization: sevenDay.utilization,
    sevenDayResetAt: sevenDay.resets_at,
  }
}

const writeUsageCache = (
  cacheFile: string,
  usage: SessionUsageState,
  fetchedAt: string,
  deps: UsageDeps,
  retryAt?: string,
): void => {
  deps.mkdirSync(path.dirname(cacheFile), { recursive: true })
  deps.writeFileSync(
    cacheFile,
    JSON.stringify(
      {
        fetchedAt,
        usage,
        retryAt,
      } satisfies UsageCacheRecord,
      null,
      2,
    ),
    "utf8",
  )
}

const parseRetryAfterMs = (
  response: UsageResponseLike,
  nowMs: number,
): number | null => {
  const headerValue = response.headers?.get("retry-after")

  if (headerValue === null || headerValue === undefined) {
    return null
  }

  const numericSeconds = Number(headerValue)

  if (Number.isFinite(numericSeconds) && numericSeconds >= 0) {
    return numericSeconds * 1000
  }

  const dateMs = Date.parse(headerValue)

  if (!Number.isFinite(dateMs)) {
    return null
  }

  return Math.max(dateMs - nowMs, 0)
}

export const fetchUsageSummary = async (options?: {
  usageCacheFile?: string
  claudeDir?: string
  ttlMs?: number
  now?: () => number
  deps?: Partial<UsageDeps>
}): Promise<SessionUsageState> => {
  const config = getDefaultConfig()
  const usageCacheFile = options?.usageCacheFile ?? config.usageCacheFile
  const claudeDir = options?.claudeDir ?? config.claudeDir
  const ttlMs = options?.ttlMs ?? DEFAULT_CACHE_TTL_MS
  const nowMs = options?.now?.() ?? Date.now()
  const deps: UsageDeps = {
    ...defaultDeps,
    ...options?.deps,
  }

  const cachedUsage = readCachedUsage(usageCacheFile, ttlMs, nowMs, deps)

  if (cachedUsage !== null) {
    return cachedUsage
  }

  const credentials = readOauthCredentials(claudeDir, deps)

  if (credentials === null || isExpired(credentials, nowMs)) {
    return unavailableUsage()
  }

  try {
    const response = await deps.fetch(USAGE_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "anthropic-beta": BETA_HEADER,
      },
    })

    if (!response.ok) {
      const unavailable = unavailableUsage()
      const retryMs =
        response.status === 429
          ? parseRetryAfterMs(response, nowMs) ?? DEFAULT_RATE_LIMIT_BACKOFF_MS
          : DEFAULT_FAILURE_BACKOFF_MS

      writeUsageCache(
        usageCacheFile,
        unavailable,
        new Date(nowMs).toISOString(),
        deps,
        new Date(nowMs + retryMs).toISOString(),
      )
      return unavailable
    }

    const usage = normalizeUsageSummary(
      await response.json(),
      credentials.subscriptionType ?? credentials.rateLimitTier,
    )

    if (usage === null) {
      return unavailableUsage()
    }

    writeUsageCache(usageCacheFile, usage, new Date(nowMs).toISOString(), deps)
    return usage
  } catch {
    const unavailable = unavailableUsage()
    writeUsageCache(
      usageCacheFile,
      unavailable,
      new Date(nowMs).toISOString(),
      deps,
      new Date(nowMs + DEFAULT_FAILURE_BACKOFF_MS).toISOString(),
    )
    return unavailable
  }
}

export const mergeUsageIntoSnapshot = (
  snapshot: SessionSnapshot,
  usage: UsageSummary,
): SessionSnapshot => {
  if (!usage.available) {
    return {
      ...snapshot,
      usage: {
        available: false,
      },
    }
  }

  return {
    ...snapshot,
    usage: {
      available: true,
      planName: usage.planName,
      fiveHourUtilization: usage.fiveHourUtilization,
      fiveHourResetAt: usage.fiveHourResetAt,
      sevenDayUtilization: usage.sevenDayUtilization,
      sevenDayResetAt: usage.sevenDayResetAt,
    },
  }
}
