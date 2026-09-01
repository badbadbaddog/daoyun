import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { FeedTabs } from "./FeedTabs"

afterEach(cleanup)

describe("FeedTabs", () => {
  it("keeps the home feed focused on recommendation, following, and latest", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<FeedTabs active="latest" onChange={onChange} />)

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "推荐",
      "关注",
      "最新",
    ])
    expect(screen.getByRole("tab", { name: "最新" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("tab", { name: "最新" })).toHaveAttribute("aria-controls", "feed-panel")

    await user.click(screen.getByRole("tab", { name: "推荐" }))
    expect(onChange).toHaveBeenCalledWith("hot")
  })

  it("supports arrow-key navigation between feeds", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<FeedTabs active="hot" onChange={onChange} />)

    screen.getByRole("tab", { name: "推荐" }).focus()
    await user.keyboard("{ArrowRight}")
    expect(onChange).toHaveBeenCalledWith("following")
    expect(screen.getByRole("tab", { name: "关注" })).toHaveFocus()
  })
})
