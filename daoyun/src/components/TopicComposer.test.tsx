import { BoardApiError, getBoard, type BoardDetail } from "../api/boards"
import {getPollPolicy} from "../api/polls"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { act } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { DraftApiError, saveDraft, getDraft } from "../api/drafts"
import { TopicApiError, createTopic } from "../api/topics"
import { AttachmentApiError, uploadDraftImage } from "../api/attachments"
import type { AuthSession } from "../api/auth"
import type { Board, Topic } from "../types/community"
import { TopicComposer } from "./TopicComposer"
import { plainTextDocument, toPlainText } from "../editor/richContent"

vi.mock("../api/topics", async () => {
  const actual = await vi.importActual<typeof import("../api/topics")>("../api/topics")
  return { ...actual, createTopic: vi.fn() }
})

vi.mock("../api/polls",async()=>({...await vi.importActual<typeof import("../api/polls")>("../api/polls"),getPollPolicy:vi.fn()}))
vi.mock("../api/drafts",async()=>({...await vi.importActual<typeof import("../api/drafts")>("../api/drafts"),saveDraft:vi.fn(),listDrafts:vi.fn(),getDraft:vi.fn(),deleteDraft:vi.fn()}))
vi.mock("../api/boards", async () => ({ ...await vi.importActual<typeof import("../api/boards")>("../api/boards"), getBoard: vi.fn() }))
vi.mock("../api/attachments", async () => ({ ...await vi.importActual<typeof import("../api/attachments")>("../api/attachments"), uploadDraftImage: vi.fn() }))

const session: AuthSession = {
  user: {
    id: "019fc700-0000-7000-8000-000000000004",
    username: "member",
    email: "member@example.com",
    displayName: "社区成员",
  },
  csrfToken: "a".repeat(64),
}

const boards: Board[] = [{
  id: "019fc630-0000-7000-8000-000000000001",
  parentId: null,
  slug: "general",
  name: "社区广场",
  description: "分享想法",
  icon: "messages",
  tone: "green",
  position: 10,
  depth: 0,
  childCount: 0,
  topicCount: 0,
}]

const topic: Topic = {
  id: "019fc800-0000-7000-8000-000000000101",
  title: "发布主题",
  excerpt: "这是正文",
  board: "社区广场",
  boardTone: "green",
  authorId: session.user.id,
  authorUsername: session.user.username,
  author: "社区成员",
  avatarUrl: "https://example.com/avatar.png",
  publishedAt: "刚刚",
  replies: 0,
  likes: 0,
  bookmarked: false,
  liked: false,
  views: 0,
  tags: [],
}

const allowedBoard = (board: Board): BoardDetail => ({ ...board, children: [], breadcrumb: [], viewer: { canRead: true, canCreateTopic: true, canReply: true, canUploadAttachment: true } })

beforeEach(() => {
  vi.mocked(getBoard).mockReset().mockImplementation(async () => allowedBoard(boards[0]))
  vi.mocked(getPollPolicy).mockResolvedValue({enabled:false,can_create:false})
  const cloudDrafts = new Map<string, Awaited<ReturnType<typeof saveDraft>>>()
  vi.mocked(getDraft).mockReset().mockImplementation(async id => { const row = cloudDrafts.get(id); if (!row) throw new DraftApiError(404, "draft.not_found", "草稿不存在"); return row })
  vi.mocked(saveDraft).mockReset().mockImplementation(async(id,revision,content)=>{ const row = {id,revision:revision+1,content,updated_at:new Date().toISOString()}; cloudDrafts.set(id,row); return row })
  vi.mocked(createTopic).mockReset()
  vi.mocked(uploadDraftImage).mockReset()
  window.localStorage.clear()
})

afterEach(() => cleanup())

