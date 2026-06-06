/** @jsxImportSource @opentui/solid */
/** @jsxRuntime automatic */
import { createSignal, onCleanup, Show, For } from "solid-js"
import type { Message, Part } from "@opencode-ai/sdk/v2"
import type { TuiTheme } from "@opencode-ai/plugin/tui"
import { aggregate, formatNum, topTools, bucketTotal, type TokenBucket, type SkillSize } from "../aggregator"

export type TokenSidebarProps = {
  sessionId: string
  getMessages: (id: string) => ReadonlyArray<Message>
  getParts: (messageID: string) => ReadonlyArray<Part>
  loadedSkills: string[]
  skillSizes: SkillSize[]
  theme: TuiTheme
  refreshMs?: number
}

export function TokenSidebar(props: TokenSidebarProps) {
  const [tick, setTick] = createSignal(0)
  const interval = setInterval(() => setTick((t) => t + 1), props.refreshMs ?? 750)
  onCleanup(() => clearInterval(interval))

  const refreshMs = props.refreshMs ?? 750

  const compute = () => {
    try {
      const messages = props.getMessages(props.sessionId)
      return aggregate(messages, (mid) => props.getParts(mid), props.loadedSkills, props.skillSizes)
    } catch {
      return null
    }
  }

  // Re-compute on each tick to force reactivity.
  const data = () => {
    tick()
    return compute()
  }

  const t = props.theme.current
  const colorText = t.text
  const colorMuted = t.textMuted
  const colorAccent = t.accent
  const colorSuccess = t.success
  const colorWarning = t.warning

  return (
    <Show when={data()} fallback={<text fg={colorMuted}>loading token usage…</text>}>
      {(d) => {
        const tot = () => d().total
        const tools = () => topTools(d().byTool, 5)
        const totalAll = () => bucketTotal(tot())
        const data_ = () => d()

        return (
          <box flexDirection="column" paddingLeft={1} paddingRight={1}>
            {/* Header */}
            <text fg={colorAccent}>{"─ Token Usage ─".padEnd(40, " ")}</text>

            {/* Total section */}
            <box flexDirection="row">
              <text fg={colorText}>{"📊 Total".padEnd(14, " ")}</text>
              <text fg={colorMuted}>{`${formatNum(totalAll())} tok`}</text>
            </box>
            <text fg={colorMuted}>{"  ├─ in  ".padEnd(14, " ")}{formatNum(tot().input ?? 0)}</text>
            <text fg={colorMuted}>{"  ├─ out ".padEnd(14, " ")}{formatNum(tot().output ?? 0)}</text>
            <text fg={colorSuccess}>{"  ├─ cache.r ".padEnd(14, " ")}{formatNum(tot().cacheRead ?? 0)}</text>
            <text fg={colorMuted}>{"  └─ cache.w ".padEnd(14, " ")}{formatNum(tot().cacheWrite ?? 0)}</text>
            <text fg={colorMuted}>{"  🔄 Steps".padEnd(14, " ")}{tot().steps ?? 0}</text>
            <text fg={colorMuted}>{"  📨 Msgs".padEnd(14, " ")}{data_().messageCount}</text>

            <text>{" "}</text>

            {/* By tool section */}
            <text fg={colorAccent}>{"─ By Tool (top 5) ─".padEnd(40, " ")}</text>
            <Show
              when={tools().length > 0}
              fallback={<text fg={colorMuted}>{"  (no tool calls yet)"}</text>}
            >
              <For each={tools()}>
                {([name, b]) => (
                  <box flexDirection="row">
                    <text fg={colorText}>{`  ${name}`.padEnd(22, " ").slice(0, 22)}</text>
                    <text fg={colorMuted}>{` ${formatNum(b.input ?? 0)}↓`}</text>
                  </box>
                )}
              </For>
            </Show>

            <text>{" "}</text>

            {/* Skills section */}
            <text fg={colorAccent}>{"─ Skills Loaded (est) ─".padEnd(40, " ")}</text>
            <Show
              when={data_().skillSizes.length > 0}
              fallback={<text fg={colorMuted}>{"  (none detected)"}</text>}
            >
              <For each={data_().skillSizes.slice(0, 8)}>
                {(s) => (
                  <box flexDirection="row">
                    <text fg={colorText}>{`  • ${s.name.slice(0, 22)}`.padEnd(22, " ")}</text>
                    <text fg={colorMuted}>{` ${formatNum(s.estTokens)}*`}</text>
                  </box>
                )}
              </For>
              <Show when={data_().skillSizes.length > 8}>
                <text fg={colorMuted}>{`  … +${data_().skillSizes.length - 8} more`}</text>
              </Show>
              <text fg={colorMuted}>{"  * = static size (chars/4)"}</text>
            </Show>

            <text fg={colorMuted}>{`  (refresh: ${refreshMs}ms)`}</text>
          </box>
        )
      }}
    </Show>
  )
}
