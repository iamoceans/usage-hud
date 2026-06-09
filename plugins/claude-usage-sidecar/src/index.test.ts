import { describe, expect, it } from "vitest"
import * as publicApi from "./index.js"

describe("public package exports", () => {
  it("does not re-export the CLI entrypoint", () => {
    expect(publicApi).not.toHaveProperty("runCli")
  })
})
