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
  🔄 Steps                 80
  📨 Msgs                  91

─ By Tool (top 5) ─
  tool:bash             6.6K↓
  tool:skill            3.6K↓
  tool:read             2.2K↓

─ Skills Used ─
  • aihot             170 tok / 1x

# when no sidecar estimate exists yet
  • aihot               0 tok / 1x
  (refresh: 750ms)
```


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
| **Total (in/out/cache.r/cache.w/steps)** | `state.session.messages(id)` 累加每个 `AssistantMessage.tokens` (LLM provider 报告) | ✅ **精确 / Exact** |
| **By Tool (粗略 / coarse)** | 同上,按 `ToolPart.tool` 分类;`input + cacheRead` 按 tool output 文本长度 / 4 估算 | ⚠️ **粗略 / Coarse** (provider 只给整轮 token,这里只能按输出文本比例分摊) |
| **Skills Used (推荐 / recommended)** | 当前会话里的真实 `tool:skill` 调用 + 可选 `server.ts` sidecar 提供的每个 skill 单次 token 估算 | ⚠️ **半精确 / Semi-precise**: 调用次数是真实值,`tok` 仍是按 sidecar `chars/4` 推出来的估算值 |

> **关于 Skill 维度** / **About the Skill dimension**:
> `Skills Used` 现在只统计当前 session 内真实发起过的 `tool:skill` 调用,格式为 `170 tok / 1x`。
> `Skills Used` now counts only real `tool:skill` calls from the current session, formatted as `170 tok / 1x`.
> 其中 `x` 是真实调用次数;`tok` 需要配合可选 `plugins/token-usage-tui/src/server.ts` sidecar 插件,用每轮 system prompt 中 `<skill>` 块的 `chars/4` 做单次估算后累计。
> Here `x` is the real call count; `tok` requires the optional `plugins/token-usage-tui/src/server.ts` sidecar plugin and is estimated from each skill block's `chars/4` footprint in the system prompt.
> 如果 sidecar 暂时不存在或读取失败,UI 仍会保留真实 skill 调用,只是 token 估算会降级为 `0 tok / Nx`。
> If the sidecar is missing or temporarily unreadable, the UI still shows real skill calls and simply degrades the estimate to `0 tok / Nx`.

### 可选: 安装 server sidecar 插件 / Optional: install the server sidecar plugin

把 `plugins/token-usage-tui/src/server.ts` 复制到:
Copy `plugins/token-usage-tui/src/server.ts` to:

```text
<worktree>/.opencode/plugins/token-usage-server.ts
```

或全局目录:
Or the global plugin directory:

```text
~/.config/opencode/plugins/token-usage-server.ts
```

server 插件会把每轮 skill 使用情况写到:
The server plugin writes per-turn skill usage to:

```text
.opencode/.cache/token-usage-tui/sidecar/<session-id>.jsonl
```

出于安全原因,文件名里的 `sessionId` 会先做净化,避免路径逃逸。
For safety, the `sessionId` in the filename is sanitized before writing, which prevents path traversal.

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

optional server hook:
experimental.chat.system.transform
       ↓
parse <skill> blocks
       ↓
.opencode/.cache/token-usage-tui/sidecar/*.jsonl
       ↓
TokenSidebar + session parts → real tool:skill calls
       ↓
merge call counts with sidecar estimates
       ↓
Skills Used
```

默认 TUI 侧仍然是**无后台进程**;只有安装可选 server 插件时才会生成 sidecar 文件。
The TUI remains **background-process free** by default; sidecar files are only generated when the optional server plugin is installed.

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

如果启用了 server sidecar,也可以直接检查:
If the server sidecar is enabled, you can also inspect:

```text
.opencode/.cache/token-usage-tui/sidecar/
```

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
- **By Tool 仍是估算** / **By Tool is still estimated**: 即便修复了 `cacheRead` 和结构化输出统计,provider 仍不会返回逐 tool token。 / Even with the fixes, providers still do not return per-tool token counts.
- **Skills Used 的调用次数是真实的,`tok` 仍是估算** / **Skills Used call counts are real, but `tok` is still estimated**: 调用次数来自真实 `tool:skill` parts; token 仍依赖 sidecar 中 `<skill>` 块的 `chars/4` 估算,不是 provider 级精确账单。 / Call counts come from real `tool:skill` parts; token values still rely on sidecar `chars/4` estimates rather than provider-billed per-skill tokens.
- **sidecar 缺失时会降级到 `0 tok / Nx`** / **Missing sidecar degrades to `0 tok / Nx`**: 为避免把真实调用整块吞掉,没有 sidecar 或读取失败时仍显示真实 skill 调用次数。 / To avoid hiding real calls, the UI still shows real skill invocation counts when the sidecar is missing or unreadable.

## 测试 / Testing

```bash
cd plugins/token-usage-tui
npm test
```

## 路线图 / Roadmap

- 短期 / short term: 加 cache 让 sidebar 切换 session 时不闪 / add cache to prevent flicker on session switch
- 中期 / mid term: 跨 session 累计 + 历史趋势 / cross-session accumulation + history trend
- 长期 / long term: 配合改 opencode 源码做 SKILL 维度精确切分 / cooperate with opencode source change to split SKILL dimension precisely

---

## 协议 / License

MIT
