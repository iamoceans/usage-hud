# usage-hud

> 实时在 opencode TUI 侧边栏渲染 token 消耗,按 **总计 / 工具 / 技能** 三维展示。
> Real-time token consumption sidebar for opencode TUI, broken down by **total / tool / skill**.

在 session 运行时,会在右侧 sidebar 显示类似这样的内容:
While a session is running, the right sidebar shows something like:

```
─ Token Usage ─
📊 Total                8.07M tok
  ├─ in                 902.4K
  ├─ out                 82.0K
  ├─ cache.r            7.08M
  └─ cache.w                0
  💰 Cost             $0.0000
  🔄 Steps                 80
  📨 Msgs                  91

─ By Tool (top 5) ─
  tool:webfetch        56.1K↓
  tool:websearch       27.4K↓
  tool:read            12.0K↓
  tool:bash             5.7K↓
  tool:skill            3.4K↓

─ Skills Loaded (est) ─
  • lark-base         110.1K*
  • guizang-ppt-skill  87.8K*
  • lark-slides        57.3K*
  …
  * = static size (chars/4)
  (refresh: 750ms)
```

灵感来自 [claude-hud](https://github.com/jarrodwatts/claude-hud) (Claude Code) 和 [opencodeBar](https://github.com/Icicno/opencodeBar) / [OCometixLine](https://github.com/anomalyco/opencodeBar) (opencode)。
Inspired by [claude-hud](https://github.com/jarrodwatts/claude-hud) (Claude Code) and [opencodeBar](https://github.com/Icicno/opencodeBar) / [OCometixLine](https://github.com/anomalyco/opencodeBar) (opencode).

---

## 安装 / Installation

### 1. 克隆仓库 / Clone the repo

```bash
git clone https://github.com/YOUR-USERNAME/usage-hud.git
cd usage-hud
```

### 2. 安装依赖 / Install dependencies

```bash
cd plugins/token-usage-tui
npm install
cd ../..
```

### 3. 配置 opencode 加载插件 / Configure opencode to load the plugin

把 `tui.json` 放到项目的 `.opencode/` 目录下(或者 `~/.config/opencode/`,全局生效):
Drop `tui.json` into your project's `.opencode/` directory (or `~/.config/opencode/` for global):

```bash
# 项目级别 (per-project)
mkdir -p .opencode
cp tui.json .opencode/tui.json

# 或者全局 (or global)
mkdir -p ~/.config/opencode
cp tui.json ~/.config/opencode/tui.json
```

**重要:必须编辑 `tui.json` 把 `file:///REPLACE-WITH-...` 替换成你机器上的绝对路径。**
**Important: edit `tui.json` to replace `file:///REPLACE-WITH-...` with the absolute path on your machine.**

- **macOS / Linux**: `file:///Users/you/path/to/usage-hud/plugins/token-usage-tui/src/index.tsx`
- **Windows**: `file:///D:/path/to/usage-hud/plugins/token-usage-tui/src/index.tsx` (正斜杠 / forward slashes, 三个斜杠 / three slashes)

### 4. 重启 opencode / Restart opencode

```bash
cd /path/to/your/project
opencode
```

进入任意 session,右侧 sidebar 会出现 "─ Token Usage ─" 区块。
Open any session, and the right sidebar will show the "─ Token Usage ─" block.

---

## 三个维度的精度 / Accuracy of the three dimensions

| 维度 / Dimension | 数据源 / Data source | 精度 / Accuracy |
|---|---|---|
| **Total (in/out/cache.r/cache.w/cost/steps)** | `state.session.messages(id)` 累加每个 `AssistantMessage.tokens` (LLM provider 报告) | ✅ **精确 / Exact** |
| **By Tool (粗略 / coarse)** | 同上,按 `ToolPart.tool` 分类;input tokens 按 tool output 字符数 / 4 估算 | ⚠️ **粗略 / Coarse** (input 是一次性结算,按 output 字符数比例分摊) |
| **Skills (est / 估计)** | 启动时扫 `.opencode/skills/` 等目录,统计每个 skill 的文本文件大小 / 4 | ⚠️ **只能显示静态大小,无法按 token 切分** (plugin 层看不到 system prompt 内部组成) |

> **关于 Skill 维度** / **About the Skill dimension**:
> LLM 提供商每次调用只返回一个 `input` token 计数;opencode 服务端组装 system prompt 时不公开每个 skill 贡献了多少。
> The LLM provider reports only one `input` token count per turn; opencode assembles the system prompt server-side and never tells us how much each skill contributed.
> 这个插件只能显示 skill 的**静态内容大小**(chars/4),不能显示实际每轮的 token 消耗。
> This plugin can only show the **static content size** of each skill (chars/4), not per-turn token consumption.
> 适合用来**精简 skill 集合** — 如果某个 skill 8K tokens 但你很少用,可以移出自动加载路径。
> Useful for **pruning your skill set** — if a skill is 8K tokens but you rarely use it, move it out of the auto-loaded path.

如需真正的按 turn / 按 skill 的 token 分解,只有两条路:
For real per-turn, per-skill token breakdowns, there are only two paths:
1. 修改 opencode 的 `system-prompt.ts` 让它输出 per-skill 分解 (Patch opencode's `system-prompt.ts`)
2. 在网络层代理 LLM HTTP 调用 (Helicone / OpenLLMetry),解析 system prompt 组件 (Proxy the LLM HTTP call at the network layer and parse system prompt components)

---

## 架构 / Architecture

```
api.state.session.messages(id)   ← 无状态直读 / stateless direct read
       ↓
aggregate()  纯函数归类  / pure function aggregation
       ↓
createSignal + setInterval(750ms)  触发重渲染  / trigger re-render
       ↓
JSX → sidebar_content slot
       ↓
@opentui/solid  渲染  / render
```

**无文件持久化、无后台进程** — 跟 claude-hud 同款设计哲学。
**No file persistence, no background process** — same design philosophy as claude-hud.

---

## 关键 API 用法 / Key API Usage

```ts
// 注册 sidebar slot  / register sidebar slot
api.slots.register({
  order: 50,  // 数字越小越靠前  / smaller numbers render earlier
  slots: {
    sidebar_content: (ctx, props: { session_id: string }) => {
      return <YourComponent sessionId={props.session_id} />
    },
  },
})

// 拿数据 (无状态,每次重读)  / get data (stateless, re-read every time)
api.state.session.messages(sessionID)  // → Message[]
api.state.part(messageID)              // → Part[]
api.state.session.get(sessionId)       // → Session
```

详见 [opencode TUI plugin 文档](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/specs/tui-plugins.md)。
See the [opencode TUI plugin docs](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/specs/tui-plugins.md).

---

## 调试 / Debugging

启动 opencode 时加 `--log-level DEBUG`:
Start opencode with `--log-level DEBUG`:

```bash
opencode --log-level DEBUG
```

日志位置 / Log location: `~/.local/share/opencode/log/`

成功会看到 / On success you'll see:
```
token-usage-tui initialized
```

失败会看到 / On failure:
```
failed to load plugin
```
最常见原因 / most common cause: `tui.json` 里 `file://` 路径错误 / wrong `file://` path in `tui.json`.

---

## 已知限制 / Known Limitations

- **跨 session 不累计** / **No cross-session accumulation**: 当前 sidebar 只显示当前 session 的数据。 / The sidebar only shows the current session's data.
- **macOS 不支持相对路径** / **macOS does not support relative paths** in `tui.json` (opencodeBar 文档确认 / confirmed by opencodeBar docs);用 `file://` + 绝对路径。 / Use `file://` + absolute path.
- **Skill 维度无法精确切分** / **Skill dimension cannot be split precisely** without modifying opencode.

## 路线图 / Roadmap

- 短期 / short term: 加 cache 让 sidebar 切换 session 时不闪 / add cache to prevent flicker on session switch
- 中期 / mid term: 跨 session 累计 + 历史趋势 / cross-session accumulation + history trend
- 长期 / long term: 配合改 opencode 源码做 SKILL 维度精确切分 / cooperate with opencode source change to split SKILL dimension precisely

---

## 协议 / License

MIT
