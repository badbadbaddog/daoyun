import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { Topic } from "../types/community"
import { HomeShowcase } from "./HomeShowcase"

const topic: Topic = {
  id: "019fc800-0000-7000-8000-000000000101",
  title: "周末山野露营记录",
  excerpt: "把湖边的日落分享给同好。",
  board: "生活日常",
  boardSlug: "life",
  boardTone: "green",
  authorId: "019fc700-0000-7000-8000-000000000004",
  authorUsername: "member",
  author: "社区成员",
  avatarUrl: null,
  publishedAt: "刚刚",
  replies: 8,
  likes: 16,
  bookmarked: false,
  liked: false,
  views: 128,
  tags: [],
  imageUrl: "/camp.webp",
}

afterEach(cleanup)

describe("HomeShowcase", () => {
  it("uses public topic media for discovery cards and keeps compose prominent", async () => {
    const user = userEvent.setup()
    const onCompose = vi.fn()
    const onOpenTopic = vi.fn()

    render(
      <HomeShowcase
        topics={[topic, { ...topic, id: "topic-2", title: "桌面搭建分享", imageUrl: "/desk.webp" }]}
        onCompose={onCompose}
        onOpenTopic={onOpenTopic}
      />,
    )

    expect(screen.getByRole("heading", { name: "记录每一种热爱" })).toBeInTheDocument()
    expect(screen.getByRole("img", { name: "周末山野露营记录 配图" })).toHaveAttribute("src", "/camp.webp")
    await user.click(screen.getByRole("button", { name: "立即发布" }))
    expect(onCompose).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole("link", { name: /桌面搭建分享/ }))
    expect(onOpenTopic).toHaveBeenCalledWith("topic-2")
  })
})
