import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8")

describe("public community responsive layout", () => {
  it("defines the five required responsive acceptance widths without device-bound layout values", () => {
    expect(styles).toMatch(/@media \(max-width: 380px\)/)
    expect(styles).toMatch(/@media \(max-width: 768px\)/)
    expect(styles).toMatch(/@media \(min-width: 769px\) and \(max-width: 900px\)/)
    expect(styles).toMatch(/@media \(max-width: 1060px\)/)
    expect(styles).toMatch(/\.page-shell\s*\{[\s\S]*?grid-template-columns:\s*220px minmax\(0, 1fr\) 280px;/)
  })

  it("keeps the community navigation and mixed feed dense on tablet widths", () => {
    expect(styles).toMatch(
      /@media \(min-width: 769px\) and \(max-width: 900px\) \{[\s\S]*?\.page-shell\s*\{[\s\S]*?display:\s*grid;[\s\S]*?\.left-sidebar\s*\{[\s\S]*?display:\s*block;[\s\S]*?\.topic-row--discussion\s*\{[\s\S]*?grid-column:\s*auto;/,
    )
  })

  it("keeps discussion posts full-width throughout the mobile navigation range", () => {
    expect(styles).toMatch(
      /@media \(min-width: 481px\) and \(max-width: 768px\) \{[\s\S]*?\.topic-row--discussion\s*\{[\s\S]*?grid-column:\s*1 \/ -1;/,
    )
  })

  it("uses compact underlined feed tabs instead of filled pills", () => {
    expect(styles).toMatch(/\.feed-tab\s*\{[\s\S]*?border-radius:\s*0;/)
    expect(styles).toMatch(/\.feed-tab--active\s*\{[\s\S]*?background:\s*transparent;/)
    expect(styles).toMatch(/\.feed-tab--active::after\s*\{[\s\S]*?height:\s*2px;/)
  })

  it("moves mobile feed content directly below its tabs", () => {
    expect(styles).toMatch(
      /@media \(max-width: 768px\) \{[\s\S]*?\.feed-heading-row\s*\{[\s\S]*?padding:\s*0;[\s\S]*?\.tag-filter,[\s\S]*?\.mobile-compose,[\s\S]*?\.composer-prompt\s*\{[\s\S]*?display:\s*none;/,
    )
  })

  it("keeps community detail topics in one compact list column", () => {
    expect(styles).toMatch(
      /\.board-topic-list\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);[\s\S]*?gap:\s*0;/,
    )
    expect(styles).toMatch(
      /\.board-topic-list \.topic-row--media\s*\{[\s\S]*?grid-template-areas:\s*"avatar content cover bookmark";/,
    )
  })

  it("removes stacked panel chrome from community pages on mobile", () => {
    expect(styles).toMatch(
      /@media \(max-width: 768px\) \{[\s\S]*?\.board-directory-page,[\s\S]*?\.board-page\s*\{[\s\S]*?border-right:\s*0;[\s\S]*?border-left:\s*0;[\s\S]*?\.board-page-title,[\s\S]*?\.board-header,[\s\S]*?\.board-children,[\s\S]*?\.board-topic-feed\s*\{[\s\S]*?border-radius:\s*0;/,
    )
    expect(styles).toMatch(
      /@media \(max-width: 768px\) \{[\s\S]*?\.board-breadcrumb\s*\{[\s\S]*?display:\s*flex;[\s\S]*?overflow-x:\s*auto;/,
    )
    expect(styles).not.toMatch(/\.board-breadcrumb\s*\{\s*display:\s*none;/)
  })

  it("provides a fixed mobile comment entry and a one-level reply hierarchy", () => {
    expect(styles).toMatch(/\.topic-mobile-comment-entry\s*\{[\s\S]*?display:\s*none;/)
    expect(styles).toMatch(
      /\.reply-list > li\[data-reply-level="1"\]\s*\{[\s\S]*?margin-left:/,
    )
    expect(styles).toMatch(
      /@media \(max-width: 768px\) \{[\s\S]*?\.topic-mobile-comment-entry\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?display:\s*flex;/,
    )
  })

  it("keeps topic details wide on compact desktop layouts", () => {
    expect(styles).toMatch(
      /@media \(min-width: 901px\) and \(max-width: 1060px\) \{[\s\S]*?\.app:has\(\.topic-detail\) \.page-shell\s*\{[\s\S]*?width:\s*calc\(100% - 24px\);/,
    )
  })

  it("lets short topic bodies size to their content", () => {
    const topicDetailStyles = styles.slice(styles.indexOf("/* Topic detail: content-first reading and discussion layout */"))

    expect(topicDetailStyles).toMatch(/\.topic-detail__article\s*\{\s*min-height:\s*0;/)
    expect(topicDetailStyles).toMatch(/\.topic-detail__content\s*\{\s*min-height:\s*0;/)
    expect(topicDetailStyles).not.toMatch(/\.topic-detail__content\s*\{[\s\S]*?min-height:\s*(?:150|210)px;/)
  })
})
