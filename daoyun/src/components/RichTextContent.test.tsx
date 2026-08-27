import { cleanup, render, screen } from "@testing-library/react"
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
})
