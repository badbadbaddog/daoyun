import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import { HomeProfilePanel } from "./HomeProfilePanel"
import { usePublicMembershipSummary } from "../features/membership/usePublicMembershipSummary"
vi.mock("../features/membership/usePublicMembershipSummary", () => ({ usePublicMembershipSummary: vi.fn() }))
afterEach(() => { cleanup(); vi.resetAllMocks() })
const session = { user: { id: "member", username: "member", displayName: "北岛", email: "member@example.com" }, csrfToken: "a" }

it("shows own authoritative totals and only explicitly public groups", () => {
  vi.mocked(usePublicMembershipSummary).mockReturnValue({ summary: { currentLevel: { id: "lv", internalKey: "lv1", levelOrder: 1, displayName: "新手", requiredExperience: 0, iconAssetUrl: null, color: null, description: "" }, medals: [], publicGroups: [] }, status: "ready", retry: vi.fn() })
  render(<HomeProfilePanel session={session} profile={{ pointsBalance: 1280, topicCount: 12, avatarUrl: "/avatar.png", experience: null }} onCompose={vi.fn()} />)
  expect(screen.getByRole("link", { name: "1,280 积分" })).toHaveAttribute("href", "#member/points")
  expect(screen.getByRole("link", { name: "0 勋章" })).toHaveAttribute("href", "#member/medals")
  expect(screen.getByRole("link", { name: "12 我的帖子" })).toHaveAttribute("href", "#user/member")
  expect(screen.getByRole("img", { name: "北岛的头像" })).toHaveAttribute("src", "/avatar.png")
  expect(screen.queryByText("正式会员")).not.toBeInTheDocument()
})

it("keeps unavailable totals unknown and retries both personal and public reads", async () => {
  const retry = vi.fn(), retryPublic = vi.fn()
  vi.mocked(usePublicMembershipSummary).mockReturnValue({ summary: null, status: "error", retry: retryPublic })
  render(<HomeProfilePanel session={session} profile={{ pointsBalance: null, topicCount: 12, avatarUrl: null, experience: null }} errors={["积分暂时不可用"]} onRetry={retry} onCompose={vi.fn()} />)
  expect(screen.getByRole("link", { name: "— 积分" })).toBeInTheDocument()
  expect(screen.getByRole("link", { name: "— 勋章" })).toBeInTheDocument()
  expect(screen.queryByText("0")).not.toBeInTheDocument()
  await userEvent.setup().click(screen.getByRole("button", { name: "重试个人统计" }))
  expect(retry).toHaveBeenCalledOnce()
  expect(retryPublic).toHaveBeenCalledOnce()
})
