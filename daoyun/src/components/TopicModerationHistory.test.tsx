import userEvent from "@testing-library/user-event"
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { listTopicModerationHistory } from "../api/moderation"
import { TopicModerationHistory } from "./TopicModerationHistory"

vi.mock("../api/moderation", async () => {
  const actual = await vi.importActual<typeof import("../api/moderation")>("../api/moderation")
  return { ...actual, listTopicModerationHistory: vi.fn() }
})

const topicId = "019fc900-0000-7000-8000-000000000201"
const firstEntry = {
  id: "019fc900-0000-7000-8000-000000000401",
  source: "moderation" as const,
  action: "hidden" as const,
  actor: { id: "019fc900-0000-7000-8000-000000000301", username: "owner", displayName: "站长", avatarUrl: null },
  reason: "内容待复核",
  createdAt: "2026-08-25T08:00:00Z",
}

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe("TopicModerationHistory", () => {
  it("announces the initial history loading state", () => {
    vi.mocked(listTopicModerationHistory).mockImplementation(() => new Promise(() => undefined))

    render(<TopicModerationHistory topicId={topicId} />)

    expect(screen.getByRole("status")).toHaveTextContent("正在读取处理记录")
  })

  it("renders processing records as a compact audit table", async () => {
    vi.mocked(listTopicModerationHistory).mockResolvedValue({ entries: [firstEntry], nextCursor: null })

    render(<TopicModerationHistory topicId={topicId} />)

    const headers = await screen.findByRole("row", { name: "处理记录字段" })
    expect(headers).toHaveTextContent("操作类型")
    expect(headers).toHaveTextContent("来源")
    expect(headers).toHaveTextContent("处理时间")
    expect(headers).toHaveTextContent("处理备注")
    expect(headers).toHaveTextContent("管理员")
    expect(headers).toHaveTextContent("记录编号")
    const table = screen.getByRole("table", { name: "处理记录" })
    const record = within(table).getAllByRole("row")[1]
    expect(within(record).getAllByRole("cell")).toHaveLength(6)
    expect(within(record).getByText("隐藏")).toHaveAttribute("data-action", "hidden")
  })

  it("renders the empty state", async () => {
    vi.mocked(listTopicModerationHistory).mockResolvedValue({ entries: [], nextCursor: null })
    render(<TopicModerationHistory topicId={topicId} />)
    expect(await screen.findByText("暂无处理记录")).toBeInTheDocument()
  })

  it("appends the next page", async () => {
    const user = userEvent.setup()
    vi.mocked(listTopicModerationHistory)
      .mockResolvedValueOnce({ entries: [firstEntry], nextCursor: firstEntry.id })
      .mockResolvedValueOnce({ entries: [{ ...firstEntry, id: "019fc900-0000-7000-8000-000000000402", action: "pin", reason: "重要公告" }], nextCursor: null })
    render(<TopicModerationHistory topicId={topicId} />)

    await user.click(await screen.findByRole("button", { name: "加载更多记录" }))

    expect(await screen.findByText("重要公告")).toBeInTheDocument()
    expect(listTopicModerationHistory).toHaveBeenLastCalledWith(expect.objectContaining({ topicId, cursor: firstEntry.id, limit: 20 }))
  })

  it("keeps existing records and allows retry after a next-page failure", async () => {
    const user = userEvent.setup()
    const nextEntry = { ...firstEntry, id: "019fc900-0000-7000-8000-000000000402", action: "pin" as const, reason: null }
    vi.mocked(listTopicModerationHistory)
      .mockResolvedValueOnce({ entries: [firstEntry], nextCursor: firstEntry.id })
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ entries: [nextEntry], nextCursor: null })

    render(<TopicModerationHistory topicId={topicId} />)
    const loadMore = await screen.findByRole("button", { name: "加载更多记录" })
    await user.click(loadMore)

    expect(await screen.findByRole("alert")).toHaveTextContent("处理记录暂时无法加载")
    expect(screen.getByText(firstEntry.reason)).toBeInTheDocument()
    expect(loadMore).toBeEnabled()
    await user.click(loadMore)

    expect(await screen.findByText("未填写处理备注")).toBeInTheDocument()
    expect(listTopicModerationHistory).toHaveBeenCalledTimes(3)
  })

  it("renders processing records newest first", async () => {
    vi.mocked(listTopicModerationHistory).mockResolvedValue({
      entries: [
        { ...firstEntry, id: "019fc900-0000-7000-8000-000000000402", reason: "较早记录", createdAt: "2026-08-24T08:00:00Z" },
        { ...firstEntry, id: "019fc900-0000-7000-8000-000000000403", action: "pin", reason: "最新记录", createdAt: "2026-08-25T09:00:00Z" },
      ],
      nextCursor: null,
    })

    render(<TopicModerationHistory topicId={topicId} />)

    const records = within(await screen.findByRole("rowgroup")).getAllByRole("row")
    expect(records[0]).toHaveTextContent("最新记录")
    expect(records[1]).toHaveTextContent("较早记录")
  })

  it("retries after an initial failure", async () => {
    const user = userEvent.setup()
    vi.mocked(listTopicModerationHistory)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ entries: [firstEntry], nextCursor: null })
    render(<TopicModerationHistory topicId={topicId} />)

    expect(await screen.findByRole("alert")).toHaveTextContent("处理记录暂时无法加载")
    await user.click(screen.getByRole("button", { name: "重试" }))

    expect(await screen.findByText("内容待复核")).toBeInTheDocument()
    expect(listTopicModerationHistory).toHaveBeenCalledTimes(2)
  })
})
