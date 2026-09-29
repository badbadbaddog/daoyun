import {getPollPolicy} from "../api/polls"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { act } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { saveDraft } from "../api/drafts"
import { createTopic } from "../api/topics"
import { uploadDraftImage } from "../api/attachments"
import type { AuthSession } from "../api/auth"
import type { Board, Topic } from "../types/community"
import { TopicComposer } from "./TopicComposer"

vi.mock("../api/topics", async () => {
  const actual = await vi.importActual<typeof import("../api/topics")>("../api/topics")
  return { ...actual, createTopic: vi.fn() }
})

vi.mock("../api/polls",async()=>({...await vi.importActual<typeof import("../api/polls")>("../api/polls"),getPollPolicy:vi.fn()}))
vi.mock("../api/drafts",()=>({saveDraft:vi.fn(),listDrafts:vi.fn(),getDraft:vi.fn(),deleteDraft:vi.fn(),DraftApiError:class extends Error{}}))
vi.mock("../api/attachments", () => ({ uploadDraftImage: vi.fn() }))

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

beforeEach(() => {
  vi.mocked(getPollPolicy).mockResolvedValue({enabled:false,can_create:false})
  vi.mocked(saveDraft).mockReset().mockImplementation(async(id,revision,content)=>({id,revision:revision+1,content,updated_at:new Date().toISOString()}))
  vi.mocked(createTopic).mockReset()
  vi.mocked(uploadDraftImage).mockReset()
  window.localStorage.clear()
})

afterEach(() => cleanup())

describe("TopicComposer", () => {
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

    fireEvent.change(screen.getByLabelText("选择帖子图片"), { target: { files } })
    await screen.findByRole("img", { name: "third.jpg" })
    fireEvent.keyDown(screen.getByRole("button", { name: "排序图片 1" }), { key: "ArrowRight" })
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
