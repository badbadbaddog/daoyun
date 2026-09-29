import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { AdminApiError, createMembershipMedalRule, deleteMembershipMedalRule, updateMembershipMedalRule, uploadMembershipMedalAsset, type MembershipMedalRule } from "../../api/admin"
import { MedalsWorkspace } from "./MedalsWorkspace"

vi.mock("../../api/admin", async () => ({ ...await vi.importActual("../../api/admin"), uploadMembershipMedalAsset: vi.fn(), createMembershipMedalRule: vi.fn(), updateMembershipMedalRule: vi.fn(), deleteMembershipMedalRule: vi.fn() }))
const rule: MembershipMedalRule = { key: "medal_01", displayName: "贡献者", assetKey: "medal_01", assetUrl: "/assets/membership/medals/medal1.gif", enabled: false, requiredLifetimePoints: null, revision: 1, updatedAt: "2026-09-05T00:00:00Z" }
function Workspace({ canWrite = true }: { canWrite?: boolean }) {
  const [rules, setRules] = useState([rule])
  return <MedalsWorkspace rules={rules} onChange={setRules} canWrite={canWrite} csrfToken="csrf" onRefresh={async () => { const next = [{ ...rule, revision: 2 }]; setRules(next); return next }} />
}
beforeEach(() => vi.resetAllMocks())
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it("requires an uploaded icon for new medals without offering built-in artwork", async () => {
  const user = userEvent.setup()
  render(<Workspace />)
  await user.click(screen.getByRole("button", { name: "新增勋章" }))
  const dialog = screen.getByRole("dialog")
  expect(within(dialog).queryByRole("radio")).not.toBeInTheDocument()
  expect(within(dialog).queryByRole("img")).not.toBeInTheDocument()
  await user.type(screen.getByLabelText("勋章名称"), "自定义勋章")
  await user.click(screen.getByRole("button", { name: "创建勋章" }))
  expect(screen.getByRole("alert")).toHaveTextContent("请上传勋章图标")
  expect(createMembershipMedalRule).not.toHaveBeenCalled()
  expect(uploadMembershipMedalAsset).not.toHaveBeenCalled()
})

it("previews a local image, uploads on save and reuses the upload when saving is retried", async () => {
  vi.stubGlobal("URL", class extends URL { static createObjectURL = vi.fn(() => "blob:preview"); static revokeObjectURL = vi.fn() })
  const user = userEvent.setup()
  const assetKey = `upload_${"a".repeat(64)}`
  const assetUrl = `/api/v1/membership/medal-assets/${assetKey}`
  vi.mocked(uploadMembershipMedalAsset).mockResolvedValue({ assetKey, assetUrl, sha256: "a".repeat(64), mimeType: "image/png", sizeBytes: 5 })
  vi.mocked(updateMembershipMedalRule).mockRejectedValueOnce(new AdminApiError(503, "unavailable", "保存失败"))
    .mockResolvedValueOnce({ ...rule, assetKey, assetUrl, revision: 2 })
  render(<Workspace />)
  await user.click(screen.getByRole("button", { name: "编辑 贡献者" }))
  const file = new File(["image"], "custom.png", { type: "image/png" })
  await user.upload(screen.getByLabelText("上传自定义图标"), file)
  expect(screen.getByRole("img", { name: "当前勋章图标预览" })).toHaveAttribute("src", "blob:preview")
  expect(uploadMembershipMedalAsset).not.toHaveBeenCalled()
  await user.click(screen.getByRole("button", { name: "保存勋章" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("保存失败")
  expect(uploadMembershipMedalAsset).toHaveBeenCalledWith(file, "csrf")
  expect(screen.getByRole("img", { name: "当前勋章图标预览" })).toHaveAttribute("src", assetUrl)
  await user.click(screen.getByRole("button", { name: "保存勋章" }))
  expect(uploadMembershipMedalAsset).toHaveBeenCalledTimes(1)
  expect(updateMembershipMedalRule).toHaveBeenLastCalledWith("medal_01", expect.objectContaining({ assetKey }), "csrf")
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
})

it("rejects unsupported files and discards a pending upload when editing is canceled", async () => {
  vi.stubGlobal("URL", class extends URL { static createObjectURL = vi.fn(() => "blob:preview"); static revokeObjectURL = vi.fn() })
  const user = userEvent.setup({ applyAccept: false })
  vi.mocked(updateMembershipMedalRule).mockResolvedValue(rule)
  render(<Workspace />)
  await user.click(screen.getByRole("button", { name: "编辑 贡献者" }))
  await user.upload(screen.getByLabelText("上传自定义图标"), new File(["<svg/>"], "icon.svg", { type: "image/svg+xml" }))
  expect(screen.getByRole("alert")).toHaveTextContent("PNG")
  expect(screen.getByRole("img", { name: "当前勋章图标预览" })).toHaveAttribute("src", rule.assetUrl)
  await user.upload(screen.getByLabelText("上传自定义图标"), new File(["ok"], "icon.png", { type: "image/png" }))
  await user.click(screen.getByRole("button", { name: "取消" }))
  await user.click(screen.getByRole("button", { name: "编辑 贡献者" }))
  expect(screen.getByRole("img", { name: "当前勋章图标预览" })).toHaveAttribute("src", rule.assetUrl)
  await user.click(screen.getByRole("button", { name: "保存勋章" }))
  expect(uploadMembershipMedalAsset).not.toHaveBeenCalled()
  expect(updateMembershipMedalRule).toHaveBeenCalledWith("medal_01", expect.objectContaining({ assetKey: rule.assetKey }), "csrf")
})

it("creates a custom name and chosen artwork through a dialog, then deletes only after confirmation", async () => {
  vi.stubGlobal("URL", class extends URL { static createObjectURL = vi.fn(() => "blob:preview"); static revokeObjectURL = vi.fn() })
  const user = userEvent.setup()
  const assetKey = `upload_${"a".repeat(64)}`
  const assetUrl = `/api/v1/membership/medal-assets/${assetKey}`
  vi.mocked(uploadMembershipMedalAsset).mockResolvedValue({ assetKey, assetUrl, sha256: "a".repeat(64), mimeType: "image/png", sizeBytes: 5 })
  vi.mocked(createMembershipMedalRule).mockResolvedValue({ ...rule, key: "medal_custom", displayName: "热心成员", assetKey, assetUrl })
  vi.mocked(deleteMembershipMedalRule).mockResolvedValue(true)
  render(<Workspace />)
  expect(screen.queryByLabelText("勋章名称")).not.toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "新增勋章" }))
  await user.type(screen.getByLabelText("勋章名称"), "热心成员")
  await user.upload(screen.getByLabelText("上传自定义图标"), new File(["image"], "custom.png", { type: "image/png" }))
  await user.click(screen.getByRole("button", { name: "创建勋章" }))
  expect(createMembershipMedalRule).toHaveBeenCalledWith({ displayName: "热心成员", assetKey, enabled: false, requiredLifetimePoints: null }, "csrf")
  expect(await screen.findByRole("img", { name: "热心成员" })).toHaveAttribute("src", assetUrl)
  await user.click(screen.getByRole("button", { name: "删除 热心成员" }))
  const confirmation = screen.getByRole("alertdialog", { name: "删除勋章" })
  expect(confirmation).toHaveTextContent("成员已持有的勋章与历史记录会保留")
  expect(deleteMembershipMedalRule).not.toHaveBeenCalled()
  await user.click(within(confirmation).getByRole("button", { name: "取消" }))
  await user.click(screen.getByRole("button", { name: "删除 热心成员" }))
  await user.click(screen.getByRole("button", { name: "确认删除" }))
  expect(deleteMembershipMedalRule).toHaveBeenCalledWith("medal_custom", 1, "csrf")
  await waitFor(() => expect(screen.queryByRole("img", { name: "热心成员" })).not.toBeInTheDocument())
})

