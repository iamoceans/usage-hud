import type { SessionSnapshot, ToolCounter } from "./types.js"

const formatToolLine = (name: string, counter: ToolCounter): string =>
  `- ${name}: ${counter.calls} calls (${counter.completed} completed, ${counter.errors} errors, ${counter.running} running)`

export const renderSessionReport = (snapshot: SessionSnapshot): string => {
  const toolLines = Object.entries(snapshot.tools)
    .sort(([leftName], [rightName]) => leftName.localeCompare(rightName))
    .map(([name, counter]) => formatToolLine(name, counter))

  const toolsSection = toolLines.length > 0 ? toolLines : ["- none"]

  return [
    `session: ${snapshot.sessionId}`,
    `last activity: ${snapshot.lastActivityAt ?? "unknown"}`,
    "tools:",
    ...toolsSection,
    `todos: ${snapshot.todos.completed}/${snapshot.todos.total} completed`,
    `usage available: ${snapshot.usage.available ? "yes" : "no"}`,
    `per-tool tokens: ${snapshot.limitations.perToolTokens}`,
    `per-skill tokens: ${snapshot.limitations.perSkillTokens}`,
  ].join("\n")
}
