import { describe, expect, it } from "vitest"

import { formatRoute, parseHash } from "./communityRoute"

const topicId = "019fc800-0000-7000-8000-000000000101"
const replyId = "019fc800-0000-7000-8000-000000000201"
const conversationId = "019fc900-0000-7000-8000-000000000101"

describe("communityRoute", () => {
  it.each([
    ["#feed", { kind: "feed", feed: "latest" }],
    ["#active", { kind: "feed", feed: "active" }],
    ["#hot", { kind: "feed", feed: "hot" }],
    ["#featured", { kind: "feed", feed: "featured" }],
    ["#following", { kind: "feed", feed: "following" }],
    ["#boards", { kind: "boardIndex" }],
    ["#board/engineering", { kind: "board", slug: "engineering" }],
    [`#topic/${topicId}`, { kind: "topic", topicId }],
    ["#user/member_01", { kind: "user", username: "member_01" }],
    ["#bookmarks", { kind: "bookmarks" }],
    ["#messages", { kind: "messages", conversationId: null }],
    [`#messages/${conversationId}`, { kind: "messages", conversationId }],
    ["#notifications", { kind: "notifications" }],
    ["#member", { kind: "member", tab: "overview" }],
    ["#member/growth", { kind: "member", tab: "growth" }],
    ["#member/points", { kind: "member", tab: "points" }],
    ["#member/benefits", { kind: "member", tab: "benefits" }],
    ["#member/medals", { kind: "member", tab: "medals" }],
    ["#admin/reports?status=open", { kind: "admin", tab: "reports", query: "status=open" }],
    ["#oidc-claim", { kind: "oidcClaim" }],
  ] as const)("parses %s", (hash, route) => {
    expect(parseHash(hash)).toEqual(route)
  })

  it("keeps a reply deep link inside its topic route", () => {
    const route = parseHash(`#topic/${topicId}?reply=${replyId}`)
    expect(route).toEqual({ kind: "topic", topicId, replyId })
    expect(formatRoute(route)).toBe(`#topic/${topicId}?reply=${replyId}`)
  })

  it("ignores an invalid reply anchor without losing the topic route", () => {
    expect(parseHash(`#topic/${topicId}?reply=not-a-uuid`)).toEqual({ kind: "topic", topicId })
  })

  it("parses and formats search parameters", () => {
    const route = parseHash("#search?q=rust%20wasm&type=topics")
    expect(route).toEqual({ kind: "search", query: "rust wasm", scope: "topics" })
    expect(formatRoute(route)).toBe("#search?q=rust+wasm&type=topics")
  })

  it("supports a shareable tag-result scope", () => {
    const route = parseHash("#search?q=rust&type=tags")
    expect(route).toEqual({ kind: "search", query: "rust", scope: "tags" })
    expect(formatRoute(route)).toBe("#search?q=rust&type=tags")
  })

  it.each([
    ["#top", { kind: "feed", feed: "hot" }, "#hot"],
    ["#discover", { kind: "search", query: "", scope: "all" }, "#search"],
    ["#board-engineering", { kind: "board", slug: "engineering" }, "#board/engineering"],
  ] as const)("keeps legacy %s compatible and formats canonically", (hash, route, canonical) => {
    const parsed = parseHash(hash)
    expect(parsed).toEqual(route)
    expect(formatRoute(parsed)).toBe(canonical)
  })

  it.each([
    "#topic/not-a-uuid",
    "#topic/019fc800-0000-0000-8000-000000000101",
    "#messages/not-a-uuid",
    "#user/Admin",
    "#user/a",
    "#board/-engineering",
    "#board/engineering-",
    "#board/Engineering",
    "#board-../admin",
  ])("rejects invalid route input: %s", (hash) => {
    expect(parseHash(hash)).toEqual({ kind: "feed", feed: "hot" })
  })

  it("formats invalid internal destinations back to the recommended home", () => {
    expect(formatRoute({ kind: "board", slug: "Invalid" })).toBe("#hot")
    expect(formatRoute({ kind: "topic", topicId: "not-a-uuid" })).toBe("#hot")
    expect(formatRoute({ kind: "user", username: "Admin" })).toBe("#hot")
  })

  it("falls back to all for an unsupported search scope", () => {
    expect(parseHash("#search?q=rust&type=everything")).toEqual({
      kind: "search",
      query: "rust",
      scope: "all",
    })
  })

  it("round-trips every route kind", () => {
    const routes = [
      { kind: "feed", feed: "latest" },
      { kind: "feed", feed: "active" },
      { kind: "boardIndex" },
      { kind: "board", slug: "engineering" },
      { kind: "search", query: "rust", scope: "users" },
      { kind: "topic", topicId },
      { kind: "topic", topicId, replyId },
      { kind: "user", username: "member" },
      { kind: "bookmarks" },
      { kind: "messages", conversationId: null },
      { kind: "messages", conversationId },
      { kind: "notifications" },
      { kind: "member", tab: "benefits" },
      { kind: "admin", tab: null, query: "" },
      { kind: "admin", tab: "reports", query: "status=open" },
      { kind: "oidcClaim" },
    ] as const

    for (const route of routes) {
      expect(parseHash(formatRoute(route))).toEqual(route)
    }
  })
})