describe("TopicComposer", () => {

  it("saves the latest text when a delayed permission response reports expiry", async () => {
    const user = userEvent.setup()
    let reject!: (error: Error) => void
    vi.mocked(getBoard).mockImplementation(() => new Promise((_resolve, fail) => { reject = fail }))
    render(<TopicComposer open boards={boards} session={session} onClose={vi.fn()} onPublished={vi.fn()} onSessionExpired={vi.fn()} />)
    await user.type(screen.getByRole("textbox", { name: "正文" }), "查询期间最新输入")
    await act(async () => reject(new BoardApiError("登录失效", 401, "auth.unauthenticated")))
    expect(localStorage.getItem("daoyun:composer-draft:v2:" + session.user.id + ":global")).toContain("查询期间最新输入")
  })

  it.each(["publish", "draft", "upload"])("preserves the owner draft after %s reports an expired session", async source => {
    const user = userEvent.setup()
    const expired = vi.fn()
    const props = { open: true, boards, onClose: vi.fn(), onPublished: vi.fn(), onSessionExpired: expired, onLogin: vi.fn() }
    vi.mocked(createTopic).mockRejectedValue(new TopicApiError(401, "auth.unauthenticated", "登录失效"))
    if (source === "draft") vi.mocked(saveDraft).mockRejectedValue(new DraftApiError(401, "auth.unauthenticated", "登录失效"))
    if (source === "upload") vi.mocked(uploadDraftImage).mockRejectedValue(new AttachmentApiError(401, "auth.unauthenticated", "登录失效"))
    const view = render(<TopicComposer {...props} session={session} />)
    await user.type(screen.getByRole("textbox", { name: "正文" }), "失效会话中的私有正文")
    if (source === "upload") fireEvent.change(screen.getByLabelText("选择帖子图片"), { target: { files: [new File(["png"], "pending.png", { type: "image/png" })] } })
    else await user.click(screen.getByRole("button", { name: "发布" }))
    await waitFor(() => expect(expired).toHaveBeenCalledTimes(1))
    view.rerender(<TopicComposer {...props} session={null} />)
    expect(screen.getByRole("textbox", { name: "正文" })).toHaveTextContent("失效会话中的私有正文")
    expect(screen.getByRole("button", { name: "发布" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "重新登录" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "重新登录" })).toHaveFocus()
    expect(localStorage.getItem("daoyun:composer-draft:v2:guest:global")).toBeNull()
    expect(localStorage.getItem("daoyun:composer-draft:v2:" + session.user.id + ":global")).toContain("失效会话中的私有正文")
    const other = { ...session, csrfToken: "b".repeat(64), user: { ...session.user, id: "019fc700-0000-7000-8000-000000000099" } }
    view.rerender(<TopicComposer {...props} session={other} />)
    expect(screen.getByRole("textbox", { name: "正文" })).not.toHaveTextContent("失效会话中的私有正文")
    view.rerender(<TopicComposer {...props} session={{ ...session, csrfToken: "c".repeat(64) }} />)
    expect(screen.getByRole("textbox", { name: "正文" })).toHaveTextContent("失效会话中的私有正文")
  })

  it("rechecks permissions after reauthentication while retaining images, board and title", async () => {
    const user = userEvent.setup()
    const second = { ...boards[0], id: "019fc630-0000-7000-8000-000000000002", slug: "feedback", name: "反馈" }
    const props = { open: true, boards: [...boards, second], onClose: vi.fn(), onPublished: vi.fn(), onSessionExpired: vi.fn(), onLogin: vi.fn() }
    vi.mocked(uploadDraftImage).mockResolvedValue({ id: "019fc800-0000-7000-8000-000000000209", originalName: "own.png", expiresAt: "2099-01-01T00:00:00Z", mimeType: "image/png", sizeBytes: 3 })
    vi.mocked(createTopic).mockRejectedValueOnce(new TopicApiError(401, "auth.unauthenticated", "登录失效")).mockResolvedValue(topic)
    const view = render(<TopicComposer {...props} session={session} />)
    await user.type(screen.getByRole("textbox", { name: "标题（可选）" }), "保留的标题")
    await user.type(screen.getByRole("textbox", { name: "正文" }), "保留的正文")
    await user.selectOptions(screen.getByRole("combobox", { name: "板块" }), second.id)
    await waitFor(() => expect(screen.getByLabelText("选择帖子图片")).toBeEnabled())
    fireEvent.change(screen.getByLabelText("选择帖子图片"), { target: { files: [new File(["png"], "own.png", { type: "image/png" })] } })
    await screen.findByRole("img", { name: "own.png" })
    await user.click(screen.getByRole("button", { name: "发布" }))
    await waitFor(() => expect(props.onSessionExpired).toHaveBeenCalledTimes(1))
    view.rerender(<TopicComposer {...props} session={null} />)
    view.rerender(<TopicComposer {...props} boards={[]} session={null} />)
    view.rerender(<TopicComposer {...props} session={null} />)
    await user.click(screen.getByRole("button", { name: "重新登录" }))
    expect(props.onLogin).toHaveBeenCalledTimes(1)
    view.rerender(<TopicComposer {...props} session={null} suspended />)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    let finish!: (board: BoardDetail) => void
    vi.mocked(getBoard).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    view.rerender(<TopicComposer {...props} session={{ ...session, csrfToken: "b".repeat(64) }} />)
    expect(screen.getByRole("button", { name: "发布" })).toBeDisabled()
    expect(screen.getByRole("textbox", { name: "标题（可选）" })).toHaveValue("保留的标题")
    expect(screen.getByRole("textbox", { name: "正文" })).toHaveTextContent("保留的正文")
    expect(screen.getByRole("combobox", { name: "板块" })).toHaveValue(second.id)
    expect(screen.getByRole("img", { name: "own.png" })).toBeInTheDocument()
    await act(async () => finish({ ...allowedBoard(second), viewer: { canRead: true, canCreateTopic: false, canReply: false, canUploadAttachment: false } }))
    await screen.findByText(/当前版块不可发布/)
    expect(screen.getByRole("button", { name: "发布" })).toBeDisabled()
    expect(createTopic).toHaveBeenCalledTimes(1)
  })

  it("keeps CSRF and ordinary permission failures separate from session expiry", async () => {
    const user = userEvent.setup()
    const expired = vi.fn()
    vi.mocked(createTopic).mockRejectedValue(new TopicApiError(403, "auth.csrf_failed", "CSRF 校验失败"))
    render(<TopicComposer open boards={boards} session={session} onClose={vi.fn()} onPublished={vi.fn()} onSessionExpired={expired} />)
    await user.type(screen.getByRole("textbox", { name: "正文" }), "权限失败的正文")
    await user.click(screen.getByRole("button", { name: "发布" }))
    await screen.findByText("CSRF 校验失败")
    expect(expired).not.toHaveBeenCalled()
    expect(screen.queryByRole("button", { name: "重新登录" })).not.toBeInTheDocument()
  })


  it("rechecks attachment permission when switching boards and preserves the draft", async () => {
    const user = userEvent.setup()
    const restricted = { ...boards[0], id: "019fc630-0000-7000-8000-000000000002", slug: "feedback", name: "反馈" }
    vi.mocked(getBoard).mockImplementation(async slug => ({ ...allowedBoard(slug === "general" ? boards[0] : restricted), viewer: { canRead: true, canCreateTopic: true, canReply: true, canUploadAttachment: slug === "general" } }))
    vi.mocked(uploadDraftImage).mockResolvedValue({ id: "019fc800-0000-7000-8000-000000000209", originalName: "own.png", expiresAt: "2099-01-01T00:00:00Z", mimeType: "image/png", sizeBytes: 3 })
    render(<TopicComposer open boards={[...boards, restricted]} session={session} onClose={vi.fn()} onPublished={vi.fn()} />)
    await user.type(screen.getByRole("textbox", { name: "正文" }), "切换版块仍保留正文")
    fireEvent.change(screen.getByLabelText("选择帖子图片"), { target: { files: [new File(["png"], "own.png", { type: "image/png" })] } })
    await screen.findByRole("img", { name: "own.png" })
    await user.selectOptions(screen.getByRole("combobox", { name: "板块" }), restricted.id)
    await screen.findByText(/当前版块不允许上传图片/)
    expect(screen.getByRole("button", { name: "上传图片" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "发布" })).toBeDisabled()
    expect(screen.getByRole("textbox", { name: "正文" })).toHaveTextContent("切换版块仍保留正文")
    expect(screen.getByRole("img", { name: "own.png" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "删除图片 1" }))
    expect(screen.getByRole("button", { name: "发布" })).toBeEnabled()
  })

  it("ignores an old allowed board response after selecting a read-only board", async () => {
    const user = userEvent.setup()
    const restricted = { ...boards[0], id: "019fc630-0000-7000-8000-000000000002", slug: "feedback", name: "反馈" }
    let finish!: (board: BoardDetail) => void
    vi.mocked(getBoard).mockImplementation(slug => slug === "general" ? new Promise(resolve => { finish = resolve }) : Promise.resolve({ ...allowedBoard(restricted), viewer: { canRead: true, canCreateTopic: false, canReply: false, canUploadAttachment: false } }))
    render(<TopicComposer open boards={[...boards, restricted]} session={session} onClose={vi.fn()} onPublished={vi.fn()} />)
    expect(screen.getByRole("button", { name: "发布" })).toBeDisabled()
    await user.type(screen.getByRole("textbox", { name: "正文" }), "权限变化仍保留正文")
    const oldSignal = vi.mocked(getBoard).mock.calls[0][1]
    await user.selectOptions(screen.getByRole("combobox", { name: "板块" }), restricted.id)
    await screen.findByText(/当前版块不可发布/)
    await act(async () => finish(allowedBoard(boards[0])))
    expect(oldSignal?.aborted).toBe(true)
    expect(screen.getByRole("button", { name: "发布" })).toBeDisabled()
    fireEvent.submit(screen.getByRole("button", { name: "发布" }).closest("form")!)
    expect(createTopic).not.toHaveBeenCalled()
    expect(screen.getByRole("textbox", { name: "正文" })).toHaveTextContent("权限变化仍保留正文")
  })

  it("blocks mutations after a permission lookup failure and retries without losing text", async () => {
    const user = userEvent.setup()
    vi.mocked(getBoard).mockRejectedValueOnce(new Error("offline")).mockResolvedValue(allowedBoard(boards[0]))
    render(<TopicComposer open boards={boards} session={session} onClose={vi.fn()} onPublished={vi.fn()} />)
    await user.type(screen.getByRole("textbox", { name: "正文" }), "网络恢复继续编辑")
    expect(screen.getByRole("button", { name: "发布" })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "重试版块权限" }))
    await waitFor(() => expect(screen.getByRole("button", { name: "发布" })).toBeEnabled())
    expect(screen.getByRole("textbox", { name: "正文" })).toHaveTextContent("网络恢复继续编辑")
  })

  it.each(["logout", "switch", "rotate"])("ignores a late publish response after %s", async (change) => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onPublished = vi.fn()
    let finish!: (value: Topic) => void
    vi.mocked(createTopic).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const view = render(<TopicComposer open boards={boards} session={session} onClose={onClose} onPublished={onPublished} />)
    await user.type(screen.getByRole("textbox", { name: "正文" }), "原账号正文")
    await user.click(screen.getByRole("button", { name: "发布" }))
    await waitFor(() => expect(createTopic).toHaveBeenCalledTimes(1))
    const signal = vi.mocked(createTopic).mock.calls[0][1]?.signal
    const nextSession = change === "logout" ? null : {
      ...session,
      csrfToken: "b".repeat(64),
      user: change === "switch" ? { ...session.user, id: "019fc700-0000-7000-8000-000000000099" } : session.user,
    }
    view.rerender(<TopicComposer open boards={boards} session={nextSession} onClose={onClose} onPublished={onPublished} />)
    await waitFor(() => expect(screen.getByRole("button", { name: "发布" })).toBeEnabled())
    await user.type(screen.getByRole("textbox", { name: "标题（可选）" }), "当前账号草稿")
    await act(async () => finish(topic))

    expect(signal?.aborted).toBe(true)
    expect(onPublished).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole("textbox", { name: "标题（可选）" })).toHaveValue("当前账号草稿")
  })

  it("does not close the new account editor when an old close-save finishes", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    let finish!: () => void
    vi.mocked(saveDraft).mockImplementation((id, revision, content) => new Promise(resolve => {
      finish = () => resolve({ id, revision: revision + 1, content, updated_at: new Date().toISOString() })
    }))
    const view = render(<TopicComposer open boards={boards} session={session} onClose={onClose} onPublished={vi.fn()} />)
    await user.type(screen.getByRole("textbox", { name: "正文" }), "旧账号未发布正文")
    await user.click(screen.getByRole("button", { name: "关闭发布窗口" }))
    await user.click(screen.getByRole("button", { name: "确认关闭" }))
    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1))
    view.rerender(<TopicComposer open boards={boards} session={null} onClose={onClose} onPublished={vi.fn()} />)
    await act(async () => finish())

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole("textbox", { name: "正文" })).toHaveTextContent("")
    expect(screen.getByRole("button", { name: "发布" })).toBeEnabled()
  })
  it("publishes a topic with the selected board and auth protection", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onPublished = vi.fn()
    vi.mocked(createTopic).mockResolvedValue(topic)
    render(
      <TopicComposer
        open
        boards={boards}
        session={session}
        onClose={onClose}
        onPublished={onPublished}
      />,
    )

    await user.type(screen.getByRole("textbox", { name: "标题（可选）" }), "发布主题")
    await user.type(screen.getByRole("textbox", { name: "正文" }), "这是正文")
    await user.click(screen.getByRole("button", { name: "发布" }))

    expect(createTopic).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "发布主题",
        content: "这是正文",
        boardId: boards[0].id,
        richContent: expect.objectContaining({ type: "doc" }),
      }),
      expect.objectContaining({ csrfToken: session.csrfToken, idempotencyKey: expect.any(String) }),
    )
    expect(onPublished).toHaveBeenCalledWith(topic)
    expect(onClose).toHaveBeenCalled()
    expect(window.localStorage.getItem(`daoyun:composer-draft:v2:${session.user.id}:global`)).toBeNull()
  })

  it("publishes body-only content without sending a title", async () => {
    const user = userEvent.setup()
    vi.mocked(createTopic).mockResolvedValue(topic)
    render(
      <TopicComposer
        open
        boards={boards}
        session={session}
        onClose={vi.fn()}
        onPublished={vi.fn()}
      />,
    )

    await user.type(screen.getByRole("textbox", { name: "正文" }), "只有正文也能发布")
    await user.click(screen.getByRole("button", { name: "发布" }))

    const input = vi.mocked(createTopic).mock.calls[0][0]
    expect(input).toMatchObject({
      content: "只有正文也能发布",
      boardId: boards[0].id,
      richContent: expect.objectContaining({ type: "doc" }),
    })
    expect(input).not.toHaveProperty("title")
  })

  it("shows the title directly and restores then updates the local composer draft", async () => {
    const user = userEvent.setup()
    const draftKey = `daoyun:composer-draft:v2:${session.user.id}:global`
    window.localStorage.setItem(draftKey, JSON.stringify({
      version: 2,
      title: "草稿标题",
      richContent: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "草稿正文" }] }] },
      boardId: "deleted-board",
      images: [{ attachmentId: "019fc800-0000-7000-8000-000000000209", fileName: "草稿图片.jpg" }],
      savedAt: new Date().toISOString(),
    }))

    render(
      <TopicComposer
        open
        boards={boards}
        session={session}
        onClose={vi.fn()}
        onPublished={vi.fn()}
      />,
    )

    expect(screen.queryByRole("button", { name: "添加标题" })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole("textbox", { name: "标题（可选）" })).toHaveValue("草稿标题"))
    expect(screen.getByRole("textbox", { name: "正文" })).toHaveTextContent("草稿正文")
    expect(screen.getByRole("img", { name: "草稿图片.jpg" })).toBeInTheDocument()
    expect(screen.queryByRole("textbox", { name: "标签" })).not.toBeInTheDocument()

    await user.type(screen.getByRole("textbox", { name: "正文" }), " 继续编辑")
    await waitFor(() => expect(window.localStorage.getItem(draftKey)).toContain("继续编辑"))
    expect(JSON.parse(window.localStorage.getItem(draftKey) ?? "null").boardId).toBe(boards[0].id)
  })

  it("keeps expired draft attachments out of a restored text draft", async () => {
    const draftKey = `daoyun:composer-draft:v2:${session.user.id}:global`
    window.localStorage.setItem(draftKey, JSON.stringify({
      version: 2,
      title: "仍可恢复的标题",
      richContent: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "仍可恢复的正文" }] }] },
      boardId: boards[0].id,
      images: [{
        attachmentId: "019fc800-0000-7000-8000-000000000210",
        fileName: "已过期图片.jpg",
        expiresAt: "2026-09-06T00:00:00Z",
      }],
      savedAt: "2026-09-06T00:00:00Z",
    }))

    render(<TopicComposer open boards={boards} session={session} onClose={vi.fn()} onPublished={vi.fn()} />)

    await waitFor(() => expect(screen.getByRole("textbox", { name: "标题（可选）" })).toHaveValue("仍可恢复的标题"))
    expect(screen.getByRole("textbox", { name: "正文" })).toHaveTextContent("仍可恢复的正文")
    expect(screen.queryByRole("img", { name: "已过期图片.jpg" })).not.toBeInTheDocument()
    expect(screen.getByText("已上传 0 / 9 张")).toBeInTheDocument()
  })

  it("keeps composer drafts isolated when the signed-in user changes", async () => {
    const user = userEvent.setup()
    const view = render(<TopicComposer open boards={boards} session={session} onClose={vi.fn()} onPublished={vi.fn()} />)
    await user.type(screen.getByRole("textbox", { name: "标题（可选）" }), "第一个用户的草稿")

    const secondSession: AuthSession = {
      ...session,
      user: { ...session.user, id: "019fc700-0000-7000-8000-000000000099", username: "second" },
    }
    view.rerender(<TopicComposer open boards={boards} session={secondSession} onClose={vi.fn()} onPublished={vi.fn()} />)

    await waitFor(() => expect(screen.getByRole("textbox", { name: "标题（可选）" })).toHaveValue(""))
    expect(window.localStorage.getItem(`daoyun:composer-draft:v2:${session.user.id}:global`))
      .toContain("第一个用户的草稿")
    expect(window.localStorage.getItem(`daoyun:composer-draft:v2:${secondSession.user.id}:global`)).toBeNull()
  })

  it("submits hashtags from the body without a separate tag field", async () => {
    const user = userEvent.setup()
    vi.mocked(createTopic).mockResolvedValue(topic)
    render(<TopicComposer
      open
      boards={boards}
      session={session}
      availableTags={[{ slug: "rust-lang", name: "Rust" }]}
      onClose={vi.fn()}
      onPublished={vi.fn()}
    />)

    expect(screen.queryByRole("textbox", { name: "标签" })).not.toBeInTheDocument()
    await user.type(screen.getByRole("textbox", { name: "正文" }), "讨论 #我是标签#例子标签 和 #Rust")
    await user.click(screen.getByRole("button", { name: "发布" }))

    expect(vi.mocked(createTopic).mock.calls[0][0].tags).toEqual([
      { slug: expect.stringMatching(/^[a-z0-9-]{1,40}$/), name: "我是标签" },
      { slug: expect.stringMatching(/^[a-z0-9-]{1,40}$/), name: "例子标签" },
      { slug: "rust-lang", name: "Rust" },
    ])
  })

  it("opens the multi-image picker and accepts dropped images", async () => {
    const user = userEvent.setup()
    const image = new File(["image"], "mountain.jpg", { type: "image/jpeg" })
    const secondImage = new File(["image"], "valley.jpg", { type: "image/jpeg" })
    vi.mocked(uploadDraftImage).mockImplementation(async (file) => ({
      id: file === image ? "019fc800-0000-7000-8000-000000000201" : "019fc800-0000-7000-8000-000000000203",
      originalName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      expiresAt: "2026-09-08T00:00:00Z",
    }))
    render(<TopicComposer open boards={boards} session={session} onClose={vi.fn()} onPublished={vi.fn()} />)

    const input = screen.getByLabelText("选择帖子图片")
    const inputClick = vi.spyOn(input as HTMLInputElement, "click")
    await user.click(screen.getByRole("button", { name: "上传图片" }))
    expect(inputClick).toHaveBeenCalled()

    fireEvent.drop(screen.getByTestId("composer-image-dropzone"), {
      dataTransfer: { files: [image], types: ["Files"] },
    })

    const uploadedImage = await screen.findByRole("img", { name: "mountain.jpg" })
    expect(uploadDraftImage).toHaveBeenCalledWith(image, session.csrfToken, expect.any(Function), expect.any(AbortSignal))

    fireEvent.drop(uploadedImage.closest("li")!, {
      dataTransfer: { files: [secondImage], types: ["Files"], getData: () => "" },
    })
    expect(await screen.findByRole("img", { name: "valley.jpg" })).toBeInTheDocument()
  })

  it("discards an upload that finishes after the composer closes", async () => {
    const image = new File(["image"], "late.jpg", { type: "image/jpeg" })
    let finishUpload: ((attachment: Awaited<ReturnType<typeof uploadDraftImage>>) => void) | undefined
    vi.mocked(uploadDraftImage).mockImplementation(() => new Promise((resolve) => {
      finishUpload = resolve
    }))
    const view = render(<TopicComposer open boards={boards} session={session} onClose={vi.fn()} onPublished={vi.fn()} />)
    await waitFor(() => expect(screen.getByLabelText("选择帖子图片")).toBeEnabled())

    fireEvent.change(screen.getByLabelText("选择帖子图片"), { target: { files: [image] } })
    await waitFor(() => expect(uploadDraftImage).toHaveBeenCalledTimes(1))
    view.rerender(<TopicComposer open={false} boards={boards} session={session} onClose={vi.fn()} onPublished={vi.fn()} />)
    await act(async () => {
      finishUpload?.({
        id: "019fc800-0000-7000-8000-000000000202",
        originalName: image.name,
        mimeType: image.type,
        sizeBytes: image.size,
        expiresAt: "2026-09-08T00:00:00Z",
      })
      await Promise.resolve()
    })
    view.rerender(<TopicComposer open boards={boards} session={session} onClose={vi.fn()} onPublished={vi.fn()} />)

    expect(screen.queryByRole("img", { name: image.name })).not.toBeInTheDocument()
    expect(screen.getByText("已上传 0 / 9 张")).toBeInTheDocument()
  })

  it("starts only one upload batch when the picker fires twice in the same turn", async () => {
    const image = new File(["image"], "once.jpg", { type: "image/jpeg" })
    vi.mocked(uploadDraftImage).mockImplementation(() => new Promise(() => undefined))
    render(<TopicComposer open boards={boards} session={session} onClose={vi.fn()} onPublished={vi.fn()} />)
    await waitFor(() => expect(screen.getByLabelText("选择帖子图片")).toBeEnabled())
    const input = screen.getByLabelText("选择帖子图片")

    act(() => {
      fireEvent.change(input, { target: { files: [image] } })
      fireEvent.change(input, { target: { files: [image] } })
    })

    expect(uploadDraftImage).toHaveBeenCalledTimes(1)
  })

  it("uploads no more than nine images from one selection", async () => {
    const files = Array.from({ length: 10 }, (_, index) => new File([`${index}`], `image-${index + 1}.png`, { type: "image/png" }))
    vi.mocked(uploadDraftImage).mockImplementation(async (file) => ({
      id: `019fc800-0000-7000-8000-${String(300 + files.indexOf(file)).padStart(12, "0")}`,
      originalName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      expiresAt: "2026-09-08T00:00:00Z",
    }))
    render(<TopicComposer open boards={boards} session={session} onClose={vi.fn()} onPublished={vi.fn()} />)
    await waitFor(() => expect(screen.getByLabelText("选择帖子图片")).toBeEnabled())

    fireEvent.change(screen.getByLabelText("选择帖子图片"), { target: { files } })

    await waitFor(() => expect(uploadDraftImage).toHaveBeenCalledTimes(9))
    expect(screen.getByRole("alert")).toHaveTextContent("最多上传 9 张图片")
    expect(screen.getByText("已上传 9 / 9 张")).toBeInTheDocument()
  })

  it("sorts and deletes images before publishing them in display order", async () => {
    const user = userEvent.setup()
    const files = ["first.jpg", "second.jpg", "third.jpg"].map((name) => new File([name], name, { type: "image/jpeg" }))
    const ids = [
      "019fc800-0000-7000-8000-000000000401",
      "019fc800-0000-7000-8000-000000000402",
      "019fc800-0000-7000-8000-000000000403",
    ]
    vi.mocked(uploadDraftImage).mockImplementation(async (file) => ({
      id: ids[files.indexOf(file)],
      originalName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      expiresAt: "2026-09-08T00:00:00Z",
    }))
    vi.mocked(createTopic).mockResolvedValue(topic)
    render(<TopicComposer open boards={boards} session={session} onClose={vi.fn()} onPublished={vi.fn()} />)
    await waitFor(() => expect(screen.getByLabelText("选择帖子图片")).toBeEnabled())

    fireEvent.change(screen.getByLabelText("选择帖子图片"), { target: { files } })
    await screen.findByRole("img", { name: "third.jpg" })
    fireEvent.keyDown(screen.getByRole("button", { name: "前移图片 1" }), { key: "ArrowRight" })
    await user.click(screen.getByRole("button", { name: "删除图片 3" }))
    await user.type(screen.getByRole("textbox", { name: "正文" }), "带有有序图片的正文")
    await user.click(screen.getByRole("button", { name: "发布" }))

    const publishedDocument = vi.mocked(createTopic).mock.calls[0][0].richContent
    expect(publishedDocument?.content[0]).toMatchObject({ type: "paragraph" })
    expect(publishedDocument?.content.slice(1)).toEqual([
      { type: "image", attrs: { attachmentId: ids[1], alt: "second.jpg" } },
      { type: "image", attrs: { attachmentId: ids[0], alt: "first.jpg" } },
    ])
  })


  it("retains a failed slot, retries only that file and publishes the selected order", async () => {
    const user = userEvent.setup()
    const files = ["first.jpg", "second.jpg"].map(name => new File([name], name, { type: "image/jpeg" }))
    const ids = ["019fc800-0000-7000-8000-000000000601", "019fc800-0000-7000-8000-000000000602"]
    vi.mocked(uploadDraftImage).mockRejectedValueOnce(new Error("第一张网络失败")).mockImplementation(async file => ({
      id: ids[files.indexOf(file)], originalName: file.name, mimeType: file.type, sizeBytes: file.size, expiresAt: "2099-01-01T00:00:00Z",
    }))
    vi.mocked(createTopic).mockResolvedValue(topic)
    render(<TopicComposer open boards={boards} session={session} onClose={vi.fn()} onPublished={vi.fn()} />)
    await user.type(screen.getByRole("textbox", { name: "正文" }), "失败时保留正文")
    fireEvent.change(screen.getByLabelText("选择帖子图片"), { target: { files } })
    await screen.findByRole("img", { name: "second.jpg" })
    expect(screen.getByRole("button", { name: "发布" })).toBeDisabled()
    expect(screen.getByText("第一张网络失败")).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "正文" })).toHaveTextContent("失败时保留正文")
    await user.click(screen.getByRole("button", { name: "重试图片 1" }))
    await screen.findByRole("img", { name: "first.jpg" })
    expect(vi.mocked(uploadDraftImage).mock.calls.map(call => call[0])).toEqual([files[0], files[1], files[0]])
    expect(screen.getAllByRole("img").map(image => image.getAttribute("alt"))).toEqual(["first.jpg", "second.jpg"])
    await user.click(screen.getByRole("button", { name: "发布" }))
    expect(vi.mocked(createTopic).mock.calls[0][0].richContent?.content.slice(1).map(image => image.attrs?.attachmentId)).toEqual(ids)
  })

  it("counts failed images toward nine slots and permits publishing after explicit removal", async () => {
    const user = userEvent.setup()
    vi.mocked(uploadDraftImage).mockRejectedValue(new Error("上传失败"))
    vi.mocked(createTopic).mockResolvedValue(topic)
    render(<TopicComposer open boards={boards} session={session} onClose={vi.fn()} onPublished={vi.fn()} />)
    await user.type(screen.getByRole("textbox", { name: "正文" }), "主动移除失败图片")
    const files = Array.from({length: 9}, (_, index) => new File(["x"], "failed-"+index+".png", {type:"image/png"}))
    fireEvent.change(screen.getByLabelText("选择帖子图片"), {target:{files}})
    await screen.findByRole("button", {name:"重试图片 9"})
    fireEvent.change(screen.getByLabelText("选择帖子图片"), {target:{files:[new File(["x"], "tenth.png", {type:"image/png"})]}})
    expect(uploadDraftImage).toHaveBeenCalledTimes(9)
    expect(screen.getByRole("button", {name:"发布"})).toBeDisabled()
    for (let index = 0; index < 9; index += 1) await user.click(screen.getByRole("button", {name:"删除图片 1"}))
    await user.click(screen.getByRole("button", {name:"发布"}))
    expect(vi.mocked(createTopic).mock.calls[0][0].richContent?.content).toHaveLength(1)
  })

  it("keeps unfinished files in the local draft and requires reselection after reopening", async () => {
    const user = userEvent.setup()
    const file = new File(["image"], "recover.jpg", {type:"image/jpeg"})
    vi.mocked(uploadDraftImage).mockRejectedValueOnce(new Error("连接中断")).mockResolvedValueOnce({
      id:"019fc800-0000-7000-8000-000000000603",originalName:file.name,mimeType:file.type,sizeBytes:file.size,expiresAt:"2099-01-01T00:00:00Z",
    })
    const view=render(<TopicComposer open boards={boards} session={session} onClose={vi.fn()} onPublished={vi.fn()} />)
    await user.type(screen.getByRole("textbox", {name:"正文"}), "本机恢复正文")
    fireEvent.change(screen.getByLabelText("选择帖子图片"), {target:{files:[file]}})
    await screen.findByRole("button", {name:"重试图片 1"})
    await user.click(screen.getByRole("button", {name:"关闭发布窗口"}))
    await user.click(screen.getByRole("button", {name:"确认关闭"}))
    const draftKey="daoyun:composer-draft:v2:"+session.user.id+":global"
    await waitFor(()=>expect(window.localStorage.getItem(draftKey)).toContain(file.name))
    const saved=JSON.parse(window.localStorage.getItem(draftKey)!)
    expect(saved.images[0]).not.toHaveProperty("file")
    view.unmount()
    render(<TopicComposer open boards={boards} session={session} onClose={vi.fn()} onPublished={vi.fn()} />)
    const reselect=await screen.findByRole("button", {name:"重新选择图片 1"})
    expect(screen.getByRole("textbox", {name:"正文"})).toHaveTextContent("本机恢复正文")
    expect(screen.getByRole("button", {name:"发布"})).toBeDisabled()
    expect(uploadDraftImage).toHaveBeenCalledTimes(1)
    await user.click(reselect)
    fireEvent.change(screen.getByLabelText("重新选择失败图片"), {target:{files:[file]}})
    await screen.findByRole("img", {name:file.name})
    expect(screen.getByRole("button", {name:"发布"})).toBeEnabled()
  })

  it("restores button-sorted images in both local and server drafts before publishing", async () => {
    const user=userEvent.setup()
    const files=["one.png","two.png","three.png"].map(name=>new File([name],name,{type:"image/png"}))
    const ids=files.map((_,index)=>"019fc800-0000-7000-8000-"+String(610+index).padStart(12,"0"))
    vi.mocked(uploadDraftImage).mockImplementation(async file=>({id:ids[files.indexOf(file)],originalName:file.name,mimeType:file.type,sizeBytes:file.size,expiresAt:"2099-01-01T00:00:00Z"}))
    vi.mocked(createTopic).mockResolvedValue(topic)
    const view=render(<TopicComposer open boards={boards} session={session} onClose={vi.fn()} onPublished={vi.fn()} />)
    await user.type(screen.getByRole("textbox", {name:"正文"}), "重排后恢复")
    fireEvent.change(screen.getByLabelText("选择帖子图片"), {target:{files}})
    await screen.findByRole("img", {name:"three.png"})
    const move=screen.getByRole("button", {name:"前移图片 3"})
    await user.click(move)
    expect(move).toHaveFocus()
    expect(screen.getAllByRole("img").map(image=>image.getAttribute("alt"))).toEqual(["one.png","three.png","two.png"])
    const draftKey="daoyun:composer-draft:v2:"+session.user.id+":global"
    await waitFor(()=>expect(JSON.parse(window.localStorage.getItem(draftKey)!).images.map((image:{attachmentId:string})=>image.attachmentId)).toEqual([ids[0],ids[2],ids[1]]))
    view.unmount()
    render(<TopicComposer open boards={boards} session={session} onClose={vi.fn()} onPublished={vi.fn()} />)
    await screen.findByRole("img", {name:"two.png"})
    expect(screen.getAllByRole("img").map(image=>image.getAttribute("alt"))).toEqual(["one.png","three.png","two.png"])
    await user.click(screen.getByRole("button", {name:"发布"}))
    expect(vi.mocked(saveDraft).mock.calls.at(-1)?.[2].images.map(image=>image.attachmentId)).toEqual([ids[0],ids[2],ids[1]])
    expect(vi.mocked(createTopic).mock.calls[0][0].richContent?.content.slice(1).map(image=>image.attrs?.attachmentId)).toEqual([ids[0],ids[2],ids[1]])
  })

  it("cancels the old user's upload when the draft owner changes", async () => {
    const file=new File(["image"],"owner.jpg",{type:"image/jpeg"})
    let signal:AbortSignal|undefined
    let finish:((value:Awaited<ReturnType<typeof uploadDraftImage>>)=>void)|undefined
    vi.mocked(uploadDraftImage).mockImplementation((_file,_csrf,_progress,currentSignal)=>{signal=currentSignal;return new Promise(resolve=>{finish=resolve})})
    const view=render(<TopicComposer open boards={boards} session={session} onClose={vi.fn()} onPublished={vi.fn()} />)
    await waitFor(() => expect(screen.getByLabelText("选择帖子图片")).toBeEnabled())
    fireEvent.change(screen.getByLabelText("选择帖子图片"), {target:{files:[file]}})
    await waitFor(()=>expect(signal).toBeDefined())
    const secondSession={...session,user:{...session.user,id:"019fc700-0000-7000-8000-000000000098"}}
    view.rerender(<TopicComposer open boards={boards} session={secondSession} onClose={vi.fn()} onPublished={vi.fn()} />)
    await waitFor(()=>expect(signal?.aborted).toBe(true))
    await act(async()=>finish?.({id:"019fc800-0000-7000-8000-000000000619",originalName:file.name,mimeType:file.type,sizeBytes:file.size,expiresAt:"2099-01-01T00:00:00Z"}))
    expect(screen.queryByRole("img",{name:file.name})).not.toBeInTheDocument()
    expect(screen.getByText("已上传 0 / 9 张")).toBeInTheDocument()
  })


  it("cancels a batch without losing ready, uploading or waiting image slots", async () => {
    const user=userEvent.setup()
    const files=["ready.png","active.png","waiting.png"].map(name=>new File([name],name,{type:"image/png"}))
    const ids=files.map((_,index)=>"019fc800-0000-7000-8000-"+String(620+index).padStart(12,"0"))
    let signal:AbortSignal|undefined
    let finish:((value:Awaited<ReturnType<typeof uploadDraftImage>>)=>void)|undefined
    const uploaded=(file:File)=>({id:ids[files.indexOf(file)],originalName:file.name,mimeType:file.type,sizeBytes:file.size,expiresAt:"2099-01-01T00:00:00Z"})
    vi.mocked(uploadDraftImage).mockResolvedValueOnce(uploaded(files[0])).mockImplementationOnce((_file,_csrf,_progress,currentSignal)=>{signal=currentSignal;return new Promise(resolve=>{finish=resolve})}).mockImplementation(async file=>uploaded(file))
    render(<TopicComposer open boards={boards} session={session} onClose={vi.fn()} onPublished={vi.fn()} />)
    await waitFor(() => expect(screen.getByLabelText("选择帖子图片")).toBeEnabled())
    fireEvent.change(screen.getByLabelText("选择帖子图片"),{target:{files}})
    await waitFor(()=>expect(uploadDraftImage).toHaveBeenCalledTimes(2))
    await user.click(screen.getByRole("button",{name:"取消上传"}))
    expect(signal?.aborted).toBe(true)
    await screen.findByRole("button",{name:"重试图片 2"})
    expect(screen.getByRole("button",{name:"重试图片 3"})).toBeEnabled()
    expect(screen.getByRole("button",{name:"发布"})).toBeDisabled()
    await act(async()=>finish?.(uploaded(files[1])))
    expect(screen.queryByRole("img",{name:"active.png"})).not.toBeInTheDocument()
    await user.click(screen.getByRole("button",{name:"重试图片 2"}))
    await screen.findByRole("img",{name:"active.png"})
    await user.click(screen.getByRole("button",{name:"重试图片 3"}))
    await screen.findByRole("img",{name:"waiting.png"})
    expect(screen.getAllByRole("img").map(image=>image.getAttribute("alt"))).toEqual(files.map(file=>file.name))
    expect(screen.getByText("已上传 3 / 9 张")).toBeInTheDocument()
  })

  it("counts restored body images when reserving upload slots", async () => {
    const key="daoyun:composer-draft:v2:"+session.user.id+":global"
    window.localStorage.setItem(key,JSON.stringify({version:2,title:"",boardId:boards[0].id,images:[],savedAt:new Date().toISOString(),richContent:{type:"doc",content:[{type:"paragraph",content:[{type:"text",text:"已有正文图片"}]},...Array.from({length:9},()=>({type:"image",attrs:{attachmentId:"019fc800-0000-7000-8000-000000000630",alt:"正文图片"}}))]}}))
    render(<TopicComposer open boards={boards} session={session} onClose={vi.fn()} onPublished={vi.fn()} />)
    await screen.findByText("已上传 9 / 9 张")
    fireEvent.change(screen.getByLabelText("选择帖子图片"),{target:{files:[new File(["image"],"tenth.png",{type:"image/png"})]}})
    expect(uploadDraftImage).not.toHaveBeenCalled()
    expect(screen.getByRole("alert")).toHaveTextContent("最多上传 9 张图片")
  })

  it("keeps a signed-out composer open and explains the auth requirement", async () => {
    const user = userEvent.setup()
    render(<TopicComposer open boards={boards} session={null} onClose={vi.fn()} onPublished={vi.fn()} />)

    await user.type(screen.getByRole("textbox", { name: "正文" }), "正文")
    await user.click(screen.getByRole("button", { name: "发布" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("请先登录后发布主题")
    expect(createTopic).not.toHaveBeenCalled()
  })

  it("reuses the idempotency key when an unchanged draft is retried", async () => {
    const user = userEvent.setup()
    vi.mocked(createTopic)
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce(topic)
    render(
      <TopicComposer
        open
        boards={boards}
        session={session}
        onClose={vi.fn()}
        onPublished={vi.fn()}
      />,
    )

    await user.type(screen.getByRole("textbox", { name: "标题（可选）" }), "发布主题")
    await user.type(screen.getByRole("textbox", { name: "正文" }), "这是正文")
    await user.click(screen.getByRole("button", { name: "发布" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("主题服务暂时不可用")

    await user.click(screen.getByRole("button", { name: "发布" }))

    expect(createTopic).toHaveBeenCalledTimes(2)
    expect(vi.mocked(createTopic).mock.calls[1][1].idempotencyKey)
      .toBe(vi.mocked(createTopic).mock.calls[0][1].idempotencyKey)
  })

  it("uses an in-app confirmation before closing a saved local draft", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <TopicComposer
        open
        boards={boards}
        session={session}
        onClose={onClose}
        onPublished={vi.fn()}
      />,
    )

    await waitFor(() => expect(screen.getByRole("textbox", { name: "正文" })).toHaveFocus())
    const title = screen.getByRole("textbox", { name: "标题（可选）" })
    fireEvent.change(title, { target: { value: "尚未保存的新修改" } })
    const close = screen.getByRole("button", { name: "关闭发布窗口" })
    close.focus()
    fireEvent.click(close)

    const dialog = screen.getByRole("alertdialog", { name: "关闭发布窗口？" })
    expect(onClose).not.toHaveBeenCalled()
    expect(dialog).toHaveTextContent("当前内容已保存为本地草稿")
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "取消" })).toHaveFocus())
    expect(screen.getByRole("dialog", { name: "发布内容" })).toBeInTheDocument()

    await user.keyboard("{Escape}")
    expect(screen.queryByRole("alertdialog", { name: "关闭发布窗口？" })).not.toBeInTheDocument()
    await waitFor(() => expect(close).toHaveFocus())
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.change(title, { target: { value: "第二次未保存修改" } })
    fireEvent.click(close)
    const reopened = screen.getByRole("alertdialog", { name: "关闭发布窗口？" })
    await user.click(within(reopened).getByRole("button", { name: "确认关闭" }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(window.localStorage.getItem(`daoyun:composer-draft:v2:${session.user.id}:global`))
      .toContain("第二次未保存修改")
  })

  it("locks editing while the closing draft is still syncing", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    let finish!: () => void
    vi.mocked(saveDraft).mockImplementation((id, revision, content) => new Promise(resolve => {
      finish = () => resolve({ id, revision: revision + 1, content, updated_at: new Date().toISOString() })
    }))
    render(<TopicComposer open boards={boards} session={session} onClose={onClose} onPublished={vi.fn()} />)
    fireEvent.change(screen.getByRole("textbox", { name: "标题（可选）" }), { target: { value: "等待同步的草稿" } })
    await user.click(screen.getByRole("button", { name: "关闭发布窗口" }))
    await user.click(screen.getByRole("button", { name: "确认关闭" }))
    await waitFor(() => expect(saveDraft).toHaveBeenCalled())
    expect(screen.getByRole("textbox", { name: "标题（可选）" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "关闭发布窗口" })).toBeDisabled()
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => finish())
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it("asks before an Escape key discards edits made after opening", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<TopicComposer open boards={boards} session={session} onClose={onClose} onPublished={vi.fn()} />)

    await user.type(screen.getByRole("textbox", { name: "正文" }), "不能直接丢弃的正文")
    fireEvent.keyDown(document, { key: "Escape" })

    const confirmation = screen.getByRole("alertdialog", { name: "关闭发布窗口？" })
    expect(confirmation).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    await user.click(within(confirmation).getByRole("button", { name: "取消" }))
  })

  it("traps focus, locks background scrolling and restores the opener", async () => {
    const user = userEvent.setup()
    const opener = document.createElement("button")
    opener.textContent = "打开发布窗口"
    document.body.append(opener)
    opener.focus()
    const view = render(
      <TopicComposer
        open
        boards={boards}
        session={session}
        onClose={vi.fn()}
        onPublished={vi.fn()}
      />,
    )

    await waitFor(() => expect(screen.getByRole("textbox", { name: "正文" })).toHaveFocus())
    expect(document.body.style.overflow).toBe("hidden")

    screen.getByRole("button", { name: "发布" }).focus()
    await user.tab()
    expect(screen.getByRole("button", { name: "关闭发布窗口" })).toHaveFocus()

    await user.tab({ shift: true })
    expect(screen.getByRole("button", { name: "发布" })).toHaveFocus()

    view.rerender(
      <TopicComposer
        open={false}
        boards={boards}
        session={session}
        onClose={vi.fn()}
        onPublished={vi.fn()}
      />,
    )
    expect(document.body.style.overflow).toBe("")
    expect(opener).toHaveFocus()
    opener.remove()
  })
})

