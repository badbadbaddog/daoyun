import { act, cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { listAdminAudit, type AdminAuditEntry } from "../api/admin"
import { RelatedAuditLog } from "./RelatedAuditLog"

vi.mock("../api/admin", async () => {
  const actual = await vi.importActual<typeof import("../api/admin")>("../api/admin")
  return { ...actual, listAdminAudit: vi.fn() }
})

const firstUserId = "019fc900-0000-7000-8000-000000000301"
const secondUserId = "019fc900-0000-7000-8000-000000000302"

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe("RelatedAuditLog", () => {
  it("does not append a stale cursor page after the related resource changes", async () => {
    const stalePage = deferred<{ entries: AdminAuditEntry[]; nextCursor: null }>()
    vi.mocked(listAdminAudit).mockImplementation((options) => {
      if (options?.cursor) return stalePage.promise
      const id = options?.userId === firstUserId ? firstUserId : secondUserId
      return Promise.resolve({ entries: [entry(id)], nextCursor: options?.userId === firstUserId ? firstUserId : null })
    })
    const user = userEvent.setup()
    const { rerender } = render(<RelatedAuditLog filter={{ userId: firstUserId }} />)
    await user.click(await screen.findByRole("button", { name: "加载更多操作记录" }))

    rerender(<RelatedAuditLog filter={{ userId: secondUserId }} />)
    expect(await screen.findByText(secondUserId)).toBeInTheDocument()
    await act(async () => {
      stalePage.resolve({ entries: [entry("019fc900-0000-7000-8000-000000000399")], nextCursor: null })
      await stalePage.promise
    })

    expect(screen.queryByText("019fc900-0000-7000-8000-000000000399")).not.toBeInTheDocument()
  })
})

function entry(id: string): AdminAuditEntry {
  return {
    id,
    actor: { id: firstUserId, username: "owner", displayName: "站长", avatarUrl: null },
    action: "user.status.update",
    resourceType: "user",
    resourceId: id,
    summary: {},
    createdAt: "2026-08-13T08:00:00Z",
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => { resolve = complete })
  return { promise, resolve }
}
