import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"

import { RichTextContent } from "./RichTextContent"

afterEach(cleanup)

describe("RichTextContent", () => {
  it("renders supported JSON without interpreting text as HTML", () => {
    render(<RichTextContent document={{
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "说明" }] },
        {
          type: "paragraph",
          content: [{
            type: "text",
            text: "<img src=x onerror=alert(1)>",
            marks: [{ type: "bold" }],
          }],
        },
        {
          type: "paragraph",
          content: [{
            type: "text",
            text: "安全链接",
            marks: [{ type: "link", attrs: { href: "https://example.com" } }],
          }],
        },
      ],
    }} />)

    expect(screen.getByRole("heading", { level: 2, name: "说明" })).toBeInTheDocument()
    expect(screen.getByText("<img src=x onerror=alert(1)>").closest("strong")).not.toBeNull()
    expect(document.querySelector("img")).toBeNull()
    expect(screen.getByRole("link", { name: "安全链接" })).toHaveAttribute("rel", "noopener noreferrer")
  })

  it("does not render unsafe links", () => {
    render(<RichTextContent document={{
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{
          type: "text",
          text: "危险链接",
          marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
        }],
      }],
    }} />)

    expect(screen.queryByRole("link")).toBeNull()
    expect(screen.getByText("危险链接")).toBeInTheDocument()
  })

  it("highlights valid mentions and renders locked reply gates without hidden text", () => {
    render(<RichTextContent document={{
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "回复 @member，也保留 @ab 和 <img onerror=alert(1)>" }],
        },
        { type: "replyGate", attrs: { locked: true } },
      ],
    }} />)

    expect(screen.getByRole("link", { name: "@member" })).toHaveAttribute("href", "#user/member")
    expect(screen.queryByRole("link", { name: "@ab" })).toBeNull()
    expect(screen.getByText("回复主题后可见")).toBeInTheDocument()
    expect(document.querySelector("img")).toBeNull()
  })

  it("highlights adjacent hashtags without changing their text", () => {
    render(<RichTextContent document={{
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{ type: "text", text: "讨论 #我是标签#例子标签" }],
      }],
    }} />)

    const hashtags = Array.from(document.querySelectorAll(".rich-text-hashtag"))
    expect(hashtags.map((element) => element.textContent)).toEqual(["#我是标签", "#例子标签"])
  })

  it("renders only server-owned attachment images", () => {
    render(<RichTextContent document={{
      type: "doc",
      content: [
        { type: "image", attrs: { attachmentId: "0198d874-e991-7b62-8b38-3986f55c8d3d", alt: "路线图" } },
        { type: "image", attrs: { attachmentId: "javascript:alert(1)", alt: "危险" } },
      ],
    }} />)

    expect(screen.getByRole("img", { name: "路线图" })).toHaveAttribute(
      "src",
      "/api/v1/attachments/0198d874-e991-7b62-8b38-3986f55c8d3d/thumbnail",
    )
    expect(screen.queryByRole("img", { name: "危险" })).toBeNull()
  })

  it("renders validated image dimensions responsively", () => {
    render(<RichTextContent document={{
      type: "doc",
      content: [{
        type: "image",
        attrs: {
          attachmentId: "0198d874-e991-7b62-8b38-3986f55c8d3d",
          alt: "缩放结果",
          width: 640,
          height: 360,
        },
      }],
    }} />)

    expect(screen.getByRole("img", { name: "缩放结果" })).toHaveAttribute("width", "640")
    expect(screen.getByRole("img", { name: "缩放结果" })).toHaveAttribute("height", "360")
  })

  it("renders consecutive post images as a five-item strip with the remaining count", () => {
    const attachmentIds = [
      "0198d874-e991-7b62-8b38-3986f55c8d31",
      "0198d874-e991-7b62-8b38-3986f55c8d32",
      "0198d874-e991-7b62-8b38-3986f55c8d33",
      "0198d874-e991-7b62-8b38-3986f55c8d34",
      "0198d874-e991-7b62-8b38-3986f55c8d35",
      "0198d874-e991-7b62-8b38-3986f55c8d36",
      "0198d874-e991-7b62-8b38-3986f55c8d37",
    ]

    render(<RichTextContent imageLayout="strip" document={{
      type: "doc",
      content: attachmentIds.map((attachmentId, index) => ({
        type: "image",
        attrs: { attachmentId, alt: `图片 ${index + 1}` },
      })),
    }} />)

    const gallery = screen.getByRole("group", { name: "帖子图片，共 7 张" })
    expect(within(gallery).getAllByRole("img")).toHaveLength(5)
    expect(within(gallery).getByText("+2")).toBeInTheDocument()
    expect(screen.queryByRole("img", { name: "图片 6" })).toBeNull()
  })

  it("keeps inline image rendering outside topic image strips", () => {
    render(<RichTextContent document={{
      type: "doc",
      content: [
        { type: "image", attrs: { attachmentId: "0198d874-e991-7b62-8b38-3986f55c8d31", alt: "图片 1" } },
        { type: "image", attrs: { attachmentId: "0198d874-e991-7b62-8b38-3986f55c8d32", alt: "图片 2" } },
      ],
    }} />)

    expect(screen.queryByRole("group", { name: /帖子图片/ })).toBeNull()
    expect(screen.getAllByRole("img")).toHaveLength(2)
  })
  it.each(["inline", "strip"] as const)("opens %s images and restores focus after closing", async (imageLayout) => {
    const user = userEvent.setup()
    render(<RichTextContent imageLayout={imageLayout} document={{
      type: "doc",
      content: [{ type: "image", attrs: { attachmentId: "0198d874-e991-7b62-8b38-3986f55c8d31", alt: "路线图" } }],
    }} />)

    await user.click(screen.getByRole("img", { name: "路线图" }))
    const dialog = screen.getByRole("dialog", { name: "图片预览" })
    expect(within(dialog).getByRole("img", { name: "路线图" })).toHaveAttribute(
      "src", "/api/v1/attachments/0198d874-e991-7b62-8b38-3986f55c8d31",
    )
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(screen.getByRole("button", { name: "预览图片：路线图" })).toHaveFocus()
    await user.keyboard("{Enter}")
    await user.click(screen.getByRole("button", { name: "关闭图片预览" }))
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("previews all strip images including those behind the remaining count", async () => {
    const user = userEvent.setup()
    render(<RichTextContent imageLayout="strip" document={{
      type: "doc",
      content: Array.from({ length: 7 }, (_, index) => ({
        type: "image",
        attrs: { attachmentId: `0198d874-e991-7b62-8b38-3986f55c8d3${index + 1}`, alt: `图片 ${index + 1}` },
      })),
    }} />)

    await user.click(screen.getByText("+2"))
    const dialog = screen.getByRole("dialog", { name: "图片预览" })
    expect(within(dialog).getByRole("img", { name: "图片 5" })).toBeInTheDocument()
    await user.click(within(dialog).getByRole("button", { name: "下一张" }))
    expect(within(dialog).getByRole("img", { name: "图片 6" })).toBeInTheDocument()
    await user.keyboard("{ArrowRight}")
    expect(within(dialog).getByRole("img", { name: "图片 7" })).toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: "下一张" })).toBeDisabled()
    await user.keyboard("{ArrowLeft}")
    expect(within(dialog).getByRole("img", { name: "图片 6" })).toBeInTheDocument()
    fireEvent.error(within(dialog).getByRole("img"))
    expect(within(dialog).getByRole("alert")).toHaveTextContent("图片加载失败")
    await user.click(within(dialog).getByRole("button", { name: "上一张" }))
    expect(within(dialog).queryByRole("alert")).toBeNull()
    fireEvent.mouseDown(dialog.parentElement!)
    expect(screen.queryByRole("dialog")).toBeNull()
  })

})
