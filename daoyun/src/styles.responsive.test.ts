import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8")
const communityStyles = readFileSync(resolve(process.cwd(), "src/styles.community.css"), "utf8")
const homeStyles = readFileSync(resolve(process.cwd(), "src/styles.home.css"), "utf8")

// 首页与版块的计算布局改由 UI V2 和 community-responsive 浏览器用例验证。
describe("public community responsive layout", () => {
  it("defines the five required responsive acceptance widths without device-bound layout values", () => {
    expect(styles).toMatch(/@media \(max-width: 380px\)/)
    expect(styles).toMatch(/@media \(max-width: 768px\)/)
    expect(styles).toMatch(/@media \(min-width: 769px\) and \(max-width: 900px\)/)
    expect(styles).toMatch(/@media \(max-width: 1060px\)/)
    expect(communityStyles).toMatch(/\.page-shell\s*\{[\s\S]*?grid-template-columns:\s*204px minmax\(0, 1fr\) 264px;/)
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
    expect(styles).toMatch(/\.mobile-compose\s*\{[\s\S]*?display:\s*none;/)
    expect(communityStyles).toMatch(
      /@media \(max-width: 768px\) \{[\s\S]*?\.feed-heading-row\s*\{[\s\S]*?min-height:\s*64px;[\s\S]*?padding:\s*13px 14px 10px;[\s\S]*?\.feed-heading-copy p,[\s\S]*?\.tag-filter,[\s\S]*?\.composer-prompt\s*\{[\s\S]*?display:\s*none;/,
    )
  })






  it("keeps a visible mobile detail return action alongside the fixed comment entry", () => {
    expect(styles).toMatch(/\.topic-mobile-comment-entry\s*\{[\s\S]*?display:\s*none;/)
    expect(styles).toMatch(
      /\.reply-list > li\[data-reply-level="1"\]\s*\{[\s\S]*?margin-left:/,
    )
    expect(styles).toMatch(
      /@media \(max-width: 768px\) \{[\s\S]*?\.topic-mobile-comment-entry\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?display:\s*flex;/,
    )
    expect(communityStyles).toMatch(
      /@media \(max-width: 768px\) \{[\s\S]*?\.topic-detail__toolbar > \.secondary-button\s*\{[\s\S]*?display:\s*inline-flex;/,
    )
    expect(communityStyles).toMatch(
      /@media \(max-width: 768px\) \{[\s\S]*?\.reply-list > li\[data-reply-level="1"\]\s*\{[\s\S]*?margin-left:\s*18px;/,
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

  it("uses a compact carded topic article with flat discussion rows", () => {
    const topicStyles = homeStyles.slice(homeStyles.indexOf("/* Topic detail: compact content page"))

    expect(topicStyles).toMatch(
      /\.app:has\(\.topic-detail\) \.topic-detail__article,\s*\.app:has\(\.topic-detail\) \.reply-section\s*\{[^}]*border:\s*1px solid var\(--border\);[^}]*border-radius:\s*8px;/,
    )
    expect(topicStyles).toMatch(/\.app:has\(\.topic-detail\) \.topic-detail__article h1\s*\{[^}]*font-size:\s*22px;/)
    expect(topicStyles).toMatch(
      /\.app:has\(\.topic-detail\) \.reply-list\s*\{[^}]*gap:\s*0;[^}]*background:\s*var\(--surface\);[^}]*padding:\s*0 18px;/,
    )
    expect(topicStyles).toMatch(
      /\.app:has\(\.topic-detail\) \.reply-list > li\s*\{[^}]*border:\s*0;[^}]*border-bottom:\s*1px solid var\(--border\);[^}]*border-radius:\s*0;/,
    )
    expect(topicStyles).toMatch(
      /\.app:has\(\.topic-detail\) \.topic-detail__toolbar > \.secondary-button\s*\{[^}]*display:\s*none;/,
    )
    expect(topicStyles).toMatch(
      /@media \(max-width:\s*768px\)\s*\{[\s\S]*?\.app:has\(\.topic-detail\) \.topic-detail__toolbar > \.secondary-button\s*\{[^}]*display:\s*inline-flex;/,
    )
  })

})
