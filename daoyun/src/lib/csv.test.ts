import { describe, expect, it } from "vitest"
import { encodeCsv } from "./csv"

describe("encodeCsv", () => {
  it("preserves Chinese, separators and multiline text, and neutralizes spreadsheet formulas", () => {
    expect(encodeCsv([["标题", "作者"], ['逗号,引号"换行\n正文', "中文"], [" =HYPERLINK(1)", "@SUM(1)"], [42, "正常"]]))
      .toBe("﻿\"标题\",\"作者\"\r\n\"逗号,引号\"\"换行\n正文\",\"中文\"\r\n\"' =HYPERLINK(1)\",\"'@SUM(1)\"\r\n\"42\",\"正常\"")
  })
})