it("preserves edited fields after a revision conflict and retries with the refreshed version", async () => {
  const user = userEvent.setup()
  vi.mocked(updateMembershipMedalRule).mockRejectedValueOnce(new AdminApiError(409, "membership.medal_revision_conflict", "版本冲突")).mockResolvedValueOnce({ ...rule, displayName: "年度贡献者", revision: 3 })
  render(<Workspace />)
  await user.click(screen.getByRole("button", { name: "编辑 贡献者" }))
  await user.clear(screen.getByLabelText("勋章名称"))
  await user.type(screen.getByLabelText("勋章名称"), "年度贡献者")
  await user.click(screen.getByRole("button", { name: "保存勋章" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("版本冲突")
  await user.click(screen.getByRole("button", { name: "刷新版本并保留草稿" }))
  expect(screen.getByLabelText("勋章名称")).toHaveValue("年度贡献者")
  await user.click(screen.getByRole("button", { name: "保存勋章" }))
  expect(updateMembershipMedalRule).toHaveBeenLastCalledWith("medal_01", expect.objectContaining({ expectedRevision: 2, displayName: "年度贡献者" }), "csrf")
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
})

it("keeps read-only catalogs searchable without mutation controls", async () => {
  render(<Workspace canWrite={false} />)
  expect(screen.queryByRole("button", { name: "新增勋章" })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "编辑 贡献者" })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "删除 贡献者" })).not.toBeInTheDocument()
  await userEvent.type(screen.getByRole("searchbox", { name: "搜索勋章" }), "不存在")
  expect(screen.getByText("没有匹配的勋章")).toBeInTheDocument()
})

it("shows the server field error instead of the generic validation message", async () => {
  const user = userEvent.setup()
  vi.mocked(updateMembershipMedalRule).mockRejectedValue(new AdminApiError(422, "validation.failed", "请求参数校验失败", { file: ["图片无法解码，请选择有效图片"] }))
  render(<Workspace />)
  await user.click(screen.getByRole("button", { name: "编辑 贡献者" }))
  await user.clear(screen.getByLabelText("勋章名称"))
  await user.type(screen.getByLabelText("勋章名称"), "路飞")
  await user.click(screen.getByRole("button", { name: "保存勋章" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("图片无法解码，请选择有效图片")
  expect(screen.getByLabelText("勋章名称")).toHaveValue("路飞")
})