it("does not publish or clear text when server draft sync fails",async()=>{
 const user=userEvent.setup();vi.mocked(saveDraft).mockRejectedValue(new Error("草稿服务离线"));
 render(<TopicComposer open boards={boards} session={session} onClose={vi.fn()} onPublished={vi.fn()} />)
 await user.type(screen.getByRole("textbox",{name:"正文"}),"不能丢失的正文");await user.click(screen.getByRole("button",{name:"发布"}));
 await waitFor(()=>expect(saveDraft).toHaveBeenCalled());expect(createTopic).not.toHaveBeenCalled();expect(screen.getByRole("textbox",{name:"正文"})).toHaveTextContent("不能丢失的正文")
})

it("synchronizes poll configuration with the draft and publishes it atomically",async()=>{
 vi.mocked(getPollPolicy).mockResolvedValue({enabled:true,can_create:true});vi.mocked(createTopic).mockResolvedValue(topic);
 render(<TopicComposer open boards={boards} session={session} onClose={vi.fn()} onPublished={vi.fn()} />)
 fireEvent.click(await screen.findByRole("button",{name:"添加单选投票"}));
 fireEvent.change(screen.getByRole("textbox",{name:"投票问题"}),{target:{value:"你更喜欢哪个？"}});
 fireEvent.change(screen.getByRole("textbox",{name:"选项 1"}),{target:{value:"甲"}});fireEvent.change(screen.getByRole("textbox",{name:"选项 2"}),{target:{value:"乙"}});
 await userEvent.type(screen.getByRole("textbox",{name:"正文"}),"一起投票");fireEvent.click(screen.getByRole("button",{name:"发布"}));
 await waitFor(()=>expect(createTopic).toHaveBeenCalledWith(expect.objectContaining({poll:expect.objectContaining({question:"你更喜欢哪个？",options:["甲","乙"]}),draft:expect.objectContaining({revision:1})}),expect.anything()));
 expect(vi.mocked(saveDraft).mock.calls[0][2].poll?.question).toBe("你更喜欢哪个？")
})


