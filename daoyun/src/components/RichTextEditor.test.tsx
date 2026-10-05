import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { plainTextDocument } from "../editor/richContent"
import { RichTextEditor } from "./RichTextEditor"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("RichTextEditor", () => {
  it.each(["autoFocus", "disabled", "dialog"])("keeps recovery focus when queued autofocus loses %s permission", async reason => {
    const frames = new Map<number, FrameRequestCallback>()
    let nextFrame = 0
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback)
      return nextFrame
    })
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id))
    const props = {
      value: plainTextDocument("会话中的正文"), onChange: vi.fn(), ariaLabel: "正文",
      placeholder: "输入正文", maxCharacters: 1_000,
    }
    const view = render(<><RichTextEditor {...props} autoFocus /><button>重新登录</button></>)
    await screen.findByRole("textbox", { name: "正文" })
    await waitFor(() => expect(frames.size).toBeGreaterThan(0))
    view.rerender(<>
      <RichTextEditor {...props} autoFocus={reason !== "autoFocus"} disabled={reason === "disabled"} />
      <div role={reason === "dialog" ? "alertdialog" : undefined} aria-modal={reason === "dialog" ? "true" : undefined}>
        <button>重新登录</button>
      </div>
    </>)
    const recovery = screen.getByRole("button", { name: "重新登录" })
    recovery.focus()
    await act(async () => {
      const pending = [...frames.values()]
      frames.clear()
      pending.forEach(callback => callback(performance.now()))
    })
    expect(recovery).toHaveFocus()
    expect(screen.getByRole("textbox", { name: "正文" })).toHaveTextContent("会话中的正文")
  })

  it("highlights hashtags while keeping them as plain rich-text content", async () => {
    render(
      <RichTextEditor
        value={plainTextDocument("讨论 #我是标签#例子标签")}
        onChange={vi.fn()}
        ariaLabel="正文"
        placeholder="输入正文"
        maxCharacters={1_000}
      />,
    )

    await waitFor(() => expect(
      Array.from(document.querySelectorAll(".rich-text-hashtag")).map((element) => element.textContent),
    ).toEqual(["#我是标签", "#例子标签"]))
  })

  it("wraps the current block as reply-visible content", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <RichTextEditor
        value={plainTextDocument("隐藏答案")}
        onChange={onChange}
        ariaLabel="正文"
        placeholder="输入正文"
        maxCharacters={1_000}
      />,
    )

    await user.click(screen.getByRole("textbox", { name: "正文" }))
    await user.click(screen.getByRole("button", { name: "回复可见" }))

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.arrayContaining([expect.objectContaining({
          type: "replyGate",
          content: expect.arrayContaining([expect.objectContaining({ type: "paragraph" })]),
        })]),
      }),
      "隐藏答案",
    ))
  })

  it("shows resize handles for an existing attachment image", () => {
    render(
      <RichTextEditor
        value={{
          type: "doc",
          content: [{
            type: "image",
            attrs: {
              attachmentId: "0198d874-e991-7b62-8b38-3986f55c8d3d",
              alt: "可缩放图片",
              width: 640,
              height: 360,
            },
          }],
        }}
        onChange={vi.fn()}
        ariaLabel="正文"
        placeholder="输入正文"
        maxCharacters={1_000}
      />,
    )

    expect(document.querySelector("[data-resize-container][data-node='image']")).not.toBeNull()
    expect(document.querySelectorAll("[data-resize-handle]")).toHaveLength(4)
  })

  it("explains unsafe links and enables only a supported address", async () => {
    const user = userEvent.setup()
    render(
      <RichTextEditor
        value={plainTextDocument("链接文本")}
        onChange={vi.fn()}
        ariaLabel="正文"
        placeholder="输入正文"
        maxCharacters={1_000}
      />,
    )

    await user.click(screen.getByRole("button", { name: "添加或编辑链接" }))
    const input = screen.getByRole("textbox", { name: "链接地址" })
    const applyButton = screen.getByRole("button", { name: "应用" })

    await user.type(input, "javascript:alert(1)")
    expect(input).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByText("仅支持 http、https 或站内链接")).toBeInTheDocument()
    expect(applyButton).toBeDisabled()

    await user.clear(input)
    await user.type(input, "example.com")
    expect(input).not.toHaveAttribute("aria-invalid", "true")
    expect(applyButton).toBeEnabled()
  })

  it("connects and clears the editor error state", () => {
    const props = {
      value: plainTextDocument("正文"),
      onChange: vi.fn(),
      ariaLabel: "正文",
      placeholder: "输入正文",
      maxCharacters: 1_000,
    }
    const view = render(<RichTextEditor {...props} invalid errorMessageId="body-error" />)

    expect(screen.getByRole("textbox", { name: "正文" }))
      .toHaveAttribute("aria-describedby", "body-error")
    expect(screen.getByRole("textbox", { name: "正文" }))
      .toHaveAttribute("aria-invalid", "true")

    view.rerender(<RichTextEditor {...props} />)
    expect(screen.getByRole("textbox", { name: "正文" })).not.toHaveAttribute("aria-describedby")
    expect(screen.getByRole("textbox", { name: "正文" })).not.toHaveAttribute("aria-invalid")
  })

  it("uploads a selected image and stores only its attachment identity", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const onImageUpload = vi.fn().mockResolvedValue({
      id: "0198d874-e991-7b62-8b38-3986f55c8d3d",
    })
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:http://localhost/preview"),
      revokeObjectURL: vi.fn(),
    })
    render(
      <RichTextEditor
        value={plainTextDocument("正文")}
        onChange={onChange}
        onImageUpload={onImageUpload}
        ariaLabel="正文"
        placeholder="输入正文"
        maxCharacters={1_000}
      />,
    )

    await user.click(screen.getByRole("button", { name: "上传图片" }))
    const file = new File(["image"], "示意图.png", { type: "image/png" })
    await user.upload(screen.getByLabelText("选择正文图片"), file)

    await waitFor(() => expect(onImageUpload).toHaveBeenCalledWith(
      file,
      expect.any(Function),
      expect.any(AbortSignal),
    ))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.arrayContaining([
          expect.objectContaining({
            type: "image",
            attrs: {
              attachmentId: "0198d874-e991-7b62-8b38-3986f55c8d3d",
              alt: "示意图.png",
            },
          }),
        ]),
      }),
      "正文",
    ))
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument())
    expect(screen.getByRole("button", { name: "上传图片" })).toBeEnabled()
  })

  it("keeps the selected file available until the upload request settles", async () => {
    const user = userEvent.setup()
    let resolveUpload: ((attachment: { id: string }) => void) | undefined
    const onImageUpload = vi.fn(() => new Promise<{ id: string }>((resolve) => {
      resolveUpload = resolve
    }))
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:http://localhost/preview"),
      revokeObjectURL: vi.fn(),
    })
    render(
      <RichTextEditor
        value={plainTextDocument("正文")}
        onChange={vi.fn()}
        onImageUpload={onImageUpload}
        ariaLabel="正文"
        placeholder="输入正文"
        maxCharacters={1_000}
      />,
    )
    const input = screen.getByLabelText("选择正文图片") as HTMLInputElement
    const file = new File(["image"], "示意图.jpg", { type: "image/jpeg" })

    await user.upload(input, file)

    expect(input.files).toHaveLength(1)

    act(() => resolveUpload?.({ id: "0198d874-e991-7b62-8b38-3986f55c8d3d" }))
    await waitFor(() => expect(input.files).toHaveLength(0))
  })


  it("rejects a tenth image including images inside a reply gate", async () => {
    const user=userEvent.setup()
    const onImageUpload=vi.fn().mockResolvedValue({id:"0198d874-e991-7b62-8b38-3986f55c8d3d"})
    render(<RichTextEditor value={{type:"doc",content:[{type:"replyGate",content:Array.from({length:9},()=>({type:"image",attrs:{attachmentId:"0198d874-e991-7b62-8b38-3986f55c8d3d",alt:"已上传图片"}}))}]}} onChange={vi.fn()} onImageUpload={onImageUpload} ariaLabel="正文" placeholder="输入正文" maxCharacters={1000} />)
    await user.upload(screen.getByLabelText("选择正文图片"),new File(["image"],"tenth.png",{type:"image/png"}))
    expect(onImageUpload).not.toHaveBeenCalled()
    expect(await screen.findByText("每篇内容最多插入 9 张图片")).toBeInTheDocument()
  })

  it("cancels an unfinished upload when the editor closes", async () => {
    const user = userEvent.setup()
    let uploadSignal: AbortSignal | undefined
    const onImageUpload = vi.fn((_file, _onProgress, signal: AbortSignal) => {
      uploadSignal = signal
      return new Promise<{ id: string }>(() => undefined)
    })
    const view = render(
      <RichTextEditor
        value={plainTextDocument("正文")}
        onChange={vi.fn()}
        onImageUpload={onImageUpload}
        ariaLabel="正文"
        placeholder="输入正文"
        maxCharacters={1_000}
      />,
    )

    await user.upload(
      screen.getByLabelText("选择正文图片"),
      new File(["image"], "示意图.png", { type: "image/png" }),
    )
    await waitFor(() => expect(uploadSignal).toBeDefined())
    view.unmount()

    expect(uploadSignal?.aborted).toBe(true)
  })

  it("uses indeterminate and processing labels when byte progress is unavailable", async () => {
    const user = userEvent.setup()
    let reportProgress: ((percent: number) => void) | undefined
    const onImageUpload = vi.fn((_file, onProgress: (percent: number) => void) => {
      reportProgress = onProgress
      return new Promise<{ id: string }>(() => undefined)
    })
    render(
      <RichTextEditor
        value={plainTextDocument("正文")}
        onChange={vi.fn()}
        onImageUpload={onImageUpload}
        ariaLabel="正文"
        placeholder="输入正文"
        maxCharacters={1_000}
      />,
    )

    await user.upload(
      screen.getByLabelText("选择正文图片"),
      new File(["image"], "小图.png", { type: "image/png" }),
    )

    expect(await screen.findByText("正在上传图片，请稍候")).toBeInTheDocument()
    expect(screen.queryByText("图片上传中 0%")).not.toBeInTheDocument()

    act(() => reportProgress?.(99))
    expect(screen.getByText("图片已上传，正在处理")).toBeInTheDocument()
  })
})

it("does not autofocus again after a completed focus and temporary disable", async () => {
  const props = { value: plainTextDocument("正文"), onChange: vi.fn(), ariaLabel: "正文", placeholder: "正文", maxCharacters: 1000, autoFocus: true }
  const view = render(<><RichTextEditor {...props} /><input aria-label="标题" /></>)
  await waitFor(() => expect(screen.getByRole("textbox", { name: "正文" })).toHaveFocus())
  view.rerender(<><RichTextEditor {...props} disabled /><input aria-label="标题" /></>)
  const title = screen.getByRole("textbox", { name: "标题" })
  title.focus()
  view.rerender(<><RichTextEditor {...props} /><input aria-label="标题" /></>)
  await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)) })
  expect(title).toHaveFocus()
})
