import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { getUnreadNotificationCount, listNotifications, markAllNotificationsRead, markNotificationRead } from "../api/notifications"
import type { Notification } from "../api/notifications"
import { NotificationsView } from "./NotificationsView"

vi.mock("../api/notifications", async () => {
  const actual = await vi.importActual<typeof import("../api/notifications")>("../api/notifications")
  return {
    ...actual,
    listNotifications: vi.fn(),
    getUnreadNotificationCount: vi.fn(),
    markAllNotificationsRead: vi.fn(),
    markNotificationRead: vi.fn(),
  }
})

const session = {
  user: {
    id: "019fc700-0000-7000-8000-000000000004",
    username: "member",
    email: "member@example.com",
    displayName: "社区成员",
  },
  csrfToken: "a".repeat(64),
}

const unreadNotification = {
  id: "019fc700-0000-7000-8000-000000000101",
  kind: "reply" as const,
  actor: {
    id: "019fc700-0000-7000-8000-000000000005",
    username: "reply_author",
    displayName: "回复作者",
    avatarUrl: null,
  },
  target: "topic" as const,
  targetId: "019fc700-0000-7000-8000-000000000201",
  readAt: null,
  createdAt: "2026-08-30T08:00:00Z",
}

const readNotification = {
  ...unreadNotification,
  id: "019fc700-0000-7000-8000-000000000102",
  kind: "like" as const,
  readAt: "2026-08-30T08:30:00Z",
}