it("keeps unsaved text open when browser storage and cloud saving both fail", async () => {
  const user = userEvent.setup()
  const onClose = vi.fn()
  vi.mocked(saveDraft).mockRejectedValue(new Error("云端保存失败"))
  const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("空间不足", "QuotaExceededError") })
  try {
    render(<TopicComposer open boards={boards} session={session} onClose={onClose} onPublished={vi.fn()} />)
    await user.type(screen.getByRole("textbox", { name: "正文" }), "只存在编辑器中的重要正文")
    await user.click(screen.getByRole("button", { name: "关闭发布窗口" }))
    const dialog = screen.getByRole("alertdialog", { name: "关闭发布窗口？" })
    expect(dialog).not.toHaveTextContent("当前内容已保存为本地草稿")
    expect(dialog).toHaveTextContent("本机保存失败")
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "取消" })).toHaveFocus())
    await user.click(within(dialog).getByRole("button", { name: "确认关闭" }))
    await waitFor(() => expect(saveDraft).toHaveBeenCalled())
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole("textbox", { name: "正文" })).toHaveTextContent("只存在编辑器中的重要正文")
    expect(await screen.findByText("本机和云端均未保存，请继续编辑、重试或复制正文。" )).toBeInTheDocument()
  } finally { storage.mockRestore() }
})

