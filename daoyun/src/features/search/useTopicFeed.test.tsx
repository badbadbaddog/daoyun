import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { listFeed } from "../../api/feed"
import { listTopics } from "../../api/topics"
import type { Topic } from "../../types/community"
import { useTopicFeed } from "./useTopicFeed"

vi.mock("../../api/feed", () => ({ listFeed: vi.fn() }))
vi.mock("../../api/topics", () => ({ listTopics: vi.fn() }))

const topic = (id: string, title: string): Topic => ({
  id,
  title,
  excerpt: title,
  board: "工程实践",
  boardTone: "green",
  authorId: "019fc630-0000-7000-8000-000000000199",
  authorUsername: "author",
  author: "作者",
  avatarUrl: null,
  publishedAt: "2026-08-27T10:00:00Z",
  replies: 0,
  likes: 0,
  bookmarked: false,
  liked: false,
  views: 0,
  tags: [],
})

afterEach(() => vi.clearAllMocks())

describe("useTopicFeed", () => {
  it("uses the dedicated feed endpoint when a product feed mode is supplied", async () => {
    vi.mocked(listFeed).mockResolvedValue({ topics: [topic("feed", "Feed")], nextCursor: null })

    const { result } = renderHook(() => useTopicFeed({ mode: "recommended", limit: 12 }))
    await waitFor(() => expect(result.current.loadingInitial).toBe(false))

    expect(listFeed).toHaveBeenCalledWith("recommended", expect.objectContaining({
      limit: 12,
      signal: expect.any(AbortSignal),
    }))
    expect(listTopics).not.toHaveBeenCalled()
    expect(result.current.topics.map((item) => item.id)).toEqual(["feed"])
  })

  it("appends cursor pages, deduplicates IDs and keeps content after a load-more failure", async () => {
    vi.mocked(listTopics)
      .mockResolvedValueOnce({ topics: [topic("a", "A"), topic("b", "B")], nextCursor: "cursor-1" })
      .mockResolvedValueOnce({ topics: [topic("b", "B2"), topic("c", "C")], nextCursor: "cursor-2" })
      .mockRejectedValueOnce(new Error("offline"))

    const { result } = renderHook(() => useTopicFeed({ query: "Rust" }))
    await waitFor(() => expect(result.current.loadingInitial).toBe(false))
    expect(result.current.topics.map((item) => item.id)).toEqual(["a", "b"])

    await act(() => result.current.loadMore())
    expect(result.current.topics.map((item) => `${item.id}:${item.title}`)).toEqual(["a:A", "b:B2", "c:C"])

    await act(() => result.current.loadMore())
    expect(result.current.topics).toHaveLength(3)
    expect(result.current.errorMore).toBeTruthy()
  })

  it("stages newly discovered topics on refresh until the reader chooses to reveal them", async () => {
    vi.mocked(listFeed)
      .mockResolvedValueOnce({ topics: [topic("a", "A")], nextCursor: null })
      .mockResolvedValueOnce({ topics: [topic("new", "New"), topic("a", "A")], nextCursor: null })

    const { result, rerender } = renderHook(
      ({ requestVersion }) => useTopicFeed({ mode: "latest", requestVersion }),
      { initialProps: { requestVersion: 0 } },
    )
    await waitFor(() => expect(result.current.loadingInitial).toBe(false))

    rerender({ requestVersion: 1 })
    expect(result.current.loadingInitial).toBe(false)
    await waitFor(() => expect(result.current.newTopicCount).toBe(1))
    expect(result.current.topics.map((item) => item.id)).toEqual(["a"])

    act(() => result.current.revealNewTopics())
    expect(result.current.topics.map((item) => item.id)).toEqual(["new", "a"])
    expect(result.current.newTopicCount).toBe(0)
  })

  it("keeps the current page visible when a background refresh fails", async () => {
    vi.mocked(listFeed)
      .mockResolvedValueOnce({ topics: [topic("a", "A")], nextCursor: null })
      .mockRejectedValueOnce(new Error("offline"))

    const { result, rerender } = renderHook(
      ({ requestVersion }) => useTopicFeed({ mode: "latest", requestVersion }),
      { initialProps: { requestVersion: 0 } },
    )
    await waitFor(() => expect(result.current.loadingInitial).toBe(false))

    rerender({ requestVersion: 1 })
    await waitFor(() => expect(result.current.errorMore).toBe("刷新失败，已保留当前内容。"))
    expect(result.current.topics.map((item) => item.id)).toEqual(["a"])
    expect(result.current.errorInitial).toBeNull()
  })
})
