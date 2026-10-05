import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { listUserMembershipSummary, type PublicMembershipSummary } from "../../api/membership"
import { usePublicMembershipSummary } from "./usePublicMembershipSummary"

vi.mock("../../api/membership", () => ({ listUserMembershipSummary: vi.fn() }))
const summary: PublicMembershipSummary = {
  currentLevel: { id: "level", internalKey: "beginner", levelOrder: 1, displayName: "新成员", requiredExperience: 0, iconAssetUrl: null, color: null, description: "" },
  publicGroups: [], medals: [],
}
beforeEach(() => { vi.mocked(listUserMembershipSummary).mockReset() })
afterEach(cleanup)

describe("public membership summary recovery", () => {
  it("retries a failed identity request and reuses the recovered public summary", async () => {
    vi.mocked(listUserMembershipSummary).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(summary)
    const first = renderHook(() => usePublicMembershipSummary("retry_identity_018"))
    await waitFor(() => expect(first.result.current.status).toBe("error"))
    expect(first.result.current.summary).toBeNull()
    act(() => first.result.current.retry())
    await waitFor(() => expect(first.result.current.summary).toEqual(summary))
    expect(first.result.current.status).toBe("ready")
    const second = renderHook(() => usePublicMembershipSummary("retry_identity_018"))
    expect(second.result.current.summary).toEqual(summary)
    expect(listUserMembershipSummary).toHaveBeenCalledTimes(2)
  })

  it("coalesces requests when an author appears in both a card and a profile", async () => {
    let finish!: (value: PublicMembershipSummary) => void
    vi.mocked(listUserMembershipSummary).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const first = renderHook(() => usePublicMembershipSummary("shared_identity_018"))
    const second = renderHook(() => usePublicMembershipSummary("shared_identity_018"))
    expect(listUserMembershipSummary).toHaveBeenCalledTimes(1)
    await act(async () => finish(summary))
    expect(first.result.current.summary).toEqual(summary)
    expect(second.result.current.summary).toEqual(summary)
  })

  it("does not attribute a late identity response to another username", async () => {
    let finishOld!: (value: PublicMembershipSummary) => void
    vi.mocked(listUserMembershipSummary).mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve })).mockResolvedValueOnce(summary)
    const view = renderHook(({ username }) => usePublicMembershipSummary(username), { initialProps: { username: "old_identity_018" } })
    view.rerender({ username: "new_identity_018" })
    await waitFor(() => expect(view.result.current.summary).toEqual(summary))
    await act(async () => finishOld({ ...summary, currentLevel: { ...summary.currentLevel, displayName: "旧用户身份" } }))
    expect(view.result.current.summary?.currentLevel.displayName).toBe("新成员")
  })
})