it("shows a failed local save separately from a successful cloud save", async () => {
  const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("空间不足", "QuotaExceededError") })
  try {
    render(<TopicComposer open boards={boards} session={session} onClose={vi.fn()} onPublished={vi.fn()} />)
    await userEvent.type(screen.getByRole("textbox", { name: "正文" }), "云端保留的正文")
    expect(await screen.findByText(/本机保存失败/)).toBeInTheDocument()
    expect(await screen.findByText("已同步到草稿箱")).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "正文" })).toHaveTextContent("云端保留的正文")
  } finally { storage.mockRestore() }
})


it("restores an uncertain publication with its original payload and idempotency key", async () => {
  const user = userEvent.setup()
  vi.mocked(createTopic).mockRejectedValueOnce(new Error("accepted but response lost")).mockResolvedValueOnce(topic)
  const props = { open: true, boards, session, onClose: vi.fn(), onPublished: vi.fn() }
  const view = render(<TopicComposer {...props} />)
  await user.type(screen.getByRole("textbox", { name: "正文" }), "服务端已接受的正文")
  await user.click(screen.getByRole("button", { name: "发布" }))
  await screen.findByText(/发布结果尚未确认/)
  const first = vi.mocked(createTopic).mock.calls[0]
  await user.click(screen.getByRole("button", { name: "关闭发布窗口" }))
  await user.click(screen.getByRole("button", { name: "确认关闭" }))
  await waitFor(() => expect(props.onClose).toHaveBeenCalled())
  view.unmount()
  render(<TopicComposer {...props} />)
  expect(await screen.findByText(/发布结果尚未确认/)).toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "发布" }))
  await waitFor(() => expect(props.onPublished).toHaveBeenCalledWith(topic))
  expect(vi.mocked(createTopic).mock.calls[1][0]).toEqual(first[0])
  expect(vi.mocked(createTopic).mock.calls[1][1].idempotencyKey).toBe(first[1].idempotencyKey)
})

