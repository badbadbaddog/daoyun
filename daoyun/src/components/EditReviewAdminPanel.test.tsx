import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { listEditReviewPolicies, listEditReviews, updateEditReviewPolicies } from "../api/editReviews"
import { EditReviewAdminPanel } from "./EditReviewAdminPanel"

vi.mock("../api/editReviews", async () => {
  const actual = await vi.importActual<typeof import("../api/editReviews")>("../api/editReviews")
  return { ...actual, listEditReviewPolicies: vi.fn(), listEditReviews: vi.fn(), updateEditReviewPolicies: vi.fn(), resolveEditReview: vi.fn() }
})

const policies = [
  { board_id: "019fc630-0000-7000-8000-000000000001", board_name: "社区广场", topic_edits_require_review: false, reply_edits_require_review: false },
  { board_id: "019fc630-0000-7000-8000-000000000002", board_name: "站务", topic_edits_require_review: false, reply_edits_require_review: false },
]

beforeEach(() => {
  vi.mocked(listEditReviewPolicies).mockResolvedValue(policies)
  vi.mocked(listEditReviews).mockResolvedValue([])
  vi.mocked(updateEditReviewPolicies).mockImplementation(async (updates) => updates)
})

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe("EditReviewAdminPanel", () => {
  it("applies topic and reply settings to multiple selected boards in one save", async () => {
    const user = userEvent.setup()
    render(<EditReviewAdminPanel csrfToken="csrf" />)

    await user.click(await screen.findByRole("checkbox", { name: "选择版块 社区广场" }))
    await user.click(screen.getByRole("checkbox", { name: "选择版块 站务" }))
    await user.click(screen.getByRole("checkbox", { name: "主题编辑需要审核" }))
    await user.click(screen.getByRole("button", { name: "应用到 2 个版块" }))

    await waitFor(() => expect(updateEditReviewPolicies).toHaveBeenCalledWith([
      { ...policies[0], topic_edits_require_review: true },
      { ...policies[1], topic_edits_require_review: true },
    ], "csrf"))
  })
})
