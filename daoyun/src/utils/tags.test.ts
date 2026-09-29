import { describe, expect, it } from "vitest"

import { extractTopicTags, findTopicHashtags, parseTopicTags } from "./tags"

describe("parseTopicTags", () => {
  it("creates API-compatible ASCII slugs for Chinese tag names", () => {
    const tags = parseTopicTags("Rust, 浏览器验收")

    expect(tags).toEqual([
      { slug: "rust", name: "Rust" },
      { slug: expect.stringMatching(/^[a-z0-9-]{1,40}$/), name: "浏览器验收" },
    ])
  })

  it("preserves known slugs, removes duplicates and limits topics to five tags", () => {
    const tags = parseTopicTags("Rust, rust, 一, 二, 三, 四, 五, 六", [{ slug: "rust-lang", name: "Rust" }])

    expect(tags[0]).toEqual({ slug: "rust-lang", name: "Rust" })
    expect(tags).toHaveLength(5)
    expect(new Set(tags.map((tag) => tag.slug)).size).toBe(5)
  })

  it("extracts adjacent hashtags from post content", () => {
    expect(findTopicHashtags("正文 #我是标签#例子标签，再加 #Rust 和 #Rust").map((match) => match.name))
      .toEqual(["我是标签", "例子标签", "Rust", "Rust"])

    expect(extractTopicTags("正文 #我是标签#例子标签，再加 #Rust 和 #Rust")).toEqual([
      { slug: expect.stringMatching(/^[a-z0-9-]{1,40}$/), name: "我是标签" },
      { slug: expect.stringMatching(/^[a-z0-9-]{1,40}$/), name: "例子标签" },
      { slug: "rust", name: "Rust" },
    ])
  })
})