it("provides selectable text when clipboard access is unavailable", async () => {
  const user = userEvent.setup()
  const clipboard = vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new DOMException("denied", "NotAllowedError"))
  try {
    render(<TopicComposer open boards={boards} session={null} onClose={vi.fn()} onPublished={vi.fn()} />)
    await user.type(screen.getByRole("textbox", { name: "正文" }), "可手动复制的正文")
    await user.click(screen.getByRole("button", { name: "复制正文" }))
    const fallback = await screen.findByRole("textbox", { name: "手动复制正文" })
    expect(fallback).toHaveValue("可手动复制的正文")
    expect(fallback).toHaveFocus()
  } finally { clipboard.mockRestore() }
})


it("keeps newer edits as a draft after confirming an older uncertain publication", async () => {
  const user = userEvent.setup()
  vi.mocked(createTopic).mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce(topic)
  const onPublished = vi.fn()
  render(<TopicComposer open boards={boards} session={session} onClose={vi.fn()} onPublished={onPublished} />)
  await user.type(screen.getByRole("textbox", { name: "正文" }), "原请求正文")
  await user.click(screen.getByRole("button", { name: "发布" }))
  await screen.findByText(/发布结果尚未确认/)
  const first = vi.mocked(createTopic).mock.calls[0]
  await user.type(screen.getByRole("textbox", { name: "标题（可选）" }), "确认期间的新草稿")
  await user.click(screen.getByRole("button", { name: "发布" }))
  await waitFor(() => expect(onPublished).toHaveBeenCalledWith(topic))
  expect(vi.mocked(createTopic).mock.calls[1][0]).toEqual(first[0])
  expect(localStorage.getItem("daoyun:composer-draft:v2:" + session.user.id + ":global")).toContain("确认期间的新草稿")
})


