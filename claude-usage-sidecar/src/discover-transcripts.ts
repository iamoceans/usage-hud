import * as fs from "node:fs"
import * as path from "node:path"

export const discoverTranscripts = (projectsDir: string): string[] => {
  const discovered: string[] = []
  const stack = [projectsDir]

  while (stack.length > 0) {
    const currentDir = stack.pop()

    if (currentDir == null) {
      continue
    }

    let entries: fs.Dirent[]

    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name)

      if (entry.isDirectory()) {
        stack.push(fullPath)
        continue
      }

      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        discovered.push(fullPath)
      }
    }
  }

  return discovered.sort()
}
