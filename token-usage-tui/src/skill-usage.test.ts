import { describe, expect, it } from "vitest"
import {
  formatSkillUsageDisplay,
  summarizeRealSkillUsage,
  summarizeSkillUsageContent,
} from "./skill-usage"

describe("summarizeSkillUsageContent", () => {
  it("sums estTokens across turns and sorts by total descending", () => {
    const content = [
      JSON.stringify({
        skills: [
          { name: "xlsx", estTokens: 273 },
          { name: "docx", estTokens: 120 },
        ],
      }),
      JSON.stringify({
        skills: [
          { name: "xlsx", estTokens: 300 },
          { name: "docx", estTokens: 110 },
          { name: "pptx", estTokens: 90 },
        ],
      }),
    ].join("\n")

    const result = summarizeSkillUsageContent(content)

    expect(result).toEqual([
      { name: "xlsx", totalEstTokens: 573, turns: 2 },
      { name: "docx", totalEstTokens: 230, turns: 2 },
      { name: "pptx", totalEstTokens: 90, turns: 1 },
    ])
  })

  it("formats total first and turns as secondary info", () => {
    expect(formatSkillUsageDisplay({ name: "xlsx", totalEstTokens: 2200, turns: 14 })).toBe("2.2K / 14t")
  })

  it("counts real skill tool calls and only attributes estTokens to actually called skills", () => {
    const messages = [
      {
        id: "assistant-1",
        role: "assistant",
        time: { created: 100 },
      },
      {
        id: "assistant-2",
        role: "assistant",
        time: { created: 200 },
      },
    ] as any

    const partsLookup = (messageID: string) =>
      ({
        "assistant-1": [
          {
            type: "tool",
            tool: "skill",
            state: { status: "completed", input: { name: "aihot" }, output: "ok" },
          },
          {
            type: "tool",
            tool: "bash",
            state: { status: "completed", input: { command: "pwd" }, output: "D:\\" },
          },
        ],
        "assistant-2": [
          {
            type: "tool",
            tool: "skill",
            state: { status: "error", input: { name: "aihot" }, error: "failed" },
          },
          {
            type: "tool",
            tool: "skill",
            state: { status: "running", input: { name: "lark-doc" } },
          },
        ],
      })[messageID] ?? []

    const content = [
      JSON.stringify({
        ts: 90,
        skills: [
          { name: "aihot", estTokens: 170 },
          { name: "xlsx", estTokens: 273 },
        ],
      }),
      JSON.stringify({
        ts: 190,
        skills: [
          { name: "aihot", estTokens: 170 },
          { name: "lark-doc", estTokens: 129 },
          { name: "pptx", estTokens: 210 },
        ],
      }),
    ].join("\n")

    expect(summarizeRealSkillUsage(messages, partsLookup as any, content)).toEqual([
      { name: "aihot", totalEstTokens: 340, calls: 2 },
      { name: "lark-doc", totalEstTokens: 129, calls: 1 },
    ])
  })

  it("recognizes tool:skill parts from the runtime payload", () => {
    const messages = [
      {
        id: "assistant-runtime-1",
        role: "assistant",
      },
    ] as any

    const partsLookup = () =>
      [
        {
          type: "tool",
          tool: "tool:skill",
          state: { status: "completed", input: { name: "aihot" }, output: "ok" },
        },
      ] as any

    const content = JSON.stringify({
      skills: [{ name: "aihot", estTokens: 170 }],
    })

    expect(summarizeRealSkillUsage(messages, partsLookup as any, content)).toEqual([
      { name: "aihot", totalEstTokens: 170, calls: 1 },
    ])
  })

  it("falls back to nested/raw strings when the skill name is not stored under a fixed key", () => {
    const messages = [
      {
        id: "assistant-3",
        role: "assistant",
        time: { created: 300 },
      },
    ] as any

    const partsLookup = () =>
      [
        {
          type: "tool",
          tool: "skill",
          state: {
            status: "completed",
            input: {
              payload: {
                raw: '{"skillName":"aihot"}',
              },
            },
            output: "ok",
          },
        },
      ] as any

    const content = JSON.stringify({
      ts: 250,
      skills: [{ name: "aihot", estTokens: 170 }],
    })

    expect(summarizeRealSkillUsage(messages, partsLookup as any, content)).toEqual([
      { name: "aihot", totalEstTokens: 170, calls: 1 },
    ])
  })

  it("extracts the skill name from raw JSON strings even without sidecar-known skills", () => {
    const messages = [
      {
        id: "assistant-raw-no-sidecar",
        role: "assistant",
      },
    ] as any

    const partsLookup = () =>
      [
        {
          type: "tool",
          tool: "tool:skill",
          state: {
            status: "completed",
            input: '{"name":"aihot"}',
            output: "ok",
          },
        },
      ] as any

    expect(summarizeRealSkillUsage(messages, partsLookup as any, "")).toEqual([
      { name: "aihot", totalEstTokens: 0, calls: 1 },
    ])
  })

  it("counts skill tool calls even when the hosting message is not assistant-role", () => {
    const messages = [
      {
        id: "user-1",
        role: "user",
      },
    ] as any

    const partsLookup = () =>
      [
        {
          type: "tool",
          tool: "skill",
          state: {
            status: "completed",
            input: {
              name: "aihot",
            },
          },
        },
      ] as any

    const content = JSON.stringify({
      ts: 250,
      skills: [{ name: "xlsx", estTokens: 170 }],
    })

    expect(summarizeRealSkillUsage(messages, partsLookup as any, content)).toEqual([
      { name: "aihot", totalEstTokens: 0, calls: 1 },
    ])
  })

  it("formats token estimate and call count for real skill usage", () => {
    expect(formatSkillUsageDisplay({ name: "aihot", totalEstTokens: 510, calls: 3 } as any)).toBe(
      "510 tok / 3x"
    )
  })
})