it("does not overwrite a newer cloud draft with an older local recovery copy", async () => {
  const id = "019fc800-0000-7000-8000-000000000777"
  const key = "daoyun:composer-draft:v2:" + session.user.id + ":global"
  const cloudContent = { title: "云端新正文", board_id: boards[0].id, rich_content: { type: "doc" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: "云端新正文" }] }] }, images: [], poll: null }
  localStorage.setItem(key, JSON.stringify({ version: 2, title: "本机旧正文", boardId: boards[0].id, richContent: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "本机旧正文" }] }] }, images: [], savedAt: new Date().toISOString() }))
  localStorage.setItem(key + ":server:" + session.user.id, JSON.stringify({ id, revision: 2 }))
  vi.mocked(getDraft).mockResolvedValue({ id, revision: 2, content: cloudContent, updated_at: new Date().toISOString() })
  render(<TopicComposer open boards={boards} session={session} onClose={vi.fn()} onPublished={vi.fn()} />)
  expect(await screen.findByText("本机与云端内容不同，请选择服务器版或另存本机副本。" )).toBeInTheDocument()
  expect(saveDraft).not.toHaveBeenCalled()
  expect(screen.getByRole("textbox", { name: "正文" })).toHaveTextContent("本机旧正文")
  await userEvent.click(screen.getByRole("button", { name: "保留本地副本并读取服务器版" }))
  await waitFor(() => expect(screen.getByRole("textbox", { name: "正文" })).toHaveTextContent("云端新正文"))
  expect(saveDraft).not.toHaveBeenCalled()
})

it("restores the referenced cloud draft when no local body exists", async () => {
  const id = "019fc800-0000-7000-8000-000000000778"
  const key = "daoyun:composer-draft:v2:" + session.user.id + ":global"
  localStorage.setItem(key + ":server:" + session.user.id, JSON.stringify({ id, revision: 3 }))
  const cloudContent = { title: "仅云端保存", board_id: boards[0].id, rich_content: { type: "doc" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: "仅云端正文" }] }] }, images: [], poll: null }
  vi.mocked(getDraft).mockResolvedValue({ id, revision: 3, content: cloudContent, updated_at: new Date().toISOString() })
  render(<TopicComposer open boards={boards} session={session} onClose={vi.fn()} onPublished={vi.fn()} />)
  await waitFor(() => expect(screen.getByRole("textbox", { name: "正文" })).toHaveTextContent("仅云端正文"))
  expect(saveDraft).not.toHaveBeenCalled()
})


