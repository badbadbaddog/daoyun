import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"

import { ImagePreviewDialog } from "./ImagePreviewDialog"

afterEach(cleanup)

it("zooms the image with controls, double click and wheel, and resets on image change", async () => {
  const user = userEvent.setup()
  render(<ImagePreviewDialog selection={{
    images: [{ src: "/first.png", alt: "第一张" }, { src: "/second.png", alt: "第二张" }],
    index: 0,
    trigger: document.createElement("button"),
  }} onClose={vi.fn()} />)

  const dialog = screen.getByRole("dialog", { name: "图片预览" })
  const zoom = () => within(dialog).getByLabelText("缩放比例")
  expect(zoom()).toHaveTextContent("100%")
  await user.click(within(dialog).getByRole("button", { name: "放大图片" }))
  expect(zoom()).toHaveTextContent("200%")
  await user.click(within(dialog).getByRole("button", { name: "缩小图片" }))
  expect(zoom()).toHaveTextContent("100%")
  Object.defineProperty(within(dialog).getByRole("group", { name: "图片查看区域" }), "setPointerCapture", { value: vi.fn() })
  await user.dblClick(within(dialog).getByRole("img", { name: "第一张" }))
  expect(zoom()).toHaveTextContent("300%")
  await user.click(within(dialog).getByRole("button", { name: "适应窗口" }))
  expect(zoom()).toHaveTextContent("100%")
  fireEvent.wheel(within(dialog).getByRole("img"), { deltaY: -100, clientX: 100, clientY: 100 })
  expect(zoom()).not.toHaveTextContent("100%")
  await user.click(within(dialog).getByRole("button", { name: "下一张" }))
  expect(within(dialog).getByRole("img", { name: "第二张" })).toBeInTheDocument()
  expect(zoom()).toHaveTextContent("100%")
})

it("keeps zoom within its limits and offers fit-to-window after zooming", async () => {
  const user = userEvent.setup()
  render(<ImagePreviewDialog selection={{
    images: [{ src: "/first.png", alt: "第一张" }], index: 0, trigger: document.createElement("button"),
  }} onClose={vi.fn()} />)
  const zoomIn = screen.getByRole("button", { name: "放大图片" })
  for (let i = 0; i < 6; i += 1) await user.click(zoomIn)
  expect(screen.getByLabelText("缩放比例")).toHaveTextContent("800%")
  await user.click(screen.getByRole("button", { name: "适应窗口" }))
  expect(screen.getByLabelText("缩放比例")).toHaveTextContent("100%")
  await user.click(screen.getByRole("button", { name: "缩小图片" }))
  expect(screen.getByLabelText("缩放比例")).toHaveTextContent("100%")
})

function touchPointer(element: HTMLElement, type: string, pointerId: number, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 })
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    pointerType: { value: "touch" },
  })
  fireEvent(element, event)
}

function swipeImage(dx: number, dy = 0, end = "pointerup") {
  const stage = screen.getByRole("group", { name: "图片查看区域" })
  Object.defineProperty(stage, "setPointerCapture", { value: vi.fn(), configurable: true })
  touchPointer(stage, "pointerdown", 1, 150, 200)
  touchPointer(stage, "pointermove", 1, 150 + dx, 200 + dy)
  touchPointer(stage, end, 1, 150 + dx, 200 + dy)
}

it("swipes left and right between images without wrapping at the ends", () => {
  render(<ImagePreviewDialog selection={{
    images: [{ src: "/first.png", alt: "第一张" }, { src: "/second.png", alt: "第二张" }],
    index: 0, trigger: document.createElement("button"),
  }} onClose={vi.fn()} />)
  swipeImage(80)
  expect(screen.getByRole("img", { name: "第一张" })).toBeInTheDocument()
  swipeImage(-80)
  expect(screen.getByRole("img", { name: "第二张" })).toBeInTheDocument()
  expect(screen.getByLabelText("缩放比例")).toHaveTextContent("100%")
  swipeImage(-80)
  expect(screen.getByRole("img", { name: "第二张" })).toBeInTheDocument()
  swipeImage(80)
  expect(screen.getByRole("img", { name: "第一张" })).toBeInTheDocument()
})

it("does not change images for short, vertical, canceled, pinching or zoomed drags", async () => {
  const user = userEvent.setup()
  render(<ImagePreviewDialog selection={{
    images: [{ src: "/first.png", alt: "第一张" }, { src: "/second.png", alt: "第二张" }],
    index: 0, trigger: document.createElement("button"),
  }} onClose={vi.fn()} />)
  for (const [dx, dy, end] of [[-20, 0, "pointerup"], [-80, 100, "pointerup"], [-80, 0, "pointercancel"], [-80, 0, "lostpointercapture"]] as const) {
    swipeImage(dx, dy, end)
    expect(screen.getByRole("img", { name: "第一张" })).toBeInTheDocument()
  }
  const stage = screen.getByRole("group", { name: "图片查看区域" })
  touchPointer(stage, "pointerdown", 1, 150, 200)
  touchPointer(stage, "pointerdown", 2, 200, 200)
  touchPointer(stage, "pointerup", 2, 200, 200)
  touchPointer(stage, "pointermove", 1, 50, 200)
  touchPointer(stage, "pointerup", 1, 50, 200)
  expect(screen.getByRole("img", { name: "第一张" })).toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "放大图片" }))
  swipeImage(-80)
  expect(screen.getByRole("img", { name: "第一张" })).toBeInTheDocument()
  expect(screen.getByLabelText("缩放比例")).toHaveTextContent("200%")
})

it("retries authorized gallery loading without displaying stale previews", async () => {
  const loadImages = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([{ src: "/authorized.png", alt: "授权图片" }, { src: "/next.png", alt: "下一张图片" }]);
  render(<ImagePreviewDialog selection={{ images: [{ src: "/old.png", alt: "旧预览" }], index: 0, trigger: document.createElement("button"), loadImages }} onClose={vi.fn()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("图片列表加载失败");
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole("button", { name: "重试加载图片" }));
  expect(await screen.findByRole("img", { name: "授权图片" })).toHaveAttribute("src", "/authorized.png");
  await userEvent.setup().keyboard("{ArrowRight}");
  expect(screen.getByRole("img", { name: "下一张图片" })).toBeInTheDocument();
  expect(loadImages).toHaveBeenCalledTimes(2);
});

it("aborts a pending gallery request on unmount", () => {
  let signal: AbortSignal | undefined;
  const loadImages = vi.fn((requestSignal: AbortSignal) => { signal = requestSignal; return new Promise<Array<{src:string;alt:string}>>(() => {}); });
  const { unmount } = render(<ImagePreviewDialog selection={{ images: [{ src: "/old.png", alt: "旧预览" }], index: 0, trigger: document.createElement("button"), loadImages }} onClose={vi.fn()} />);
  expect(screen.getByRole("status")).toHaveTextContent("正在加载图片");
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  unmount();
  expect(signal?.aborted).toBe(true);
});
