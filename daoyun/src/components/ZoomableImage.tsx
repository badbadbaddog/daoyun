import { useEffect, useRef, useState, type PointerEvent } from "react"
import { Maximize, ZoomIn, ZoomOut } from "lucide-react"

type Point = { x: number; y: number }
type View = Point & { scale: number }
const fit: View = { scale: 1, x: 0, y: 0 }

export function ZoomableImage({ src, alt, onError, onSwipe }: { src: string; alt: string; onError: () => void; onSwipe?: (offset: number) => void }) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const pointers = useRef(new Map<number, Point>())
  const swipeStart = useRef<Point | null>(null)
  const tap = useRef<(Point & { time: number }) | null>(null)
  const lastTap = useRef<(Point & { time: number }) | null>(null)
  const pointerType = useRef("mouse")
  const [view, setView] = useState(fit)

  function transform(previous: View, scale: number, from: Point, to = from): View {
    const viewport = viewportRef.current
    const image = imageRef.current
    if (!viewport || !image) return previous
    const bounds = viewport.getBoundingClientRect()
    const maximum = Math.max(8, image.naturalWidth / (image.offsetWidth || 1))
    scale = Math.max(1, Math.min(maximum, scale))
    const ratio = scale / previous.scale
    const center = { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
    const limitX = Math.max(0, (image.offsetWidth * scale - viewport.clientWidth) / 2)
    const limitY = Math.max(0, (image.offsetHeight * scale - viewport.clientHeight) / 2)
    return {
      scale,
      x: Math.max(-limitX, Math.min(limitX, (previous.x - (from.x - center.x)) * ratio + to.x - center.x)),
      y: Math.max(-limitY, Math.min(limitY, (previous.y - (from.y - center.y)) * ratio + to.y - center.y)),
    }
  }

  function zoom(factor: number, point?: Point) {
    const bounds = viewportRef.current?.getBoundingClientRect()
    if (!bounds) return
    const anchor = point ?? { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
    setView((previous) => transform(previous, previous.scale * factor, anchor))
  }

  function toggleZoom(point: Point) {
    setView((previous) => previous.scale > 1 ? fit : transform(previous, 3, point))
  }

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      zoom(Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.005), { x: event.clientX, y: event.clientY })
    }
    viewport.addEventListener("wheel", wheel, { passive: false })
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      setView(fit)
      pointers.current.clear()
      swipeStart.current = null
      tap.current = null
      lastTap.current = null
    })
    observer?.observe(viewport)
    return () => {
      viewport.removeEventListener("wheel", wheel)
      observer?.disconnect()
    }
  }, [])

  function startPointer(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || pointers.current.size >= 2) return
    pointerType.current = event.pointerType
    const point = { x: event.clientX, y: event.clientY }
    pointers.current.set(event.pointerId, point)
    swipeStart.current = pointers.current.size === 1 && event.pointerType === "touch" && view.scale === 1 ? point : null
    tap.current = pointers.current.size === 1 ? { ...point, time: event.timeStamp } : null
    if (pointers.current.size > 1) lastTap.current = null
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function movePointer(event: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return
    const before = gesture([...pointers.current.values()])
    const point = { x: event.clientX, y: event.clientY }
    pointers.current.set(event.pointerId, point)
    const after = gesture([...pointers.current.values()])
    if (tap.current && Math.hypot(point.x - tap.current.x, point.y - tap.current.y) > 8) tap.current = null
    setView((previous) => transform(
      previous,
      previous.scale * (before.distance > 0 ? after.distance / before.distance : 1),
      before.center,
      after.center,
    ))
  }

  function endPointer(event: PointerEvent<HTMLDivElement>) {
    const start = swipeStart.current
    swipeStart.current = null
    if (start && pointers.current.size === 1 && view.scale === 1) {
      const dx = event.clientX - start.x
      const dy = event.clientY - start.y
      if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.5) onSwipe?.(dx < 0 ? 1 : -1)
    }
    pointers.current.delete(event.pointerId)
    if (event.pointerType === "touch" && tap.current && event.timeStamp - tap.current.time < 300) {
      const point = { x: event.clientX, y: event.clientY, time: event.timeStamp }
      const previous = lastTap.current
      if (previous && point.time - previous.time < 300 && Math.hypot(point.x - previous.x, point.y - previous.y) < 30) {
        toggleZoom(point)
        lastTap.current = null
      } else {
        lastTap.current = point
      }
    }
    tap.current = null
  }

  return <>
    <div
      aria-label="图片查看区域"
      className="image-preview-dialog__body"
      data-zoomed={view.scale > 1}
      ref={viewportRef}
      role="group"
      tabIndex={0}
      onDoubleClick={(event) => {
        if (pointerType.current !== "touch") toggleZoom({ x: event.clientX, y: event.clientY })
      }}
      onPointerDown={startPointer}
      onPointerMove={movePointer}
      onPointerUp={endPointer}
      onPointerCancel={(event) => {
        pointers.current.delete(event.pointerId)
        swipeStart.current = null
        tap.current = null
        lastTap.current = null
      }}
      onLostPointerCapture={(event) => {
        pointers.current.delete(event.pointerId)
        swipeStart.current = null
      }}
      onKeyDown={(event) => {
        if (!["+", "=", "-", "0"].includes(event.key)) return
        event.preventDefault()
        if (event.key === "0") setView(fit)
        else zoom(event.key === "-" ? 0.5 : 2)
      }}
    >
      <img
        alt={alt}
        draggable={false}
        onError={onError}
        onLoad={() => setView(fit)}
        ref={imageRef}
        src={src}
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
      />
    </div>
    <div aria-label="图片缩放" className="image-preview-dialog__zoom" role="group">
      <button aria-label="缩小图片" className="icon-button" onClick={() => zoom(0.5)} title="缩小图片" type="button"><ZoomOut size={20} aria-hidden="true" /></button>
      <output aria-label="缩放比例">{Math.round(view.scale * 100)}%</output>
      <button aria-label="放大图片" className="icon-button" onClick={() => zoom(2)} title="放大图片" type="button"><ZoomIn size={20} aria-hidden="true" /></button>
      <button aria-label="适应窗口" className="icon-button" onClick={() => setView(fit)} title="适应窗口" type="button"><Maximize size={20} aria-hidden="true" /></button>
      <span className="image-preview-dialog__hint">{view.scale > 1 ? "拖动查看细节" : onSwipe ? "左右滑动切图" : "双击或双指缩放"}</span>
    </div>
  </>
}

function gesture(points: Point[]) {
  const [first, second] = points
  return second
    ? { center: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }, distance: Math.hypot(first.x - second.x, first.y - second.y) }
    : { center: first, distance: 0 }
}