it("retains an uncertain request even when all visible draft text is cleared", async () => {
  const user = userEvent.setup()
  vi.mocked(createTopic).mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce(topic)
  const props = { open: true, boards, session, onClose: vi.fn(), onPublished: vi.fn() }
  const view = render(<TopicComposer {...props} />)
  await user.type(screen.getByRole("textbox", { name: "正文" }), "已经提交的原正文")
  await user.click(screen.getByRole("button", { name: "发布" }))
  await screen.findByText(/发布结果尚未确认/)
  const first = vi.mocked(createTopic).mock.calls[0]
  await user.clear(screen.getByRole("textbox", { name: "正文" }))
  await user.click(screen.getByRole("button", { name: "关闭发布窗口" }))
  expect(screen.getByRole("alertdialog", { name: "关闭发布窗口？" })).toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "确认关闭" }))
  await waitFor(() => expect(props.onClose).toHaveBeenCalled())
  view.unmount()
  render(<TopicComposer {...props} />)
  await screen.findByText(/发布结果尚未确认/)
  await user.click(screen.getByRole("button", { name: "发布" }))
  await waitFor(() => expect(props.onPublished).toHaveBeenCalledWith(topic))
  expect(vi.mocked(createTopic).mock.calls[1][0]).toEqual(first[0])
  expect(vi.mocked(createTopic).mock.calls[1][1].idempotencyKey).toBe(first[1].idempotencyKey)
})

it("locks publication before awaiting the draft flush", async () => {
  vi.mocked(saveDraft).mockReturnValue(new Promise(() => undefined))
  vi.mocked(createTopic).mockReturnValue(new Promise(() => undefined))
  render(<TopicComposer open boards={boards} session={session} onClose={vi.fn()} onPublished={vi.fn()} />)
  await userEvent.type(screen.getByRole("textbox", { name: "正文" }), "没有标题的一次发布")
  await waitFor(() => expect(screen.getByRole("button", { name: "发布" })).toBeEnabled())
  const form = screen.getByRole("button", { name: "发布" }).closest("form")!
  act(() => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) })
  await waitFor(() => expect(saveDraft).toHaveBeenCalled())
  expect(saveDraft).toHaveBeenCalledTimes(1)
})

// AC-X-16: source-derived V2 fixtures exercise the current recovery and publication behavior.
it("publishes a restored old V2 draft without truncating its long body or losing images", async () => {
  const key = "daoyun:composer-draft:v2:" + session.user.id + ":global"
  const body = "旧格式长正文与中文内容。".repeat(128) + "旧稿结尾保留"
  const richContent = plainTextDocument(body)
  const attachmentId = "019fc800-0000-7000-8000-000000000209"
  localStorage.setItem(key, JSON.stringify({ version: 2, title: "旧格式标题", richContent,
    boardId: boards[0].id, images: [{ attachmentId, fileName: "旧稿图片.jpg" }], poll: null,
    savedAt: new Date().toISOString() }))
  vi.mocked(createTopic).mockResolvedValue(topic)
  const onPublished = vi.fn()
  render(<TopicComposer open boards={boards} session={session} onClose={vi.fn()} onPublished={onPublished} />)
  await waitFor(() => expect(screen.getByRole("textbox", { name: "正文" }).textContent).toBe(body))
  expect(screen.getByRole("img", { name: "旧稿图片.jpg" })).toBeInTheDocument()
  fireEvent.change(screen.getByRole("textbox", { name: "标题（可选）" }), { target: { value: "升级后编辑的标题" } })
  await waitFor(() => {
    const saved = JSON.parse(localStorage.getItem(key) ?? "null")
    expect(saved.title).toBe("升级后编辑的标题")
    expect(saved.richContent).toEqual(richContent)
  })
  await userEvent.click(screen.getByRole("button", { name: "发布" }))
  await waitFor(() => expect(onPublished).toHaveBeenCalledWith(topic))
  const input = vi.mocked(createTopic).mock.calls[0][0]
  expect(input.content).toBe(body)
  expect(input.title).toBe("升级后编辑的标题")
  expect(toPlainText(input.richContent!)).toBe(body)
  expect(input.richContent!.content).toContainEqual({ type: "image", attrs: { attachmentId, alt: "旧稿图片.jpg" } })
})

it("restores a new V2 pending publication and preserves newer edits while retrying its entire original request", async () => {
  const key = "daoyun:composer-draft:v2:" + session.user.id + ":global"
  const body = "新格式待确认发布的完整正文。".repeat(128) + "原请求末尾"
  const richContent = plainTextDocument(body)
  const draft = { title: "原请求标题", richContent, images: [], boardId: boards[0].id, poll: null }
  const input = { title: draft.title, content: body, richContent, boardId: boards[0].id }
  const idempotencyKey = "pending-v2-direct-audit"
  localStorage.setItem(key, JSON.stringify({ version: 2, ...draft, savedAt: new Date().toISOString(),
    publication: { idempotencyKey, input, draftSnapshot: JSON.stringify(draft) } }))
  vi.mocked(createTopic).mockResolvedValue(topic)
  const onPublished = vi.fn()
  render(<TopicComposer open boards={boards} session={session} onClose={vi.fn()} onPublished={onPublished} />)
  await screen.findByText(/发布结果尚未确认/)
  expect(screen.getByRole("textbox", { name: "正文" }).textContent).toBe(body)
  fireEvent.change(screen.getByRole("textbox", { name: "标题（可选）" }), { target: { value: "保留为新草稿" } })
  await userEvent.click(screen.getByRole("button", { name: "发布" }))
  await waitFor(() => expect(onPublished).toHaveBeenCalledWith(topic))
  expect(createTopic).toHaveBeenCalledTimes(1)
  expect(vi.mocked(createTopic).mock.calls[0][0]).toEqual(input)
  expect(vi.mocked(createTopic).mock.calls[0][1].idempotencyKey).toBe(idempotencyKey)
  const saved = JSON.parse(localStorage.getItem(key) ?? "null")
  expect(saved.title).toBe("保留为新草稿")
  expect(saved.richContent).toEqual(richContent)
  expect(saved.publication).toBeNull()
})

it("preserves complete cloud content when an old local draft and a current server draft coexist", async () => {
  const key = "daoyun:composer-draft:v2:" + session.user.id + ":global"
  const id = "019fc800-0000-7000-8000-000000000779"
  const localBody = "本机旧草稿正文。".repeat(128) + "本机末尾"
  const cloudBody = "云端新草稿完整正文。".repeat(128) + "云端末尾"
  const cloudDocument = plainTextDocument(cloudBody)
  localStorage.setItem(key, JSON.stringify({ version: 2, title: "本机旧稿", boardId: boards[0].id,
    richContent: plainTextDocument(localBody), images: [], savedAt: new Date().toISOString() }))
  localStorage.setItem(key + ":server:" + session.user.id, JSON.stringify({ id, revision: 7 }))
  vi.mocked(getDraft).mockResolvedValue({ id, revision: 7, updated_at: new Date().toISOString(),
    content: { title: "云端新稿", board_id: boards[0].id, rich_content: cloudDocument, images: [], poll: null } })
  vi.mocked(createTopic).mockResolvedValue(topic)
  const onPublished = vi.fn()
  render(<TopicComposer open boards={boards} session={session} onClose={vi.fn()} onPublished={onPublished} />)
  await screen.findByText("本机与云端内容不同，请选择服务器版或另存本机副本。")
  expect(screen.getByRole("textbox", { name: "正文" }).textContent).toBe(localBody)
  expect(saveDraft).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole("button", { name: "保留本地副本并读取服务器版" }))
  await waitFor(() => expect(screen.getByRole("textbox", { name: "正文" }).textContent).toBe(cloudBody))
  expect(JSON.parse(localStorage.getItem(key) ?? "null").richContent).toEqual(cloudDocument)
  const recovery = JSON.parse(localStorage.getItem(key + ":server:" + session.user.id + ":recovery") ?? "null")
  expect(toPlainText(recovery.rich_content)).toBe(localBody)
  expect(saveDraft).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole("button", { name: "发布" }))
  await waitFor(() => expect(onPublished).toHaveBeenCalledWith(topic))
  const input = vi.mocked(createTopic).mock.calls[0][0]
  expect(input.content).toBe(cloudBody)
  expect(toPlainText(input.richContent!)).toBe(cloudBody)
})
