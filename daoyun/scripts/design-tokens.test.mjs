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
    expect(css).toContain("--background: #f7f9fc")
    expect(css).toContain("--surface: #ffffff")
    expect(css).toContain("--text: #111827")
    expect(css).toContain("--text-soft: #626b78")
    expect(css).toContain("--border: #e5e7eb")
    expect(css).toContain("--brand: #2563eb")
    expect(css).toContain("--brand-hover: #1d4ed8")
    expect(css).toContain("--brand-active: #1e40af")
    expect(css).toContain("--brand-soft: #eaf2ff")
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

  it("defaults the public topic stream to a compact content-first density", async () => {
    const css = await readUtf8("packages/design-tokens/tokens.css")
    const rootBlock = css.match(/^:root \{([\s\S]*?)^\}/m)?.[1] ?? ""

    expect(rootBlock).toContain("--topic-row-min-height: 116px")
    expect(rootBlock).toContain("--topic-row-gap: 9px")
    expect(rootBlock).toContain("--topic-row-padding-top: 14px")
    expect(rootBlock).toContain("--topic-row-padding-bottom: 12px")
  })
})
