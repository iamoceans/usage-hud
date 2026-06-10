import { mkdir, readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { build } from "esbuild"
import { transformAsync } from "@babel/core"
import solid from "babel-preset-solid"
import ts from "@babel/preset-typescript"

const root = resolve(import.meta.dirname)

const opentuiSolidPlugin = {
  name: "opentui-solid-babel",
  setup(buildContext) {
    buildContext.onLoad({ filter: /\.[cm]?[jt]sx$/ }, async (args) => {
      const source = await readFile(args.path, "utf8")
      const transformed = await transformAsync(source, {
        filename: args.path,
        configFile: false,
        babelrc: false,
        presets: [
          [
            solid,
            {
              moduleName: "@opentui/solid",
              generate: "universal",
            },
          ],
          [ts],
        ],
      })

      return {
        contents: transformed?.code ?? "",
        loader: "js",
      }
    })

    buildContext.onLoad({ filter: /\.[cm]?ts$/ }, async (args) => {
      const source = await readFile(args.path, "utf8")
      return {
        contents: source,
        loader: "ts",
      }
    })
  },
}

const common = {
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  packages: "external",
  plugins: [opentuiSolidPlugin],
  sourcemap: false,
  logLevel: "info",
}

const outputs = [
  {
    entryPoints: [resolve(root, "src/index.tsx")],
    outfile: resolve(root, "dist/index.js"),
  },
  {
    entryPoints: [resolve(root, "src/server.ts")],
    outfile: resolve(root, "dist/server.js"),
  },
]

for (const config of outputs) {
  await mkdir(dirname(config.outfile), { recursive: true })
  await build({
    ...common,
    ...config,
  })
}
