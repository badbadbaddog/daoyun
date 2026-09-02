import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

const styles = readFileSync(resolve(process.cwd(), "src/styles.admin.css"), "utf8")
const legacyStyles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8")

describe("site administration visual system", () => {
  it("gives task panels one shared heading and status badge rhythm", () => {
    expect(styles).toMatch(/\.admin-view--system \.admin-panel__heading\s*\{[\s\S]*?min-height:\s*48px;[\s\S]*?border-bottom:\s*1px solid var\(--border\);/)
    expect(styles).toMatch(/\.admin-view--system \.admin-badge\s*\{[\s\S]*?min-height:\s*26px;/)
  })

  it("normalizes search and filter controls across administration workspaces", () => {
    expect(styles).toMatch(/\.admin-view--system :is\(\.user-admin-filters, \.admin-report-filters\)[\s\S]*?min-height:\s*38px;/)
  })

  it("gives nested forms one shared section-heading boundary", () => {
    expect(styles).toMatch(/\.admin-view--system \.admin-form__heading\s*\{[\s\S]*?min-height:\s*36px;[\s\S]*?border-bottom:\s*1px solid var\(--border\);/)
  })

  it("uses one restrained surface treatment for authorization, operations, and plugins", () => {
    expect(styles).toMatch(/\.admin-view--system :is\(\.authorization-section, \.operations-section, \.plugin-row\)\s*\{[\s\S]*?border-radius:\s*6px;[\s\S]*?background:\s*var\(--surface\);/)
  })

  it("keeps shared admin surface ownership out of the legacy stylesheet", () => {
    for (const selector of ["authorization-section", "operations-section", "plugin-row"]) {
      const rule = legacyStyles.match(new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`))?.[1]
      expect(rule, `${selector} should remain a structural legacy rule`).toBeDefined()
      expect(rule).not.toMatch(/(?:^|;)\s*(?:border|border-radius|background)\s*:/)
    }
  })

  it("stacks task headings and user filters on narrow screens", () => {
    expect(styles).toMatch(/@media \(max-width: 560px\)[\s\S]*?\.admin-view--system \.admin-panel__heading\s*\{[\s\S]*?flex-direction:\s*column;/)
    expect(styles).toMatch(/@media \(max-width: 560px\)[\s\S]*?\.admin-view--system \.user-admin-filters\s*\{[\s\S]*?grid-template-columns:\s*1fr;/)
  })
})
