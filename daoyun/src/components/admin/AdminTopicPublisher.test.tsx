import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import { listBoards } from "../../api/boards"
import type { AuthSession } from "../../api/auth"
import { AdminTopicPublisher } from "./AdminTopicPublisher"

vi.mock("../../api/boards", () => ({ listBoards: vi.fn() }))
vi.mock("../TopicComposer", () => ({ TopicComposer: ({ onPublished, onClose }: { onPublished: () => void; onClose: () => void }) => <div role="dialog" aria-label="发布主题"><button onClick={onPublished}>确认发布</button><button onClick={onClose}>关闭</button></div> }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
const session = { csrfToken: "csrf", user: { id: "admin" } } as AuthSession
it("loads real boards only when requested and refreshes after publication", async () => {
  const user = userEvent.setup()
  const onPublished = vi.fn()
  vi.mocked(listBoards).mockResolvedValue([{ id: "board" }] as Awaited<ReturnType<typeof listBoards>>)
  render(<AdminTopicPublisher session={session} onPublished={onPublished} />)
  expect(listBoards).not.toHaveBeenCalled()
  await user.click(screen.getByRole("button", { name: "发布主题" }))
  await screen.findByRole("dialog", { name: "发布主题" })
  await user.click(screen.getByRole("button", { name: "确认发布" }))
  expect(onPublished).toHaveBeenCalledOnce()
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole("button", { name: "发布主题" })).toHaveFocus())
})
it("allows retry after a board loading failure", async () => {
  const user = userEvent.setup()
  vi.mocked(listBoards).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([])
  render(<AdminTopicPublisher session={session} onPublished={vi.fn()} />)
  await user.click(screen.getByRole("button", { name: "发布主题" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("板块加载失败")
  await user.click(screen.getByRole("button", { name: "发布主题" }))
  await waitFor(() => expect(listBoards).toHaveBeenCalledTimes(2))
  expect(await screen.findByRole("alert")).toHaveTextContent("暂无可用板块")
})