beforeEach(() => {
  vi.mocked(getUnreadNotificationCount).mockReset().mockResolvedValue(1)
  vi.mocked(listNotifications).mockReset()
  vi.mocked(listNotifications).mockResolvedValue({
    notifications: [unreadNotification, readNotification],
    nextCursor: null,
  })
  vi.mocked(markNotificationRead).mockReset()
  vi.mocked(markAllNotificationsRead).mockReset()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("NotificationsView", () => {
  it("requests unread filtering from the server and resets pagination", async () => {
    const user = userEvent.setup()
    render(
      <NotificationsView
        session={session}
        onBack={vi.fn()}
        onLogin={vi.fn()}
        onOpenTarget={vi.fn()}
      />,
    )

    expect(await screen.findByText("回复作者 回复了你的主题")).toBeInTheDocument()
    expect(screen.getByText("回复作者 赞了你的内容")).toBeInTheDocument()

    vi.mocked(listNotifications).mockResolvedValue({ notifications: [unreadNotification], nextCursor: null })
    await user.click(screen.getByRole("tab", { name: "未读" }))
    await screen.findByText("回复作者 回复了你的主题")

    expect(screen.getByText("回复作者 回复了你的主题")).toBeInTheDocument()
    expect(screen.queryByText("回复作者 赞了你的内容")).not.toBeInTheDocument()
    expect(listNotifications).toHaveBeenCalledTimes(2)
    expect(listNotifications).toHaveBeenLastCalledWith(expect.objectContaining({ unread: true }))
  })
})

function show(onUnreadChange = vi.fn()) {
  return render(<NotificationsView session={session} onBack={vi.fn()} onLogin={vi.fn()} onOpenTarget={vi.fn()} onUnreadChange={onUnreadChange} />)
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

it("uses global 54 after marking one of the first 20 among 55 unread", async () => {
  const rows = Array.from({length: 20}, (_, i) => ({...unreadNotification, id: unreadNotification.id.slice(0,-3) + String(101+i)}))
  vi.mocked(listNotifications).mockResolvedValue({notifications:rows,nextCursor:rows[19].id})
  vi.mocked(getUnreadNotificationCount).mockResolvedValueOnce(55).mockResolvedValue(54)
  vi.mocked(markNotificationRead).mockResolvedValue({...rows[0], readAt:"2026-10-02T10:00:00Z"})
  const changed = vi.fn();show(changed)
  await screen.findAllByRole("button", {name:"标记通知为已读"})
  await userEvent.click(screen.getAllByRole("button", {name:"标记通知为已读"})[0])
  await waitFor(()=>expect(changed).toHaveBeenLastCalledWith(54))
  expect(changed).not.toHaveBeenCalledWith(19)
})

it("finds unread beyond an entirely read first page", async () => {
  vi.mocked(listNotifications).mockResolvedValueOnce({notifications:[readNotification],nextCursor:readNotification.id}).mockResolvedValue({notifications:[unreadNotification],nextCursor:null})
  show();await screen.findByText("回复作者 赞了你的内容")
  await userEvent.click(screen.getByRole("tab",{name:"未读"}))
  expect(await screen.findByText("回复作者 回复了你的主题")).toBeVisible()
  expect(listNotifications).toHaveBeenLastCalledWith(expect.objectContaining({unread:true}))
})

it("ignores an old page count after a newer mark response", async () => {
  const old = deferred<number>()
  vi.mocked(getUnreadNotificationCount).mockReturnValueOnce(old.promise).mockResolvedValue(54)
  vi.mocked(markNotificationRead).mockResolvedValue({...unreadNotification,readAt:"2026-10-02T10:00:00Z"})
  const changed=vi.fn();show(changed)
  await userEvent.click(await screen.findByRole("button",{name:"标记通知为已读"}))
  await waitFor(()=>expect(changed).toHaveBeenLastCalledWith(54))
  await act(async()=>old.resolve(55))
  expect(changed).toHaveBeenLastCalledWith(54)
})

it.each(["one","all"] as const)("ignores a late %s read response after switching accounts", async kind => {
  const one=deferred<Notification>()
  const all=deferred<number>()
  vi.mocked(markNotificationRead).mockReturnValue(one.promise)
  vi.mocked(markAllNotificationsRead).mockReturnValue(all.promise)
  const changed=vi.fn();const view=show(changed)
  await screen.findByText("回复作者 回复了你的主题")
  await userEvent.click(screen.getByRole("button",{name:kind==="one"?"标记通知为已读":"全部标记为已读"}))
  vi.mocked(listNotifications).mockResolvedValue({notifications:[],nextCursor:null})
  vi.mocked(getUnreadNotificationCount).mockResolvedValue(7)
  view.rerender(<NotificationsView session={{...session,user:{...session.user,id:"019fc700-0000-7000-8000-000000000006"}}} onBack={vi.fn()} onLogin={vi.fn()} onOpenTarget={vi.fn()} onUnreadChange={changed}/>)
  await screen.findByText("还没有通知")
  changed.mockClear()
  await act(async()=>{if(kind==="one")one.resolve({...unreadNotification,readAt:"2026-10-02T10:00:00Z"});else all.resolve(0)})
  expect(changed).not.toHaveBeenCalled()
  expect(screen.queryByText("回复作者 回复了你的主题")).not.toBeInTheDocument()
})

it("ignores an old all-filter next page after switching to unread", async () => {
  const more=deferred<{notifications:typeof readNotification[];nextCursor:null}>()
  vi.mocked(listNotifications).mockResolvedValueOnce({notifications:[unreadNotification],nextCursor:unreadNotification.id}).mockReturnValueOnce(more.promise).mockResolvedValue({notifications:[unreadNotification],nextCursor:null})
  show();await userEvent.click(await screen.findByRole("button",{name:"加载更多通知"}))
  await userEvent.click(screen.getByRole("tab",{name:"未读"}))
  await screen.findByText("回复作者 回复了你的主题")
  await act(async()=>more.resolve({notifications:[readNotification],nextCursor:null}))
  expect(screen.queryByText("回复作者 赞了你的内容")).not.toBeInTheDocument()
})

it("refreshes the server snapshot after read-all and preserves new unread", async () => {
  const late={...unreadNotification,id:readNotification.id,actor:{...unreadNotification.actor,displayName:"晚到作者"}}
  vi.mocked(listNotifications).mockResolvedValueOnce({notifications:[unreadNotification],nextCursor:null}).mockResolvedValue({notifications:[{...unreadNotification,readAt:"2026-10-02T10:00:00Z"},late],nextCursor:null})
  vi.mocked(markAllNotificationsRead).mockResolvedValue(1)
  vi.mocked(getUnreadNotificationCount).mockResolvedValue(1)
  const changed=vi.fn();show(changed)
  await userEvent.click(await screen.findByRole("button",{name:"全部标记为已读"}))
  expect(await screen.findByText("晚到作者 回复了你的主题")).toBeVisible()
  expect(screen.getAllByRole("button",{name:"标记通知为已读"})).toHaveLength(1)
  expect(changed).toHaveBeenLastCalledWith(1)
})

it("allows read-all when the loaded page is read but later pages are unread", async () => {
  vi.mocked(listNotifications).mockResolvedValue({notifications:[readNotification],nextCursor:readNotification.id})
  vi.mocked(getUnreadNotificationCount).mockResolvedValue(35)
  vi.mocked(markAllNotificationsRead).mockResolvedValue(0)
  show();await screen.findByText("回复作者 赞了你的内容")
  await userEvent.click(screen.getByRole("button",{name:"全部标记为已读"}))
  await waitFor(()=>expect(markAllNotificationsRead).toHaveBeenCalledTimes(1))
})

it("delegates opening the target immediately without waiting for a read request", async () => {
 const opened=vi.fn()
 render(<NotificationsView session={session} onBack={vi.fn()} onLogin={vi.fn()} onOpenTarget={opened}/>)
 await userEvent.click(await screen.findByRole("button",{name:/回复作者 回复了你的主题/}))
 await waitFor(()=>expect(opened).toHaveBeenCalledWith(unreadNotification))
 expect(markNotificationRead).not.toHaveBeenCalled()
})

it("labels existing governance events and keeps their topic target", async () => {
  const item: Notification = { ...unreadNotification, kind: "topic_governance" }
  vi.mocked(listNotifications).mockResolvedValue({ notifications: [item], nextCursor: null })
  const onOpenTarget = vi.fn()
  render(<NotificationsView session={session} onBack={vi.fn()} onLogin={vi.fn()} onOpenTarget={onOpenTarget} />)
  await userEvent.click(await screen.findByRole("button", { name: /主题治理状态有新的更新/ }))
  expect(onOpenTarget).toHaveBeenCalledWith(item)
})
