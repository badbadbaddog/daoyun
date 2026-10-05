import { afterEach, describe, expect, it } from "vitest"
import { currentRoute, navigate, normalizeLegacyHash, subscribeHashRoute } from "./hashRouter"
const id = "019a2060-9400-7000-8000-000000000001"
const reply = "019a2060-9400-7000-8000-000000000002"
afterEach(() => window.history.replaceState(null, "", "/"))
describe("public URLs", () => {
  it.each([
    ["/t/" + id + "?reply=" + reply, { kind: "topic", topicId: id, replyId: reply }],
    ["/b/general?q=hello&sort=active", { kind: "board", slug: "general", query: "hello", sort: "active" }],
    ["/u/member", { kind: "user", username: "member" }],
  ])("reads a directly loaded URL %s", (url, expected) => {
    window.history.replaceState(null, "", url)
    expect(currentRoute()).toEqual(expected)
    expect(normalizeLegacyHash()).toBe(false)
  })
  it("converts a hash topic link and preserves the selected floor", () => {
    window.history.replaceState(null, "", "/#topic/" + id + "?reply=" + reply)
    expect(normalizeLegacyHash()).toBe(true)
    expect(window.location.pathname + window.location.search + window.location.hash).toBe("/t/" + id + "?reply=" + reply)
    expect(currentRoute()).toEqual({ kind: "topic", topicId: id, replyId: reply })
  })
  it("notifies subscribers for navigation and browser history, including private hash pages", () => {
    const received: unknown[] = []; const stop = subscribeHashRoute(route => received.push(route))
    navigate({ kind: "topic", topicId: id })
    expect(currentRoute()).toEqual({ kind: "topic", topicId: id })
    navigate({ kind: "notifications" })
    expect(window.location.pathname + window.location.hash).toBe("/#notifications")
    window.history.replaceState(null, "", "/u/member"); window.dispatchEvent(new PopStateEvent("popstate"))
    expect(received.at(-1)).toEqual({ kind: "user", username: "member" }); stop()
  })
})
