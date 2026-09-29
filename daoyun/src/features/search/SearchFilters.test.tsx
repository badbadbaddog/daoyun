import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { SearchFilters } from "./SearchFilters"

afterEach(cleanup)

it("converts Chinese tag names to the canonical tag identifier and keeps date bounds", () => {
  const onChange = vi.fn()
  render(<SearchFilters filters={{}} boards={[]} onChange={onChange} />)
  fireEvent.change(screen.getByLabelText("标签"), { target: { value: "功能验收" } })
  fireEvent.change(screen.getByLabelText("开始日期"), { target: { value: "2026-09-16" } })
  fireEvent.change(screen.getByLabelText("结束日期"), { target: { value: "2026-09-16" } })
  fireEvent.click(screen.getByRole("button", { name: "应用筛选" }))
  expect(onChange).toHaveBeenCalledWith({ tag: "tag-gbj-ph9-uj0-jzq", from: "2026-09-16", through: "2026-09-16" })
})

it("shows the known tag name while preserving its custom canonical identifier", () => {
  const onChange = vi.fn()
  render(<SearchFilters filters={{tag:"feature-acceptance"}} tags={[{slug:"feature-acceptance",name:"功能验收"}]} boards={[]} onChange={onChange} />)
  expect(screen.getByLabelText("标签")).toHaveValue("功能验收")
  fireEvent.click(screen.getByRole("button", { name: "应用筛选" }))
  expect(onChange).toHaveBeenCalledWith({tag:"feature-acceptance"})
})
