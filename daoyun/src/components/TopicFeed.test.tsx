import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { TopicFeed } from "./TopicFeed"

afterEach(cleanup)

describe("TopicFeed", () => {
  it("opens the same composer from text, image, and link affordances", async () => {
    const user = userEvent.setup()
    const onCompose = vi.fn()

    render(
      <TopicFeed
        topics={[]}
        activeFeed="latest"
        tags={[]}
        selectedTag=""
        onTagChange={vi.fn()}
        loadStatus="ready"
        onRetry={vi.fn()}
        onCompose={onCompose}
        onOpenTopic={vi.fn()}
        authenticated
        onLogin={vi.fn()}
        onToggleBookmark={vi.fn()}
        bookmarkPendingId={null}
        onToggleLike={vi.fn()}
        likePendingId={null}
        interactionError=""
      />,
    )

    await user.click(screen.getByRole("button", { name: "分享此刻的想法" }))
    await user.click(screen.getByRole("button", { name: "添加图片" }))
    await user.click(screen.getByRole("button", { name: "添加链接" }))

    expect(onCompose).toHaveBeenCalledTimes(3)
  })
})
