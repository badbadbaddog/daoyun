import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { useHashRoute } from "./useHashRoute"

function RouteProbe() {
  const { route, navigate } = useHashRoute()
  return (
    <div>
      <output data-testid="route">{JSON.stringify(route)}</output>
      <button type="button" onClick={() => navigate({ kind: "user", username: "member" })}>用户</button>
    </div>
  )
}

afterEach(() => {
  cleanup()
  window.location.hash = ""
})

describe("useHashRoute", () => {
  it("uses hashchange as the single page-state source", () => {
    window.location.hash = "#feed"
    render(<RouteProbe />)

    expect(screen.getByTestId("route")).toHaveTextContent('"kind":"feed"')

    act(() => {
      window.location.hash = "#bookmarks"
      window.dispatchEvent(new HashChangeEvent("hashchange"))
    })

    expect(screen.getByTestId("route")).toHaveTextContent('"kind":"bookmarks"')
  })

  it("navigates with a formatted hash", () => {
    window.location.hash = "#feed"
    render(<RouteProbe />)

    screen.getByRole("button", { name: "用户" }).click()

    expect(window.location.hash).toBe("#user/member")
  })

  it.each([
    ["#top", "#hot"],
    ["#discover", "#search"],
    ["#board-engineering", "#board/engineering"],
  ])("normalizes the legacy route %s without a second page-state model", (legacy, canonical) => {
    window.location.hash = legacy
    render(<RouteProbe />)

    expect(window.location.hash).toBe(canonical)
  })
})
