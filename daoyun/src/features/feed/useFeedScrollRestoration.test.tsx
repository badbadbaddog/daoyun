import { renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { CommunityRoute } from "../../router/communityRoute"
import { useFeedScrollRestoration } from "./useFeedScrollRestoration"

describe("useFeedScrollRestoration", () => {
  beforeEach(() => {
    sessionStorage.clear()
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 })
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("restores the previous position when returning to the same feed", () => {
    const latest: CommunityRoute = { kind: "feed", feed: "latest" }
    const topic: CommunityRoute = { kind: "topic", topicId: "019fc700-0000-7000-8000-000000000003" }
    const { rerender } = renderHook(
      ({ route, ready }: { route: CommunityRoute; ready: boolean }) => useFeedScrollRestoration(route, ready),
      { initialProps: { route: latest as CommunityRoute, ready: true } },
    )
    vi.mocked(window.scrollTo).mockClear()

    Object.defineProperty(window, "scrollY", { configurable: true, value: 640 })
    rerender({ route: topic, ready: false })

    expect(sessionStorage.getItem("daoyun:feed-scroll:latest")).toBe("640")
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: "auto" })

    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 })
    vi.mocked(window.scrollTo).mockClear()
    rerender({ route: latest, ready: false })
    expect(window.scrollTo).not.toHaveBeenCalled()

    rerender({ route: latest, ready: true })
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 640, behavior: "auto" })
  })

  it("resets an unseen feed to the top instead of inheriting another feed's scroll", () => {
    const hot: CommunityRoute = { kind: "feed", feed: "hot" }
    const following: CommunityRoute = { kind: "feed", feed: "following" }
    const { rerender } = renderHook(
      ({ route }: { route: CommunityRoute }) => useFeedScrollRestoration(route, true),
      { initialProps: { route: hot } },
    )
    vi.mocked(window.scrollTo).mockClear()

    Object.defineProperty(window, "scrollY", { configurable: true, value: 920 })
    rerender({ route: following })

    expect(sessionStorage.getItem("daoyun:feed-scroll:hot")).toBe("920")
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: "auto" })
  })
})
