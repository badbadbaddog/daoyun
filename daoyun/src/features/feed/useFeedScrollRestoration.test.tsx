import { renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { CommunityRoute } from "../../router/communityRoute"
import { useFeedScrollRestoration } from "./useFeedScrollRestoration"

describe("useFeedScrollRestoration", () => {
  beforeEach(() => {
    sessionStorage.clear()
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

    Object.defineProperty(window, "scrollY", { configurable: true, value: 640 })
    rerender({ route: topic, ready: false })
    rerender({ route: latest, ready: false })

    expect(window.scrollTo).not.toHaveBeenCalled()
    rerender({ route: latest, ready: true })

    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 640, behavior: "auto" })
  })
})
