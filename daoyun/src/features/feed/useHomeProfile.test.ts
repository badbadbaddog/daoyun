import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { cleanup } from "@testing-library/react"
import { getMembershipExperience } from "../../api/membership"
import { getCurrentMembership, getUserProfile } from "../../api/users"
import { useHomeProfile } from "./useHomeProfile"

vi.mock("../../api/membership", () => ({ getMembershipExperience: vi.fn() }))
vi.mock("../../api/users", () => ({ getCurrentMembership: vi.fn(), getUserProfile: vi.fn() }))
afterEach(() => { cleanup(); vi.resetAllMocks() })

function successfulReads(points = 1280) {
  vi.mocked(getMembershipExperience).mockResolvedValue({ experience: 4880, level: { id: "level", internalKey: "member", levelOrder: 5, displayName: "达人", requiredExperience: 3000, iconAssetUrl: null, color: null, description: "" }, nextLevel: null })
  vi.mocked(getCurrentMembership).mockResolvedValue({ userId: "member", pointsBalance: points, lifetimePoints: points, levelKey: "member", levelNumber: 5, levelDisplayName: "达人", revision: 1, updatedAt: "2026-10-11" })
  vi.mocked(getUserProfile).mockResolvedValue({ id: "member", username: "member", displayName: "成员", avatarUrl: "/avatar.png", bio: "", location: null, websiteUrl: null, profileRevision: 1, createdAt: "2026-10-11", topicCount: 12, followerCount: 0, followingCount: 0, viewer: null })
}

it("loads authoritative own totals and profile avatar", async () => {
  successfulReads()
  const { result } = renderHook(() => useHomeProfile("member", "session-a", true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.data).toMatchObject({ pointsBalance: 1280, topicCount: 12, avatarUrl: "/avatar.png", experience: { experience: 4880 } })
  expect(getUserProfile).toHaveBeenCalledWith("member", expect.any(AbortSignal))
})

it("keeps partial results, treats failed totals as unknown and supports retry", async () => {
  successfulReads()
  vi.mocked(getCurrentMembership).mockRejectedValueOnce(new Error("offline"))
  const { result } = renderHook(() => useHomeProfile("member", "session-a", true))
  await waitFor(() => expect(result.current.errors).toEqual(["积分暂时不可用"]))
  expect(result.current.data?.pointsBalance).toBeNull()
  expect(result.current.data?.topicCount).toBe(12)
  act(() => result.current.retry())
  await waitFor(() => expect(result.current.data?.pointsBalance).toBe(1280))
  expect(result.current.errors).toEqual([])
})

it("hides old account totals immediately on session change and ignores late responses", async () => {
  successfulReads(77)
  const { result, rerender } = renderHook(({ username, key }) => useHomeProfile(username, key, true), { initialProps: { username: "member", key: "a" } })
  await waitFor(() => expect(result.current.data?.pointsBalance).toBe(77))
  let finish!: (value: Awaited<ReturnType<typeof getCurrentMembership>>) => void
  vi.mocked(getCurrentMembership).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  rerender({ username: "other", key: "b" })
  expect(result.current.data).toBeNull()
  rerender({ username: "third", key: "c" })
  await waitFor(() => expect(result.current.data?.pointsBalance).toBe(77))
  await act(async () => finish({ userId: "other", pointsBalance: 999, lifetimePoints: 999, levelKey: "member", levelNumber: 1, levelDisplayName: "成员", revision: 1, updatedAt: "2026-10-11" }))
  expect(result.current.data?.pointsBalance).toBe(77)
})

it("does not request private data for guests or non-home routes", () => {
  renderHook(() => useHomeProfile(null, "guest", true))
  renderHook(() => useHomeProfile("member", "a", false))
  expect(getCurrentMembership).not.toHaveBeenCalled()
  expect(getUserProfile).not.toHaveBeenCalled()
})
