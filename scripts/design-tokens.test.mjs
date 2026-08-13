import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

const root = process.cwd()

async function readUtf8(path) {
  return readFile(resolve(root, path), "utf8")
}

describe("shared design tokens package", () => {
  it("exports a CSS entry from an independent workspace package", async () => {
    const [workspace, rootPackage, tokenPackage] = await Promise.all([
      readUtf8("pnpm-workspace.yaml"),
      readUtf8("package.json").then(JSON.parse),
      readUtf8("packages/design-tokens/package.json").then(JSON.parse),
    ])

    expect(workspace).toContain("packages/*")
    expect(rootPackage.dependencies["@daoyun/design-tokens"]).toBe("workspace:*")
    expect(tokenPackage).toMatchObject({
      name: "@daoyun/design-tokens",
      version: "0.1.0",
      type: "module",
      exports: { "./tokens.css": "./tokens.css" },
    })
    expect(tokenPackage.files).toContain("tokens.css")
  })

  it("preserves the supported themes, presets, and responsive token overrides", async () => {
    const css = await readUtf8("packages/design-tokens/tokens.css")

    expect(css).toContain(":root {")
    expect(css).toContain(':root[data-theme="dark"]')
    expect(css).toContain(':root[data-brand-preset="compact"]')
    expect(css).toContain(':root[data-brand-preset="high_contrast"]')
    expect(css).toContain('@media (max-width: 900px)')
    expect(css).toContain("--background: #f7f8f7")
    expect(css).toContain("--brand: #176a4d")
    expect(css).toContain("--header-height: 58px")
  })

  it("loads shared tokens before product styles and keeps one declaration source", async () => {
    const [entry, productStyles] = await Promise.all([
      readUtf8("src/main.tsx"),
      readUtf8("src/styles.css"),
    ])

    const tokenImport = 'import "@daoyun/design-tokens/tokens.css"'
    const productImport = 'import "./styles.css"'
    expect(entry).toContain(tokenImport)
    expect(entry.indexOf(tokenImport)).toBeLessThan(entry.indexOf(productImport))
    expect(productStyles).not.toMatch(/^\s*--[a-z][a-z0-9-]*\s*:/m)
  })
})
