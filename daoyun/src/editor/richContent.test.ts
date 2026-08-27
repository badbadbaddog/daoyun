import { describe, expect, it } from "vitest"

import { plainTextDocument, sanitizeRichContent, toPlainText } from "./richContent"

describe("rich content helpers", () => {
  it("converts legacy plain text to paragraphs and hard breaks", () => {
    expect(plainTextDocument("第一段\n换行\n\n第二段")).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "第一段" },
            { type: "hardBreak" },
            { type: "text", text: "换行" },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "第二段" }] },
      ],
    })
  })

  it("keeps supported editor JSON and strips presentation-only link attributes", () => {
    const value = {
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{
          type: "text",
          text: "官网",
          marks: [{
            type: "link",
            attrs: {
              href: "https://example.com",
              target: "_blank",
              rel: "noopener noreferrer nofollow",
              class: null,
            },
          }],
        }],
      }],
    }

    expect(sanitizeRichContent(value)).toEqual({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{
          type: "text",
          text: "官网",
          marks: [{ type: "link", attrs: { href: "https://example.com" } }],
        }],
      }],
    })
    expect(toPlainText(value)).toBe("官网")
  })

  it("keeps only the private attachment identity for images", () => {
    const value = {
      type: "doc",
      content: [{
        type: "image",
        attrs: {
          attachmentId: "0198d874-e991-7b62-8b38-3986f55c8d3d",
          alt: "示意图",
          src: "blob:http://localhost/preview",
          title: "ignored",
        },
      }],
    }

    expect(sanitizeRichContent(value)).toEqual({
      type: "doc",
      content: [{
        type: "image",
        attrs: {
          attachmentId: "0198d874-e991-7b62-8b38-3986f55c8d3d",
          alt: "示意图",
        },
      }],
    })
  })

  it("keeps safe resized image dimensions and removes invalid dimensions", () => {
    const value = {
      type: "doc",
      content: [
        {
          type: "image",
          attrs: {
            attachmentId: "0198d874-e991-7b62-8b38-3986f55c8d3d",
            alt: "已缩放图片",
            width: 640,
            height: 360,
          },
        },
        {
          type: "image",
          attrs: {
            attachmentId: "0198d874-e991-7b62-8b38-3986f55c8d3e",
            alt: "非法尺寸",
            width: "100%",
            height: -1,
          },
        },
      ],
    }

    expect(sanitizeRichContent(value).content).toEqual([
      {
        type: "image",
        attrs: {
          attachmentId: "0198d874-e991-7b62-8b38-3986f55c8d3d",
          alt: "已缩放图片",
          width: 640,
          height: 360,
        },
      },
      {
        type: "image",
        attrs: {
          attachmentId: "0198d874-e991-7b62-8b38-3986f55c8d3e",
          alt: "非法尺寸",
        },
      },
    ])
  })
})
