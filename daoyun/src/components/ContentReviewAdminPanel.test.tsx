import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { listEditReviewPage, resolveEditReview } from "../api/editReviews"
import { ContentReviewAdminPanel } from "./ContentReviewAdminPanel"
vi.mock("../api/editReviews", () => ({ listEditReviewPage: vi.fn(), resolveEditReview: vi.fn() }))
const id = "019fc800-0000-7000-8000-000000000001"
const boards = [{ id, slug: "general", name: "交流", tone: "blue" as const, capabilityKeys: ["moderation.topic"] }]
const item = { id, board_id: id, board_name: "交流", topic_id: id, post_id: id, target_type: "reply" as const, editor: { id, username: "member", display_name: "成员", avatar_url: null }, base_revision: 1, current_title: null, current_content: "公开版本", proposed_title: null, proposed_content: "待审版本", proposed_rich_content: null, proposed_excerpt: null, proposed_tags: null, status: "pending" as const, revision: 2, review_reason: null, created_at: "2026-09-22T00:00:00Z", reviewed_at: null }
beforeEach(() => {
  vi.mocked(listEditReviewPage).mockResolvedValue({ items: [item], nextCursor: null })
  vi.mocked(resolveEditReview).mockResolvedValue({ ...item, status: "approved" })
})
afterEach(() => { cleanup(); vi.resetAllMocks() })
it("lets a board moderator review edits without loading site configuration", async () => {
  const user = userEvent.setup()
  render(<ContentReviewAdminPanel boards={boards} csrfToken="csrf" />)
  expect(await screen.findByText("公开版本")).toBeInTheDocument()
  expect(screen.getByText("待审版本")).toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "通过并发布" }))
  const dialog = screen.getByRole("dialog", { name: "通过编辑" })
  await user.type(within(dialog).getByLabelText("审核说明"), "复核通过")
  await user.click(within(dialog).getByRole("button", { name: "确认通过" }))
  await waitFor(() => expect(resolveEditReview).toHaveBeenCalledWith(item, "approve", "复核通过", "csrf"))
  expect(await screen.findByText("编辑已通过并发布")).toBeInTheDocument()
})
it("filters reply edits and shows retryable errors without stale review actions", async () => {
  const user = userEvent.setup()
  render(<ContentReviewAdminPanel boards={boards} csrfToken="csrf" />)
  await screen.findByText("待审版本")
  vi.mocked(listEditReviewPage).mockRejectedValueOnce(new Error("审核队列读取失败"))
  await user.selectOptions(screen.getByLabelText("审核类型"), "reply")
  expect(await screen.findByRole("alert")).toHaveTextContent("审核队列读取失败")
  expect(screen.queryByRole("button", { name: "通过并发布" })).not.toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "重试审核列表" }))
  expect(await screen.findByText("待审版本")).toBeInTheDocument()
  expect(listEditReviewPage).toHaveBeenLastCalledWith(expect.objectContaining({ boardId: id, targetType: "reply" }))
})
it("does not fetch when no reviewable board is available", () => {
  render(<ContentReviewAdminPanel boards={[]} csrfToken="csrf" />)
  expect(screen.getByText("当前账号没有可审核的版块")).toBeInTheDocument()
  expect(listEditReviewPage).not.toHaveBeenCalled()
})

it("shows the proposed topic excerpt, tags and rich links before approving", async () => {
  vi.mocked(listEditReviewPage).mockResolvedValue({ items: [{ ...item, target_type: "topic", proposed_excerpt: "待审摘要", proposed_tags: [{ slug: "review", name: "待审标签" }], proposed_rich_content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "查阅来源", marks: [{ type: "link", attrs: { href: "https://example.com/review" } }] }] }] } }], nextCursor: null })
  render(<ContentReviewAdminPanel boards={boards} csrfToken="csrf" />)
  expect(await screen.findByText("待审摘要")).toBeInTheDocument()
  expect(screen.getByText("待审标签")).toBeInTheDocument()
  expect(screen.getByRole("link", { name: "查阅来源" })).toHaveAttribute("href", "https://example.com/review")
})
