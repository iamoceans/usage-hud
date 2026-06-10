import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createEmptySessionState, toPersistedSessionSnapshot } from "./aggregate-session-state.js"
import { fetchUsageSummary, mergeUsageIntoSnapshot } from "./fetch-usage.js"

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe("mergeUsageIntoSnapshot", () => {
  it("attaches usage availability without inventing session token splits", () => {
    const snapshot = toPersistedSessionSnapshot(createEmptySessionState("session-1"))

    const next = mergeUsageIntoSnapshot(snapshot, {
      planName: "Max",
      fiveHourUtilization: 24,
      fiveHourResetAt: "2026-06-10T05:00:00.000Z",
      sevenDayUtilization: 80,
      sevenDayResetAt: "2026-06-14T00:00:00.000Z",
      available: true,
    })

    expect(next).not.toBe(snapshot)
    expect(next.usage).toEqual({
      available: true,
      planName: "Max",
      fiveHourUtilization: 24,
      fiveHourResetAt: "2026-06-10T05:00:00.000Z",
      sevenDayUtilization: 80,
      sevenDayResetAt: "2026-06-14T00:00:00.000Z",
    })
    expect(next.limitations).toEqual({
      perToolTokens: "unavailable",
      perSkillTokens: "unavailable",
    })
    expect(next.usage).not.toHaveProperty("sessionInputTokens")
    expect(next.usage).not.toHaveProperty("sessionOutputTokens")
  })

  it("clears stale usage fields when availability falls back to false", () => {
    const snapshot = mergeUsageIntoSnapshot(
      toPersistedSessionSnapshot(createEmptySessionState("session-1")),
      {
        available: true,
        planName: "Max",
        fiveHourUtilization: 12,
        fiveHourResetAt: "2026-06-10T05:00:00.000Z",
        sevenDayUtilization: 34,
        sevenDayResetAt: "2026-06-14T00:00:00.000Z",
      },
    )

    const next = mergeUsageIntoSnapshot(snapshot, { available: false })

    expect(next.usage).toEqual({ available: false })
  })
})

describe("fetchUsageSummary", () => {
  it("returns a fresh cached usage snapshot without fetching again", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "usage-sidecar-usage-"))
    tempRoots.push(root)
    const usageCacheFile = path.join(root, "usage-cache.json")
    writeFileSync(
      usageCacheFile,
      JSON.stringify({
        fetchedAt: "2026-06-10T00:00:00.000Z",
        usage: {
          available: true,
          planName: "Max",
          fiveHourUtilization: 42,
          fiveHourResetAt: "2026-06-10T05:00:00.000Z",
          sevenDayUtilization: 77,
          sevenDayResetAt: "2026-06-14T00:00:00.000Z",
        },
      }),
      "utf8",
    )
    const fetchFn = vi.fn()

    const usage = await fetchUsageSummary({
      usageCacheFile,
      claudeDir: root,
      ttlMs: 60_000,
      now: () => Date.parse("2026-06-10T00:00:30.000Z"),
      deps: {
        fetch: fetchFn,
      },
    })

    expect(usage).toEqual({
      available: true,
      planName: "Max",
      fiveHourUtilization: 42,
      fiveHourResetAt: "2026-06-10T05:00:00.000Z",
      sevenDayUtilization: 77,
      sevenDayResetAt: "2026-06-14T00:00:00.000Z",
    })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it("fetches authoritative usage and persists it into the local cache", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "usage-sidecar-usage-"))
    tempRoots.push(root)
    const usageCacheFile = path.join(root, "usage-cache.json")
    writeFileSync(
      path.join(root, ".credentials.json"),
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "oauth-token",
          expiresAt: Date.parse("2026-06-10T01:00:00.000Z"),
          subscriptionType: "Max",
        },
      }),
      "utf8",
    )
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        five_hour: {
          utilization: 24,
          resets_at: "2026-06-10T05:00:00.000Z",
        },
        seven_day: {
          utilization: 80,
          resets_at: "2026-06-14T00:00:00.000Z",
        },
      }),
    })

    const usage = await fetchUsageSummary({
      usageCacheFile,
      claudeDir: root,
      now: () => Date.parse("2026-06-10T00:00:00.000Z"),
      deps: {
        fetch: fetchFn,
      },
    })

    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(usage).toEqual({
      available: true,
      planName: "Max",
      fiveHourUtilization: 24,
      fiveHourResetAt: "2026-06-10T05:00:00.000Z",
      sevenDayUtilization: 80,
      sevenDayResetAt: "2026-06-14T00:00:00.000Z",
    })

    const cached = JSON.parse(readFileSync(usageCacheFile, "utf8")) as {
      fetchedAt: string
      usage: Record<string, unknown>
    }

    expect(cached.fetchedAt).toBe("2026-06-10T00:00:00.000Z")
    expect(cached.usage).toEqual(usage)
  })

  it("falls back to unavailable when credentials are missing or unusable", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "usage-sidecar-usage-"))
    tempRoots.push(root)
    const fetchFn = vi.fn()

    const usage = await fetchUsageSummary({
      usageCacheFile: path.join(root, "usage-cache.json"),
      claudeDir: root,
      deps: {
        fetch: fetchFn,
      },
    })

    expect(usage).toEqual({ available: false })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it("writes a retry-backoff cache entry when the usage endpoint is rate limited", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "usage-sidecar-usage-"))
    tempRoots.push(root)
    const usageCacheFile = path.join(root, "usage-cache.json")
    writeFileSync(
      path.join(root, ".credentials.json"),
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "oauth-token",
          expiresAt: Date.parse("2026-06-10T01:00:00.000Z"),
        },
      }),
      "utf8",
    )
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: {
        get: (name: string) => (name.toLowerCase() === "retry-after" ? "120" : null),
      },
      json: async () => ({}),
    })

    const usage = await fetchUsageSummary({
      usageCacheFile,
      claudeDir: root,
      now: () => Date.parse("2026-06-10T00:00:00.000Z"),
      deps: {
        fetch: fetchFn,
      },
    })

    expect(usage).toEqual({ available: false })

    const cached = JSON.parse(readFileSync(usageCacheFile, "utf8")) as {
      fetchedAt: string
      retryAt?: string
      usage: Record<string, unknown>
    }

    expect(cached.fetchedAt).toBe("2026-06-10T00:00:00.000Z")
    expect(cached.retryAt).toBe("2026-06-10T00:02:00.000Z")
    expect(cached.usage).toEqual({ available: false })
  })

  it("reuses backoff cache entries without refetching during the retry window", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "usage-sidecar-usage-"))
    tempRoots.push(root)
    const usageCacheFile = path.join(root, "usage-cache.json")
    writeFileSync(
      path.join(root, ".credentials.json"),
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "oauth-token",
          expiresAt: Date.parse("2026-06-10T01:00:00.000Z"),
        },
      }),
      "utf8",
    )
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: {
          get: (name: string) => (name.toLowerCase() === "retry-after" ? "120" : null),
        },
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          five_hour: {
            utilization: 55,
            resets_at: "2026-06-10T05:00:00.000Z",
          },
          seven_day: {
            utilization: 66,
            resets_at: "2026-06-14T00:00:00.000Z",
          },
        }),
      })

    const first = await fetchUsageSummary({
      usageCacheFile,
      claudeDir: root,
      now: () => Date.parse("2026-06-10T00:00:00.000Z"),
      deps: {
        fetch: fetchFn,
      },
    })
    const second = await fetchUsageSummary({
      usageCacheFile,
      claudeDir: root,
      now: () => Date.parse("2026-06-10T00:01:00.000Z"),
      deps: {
        fetch: fetchFn,
      },
    })

    expect(first).toEqual({ available: false })
    expect(second).toEqual({ available: false })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
})
