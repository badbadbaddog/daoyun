import { useEffect, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ChevronLeft, ChevronRight, X } from "lucide-react"

import { ModalDialog } from "./ui/ModalDialog"
import { ZoomableImage } from "./ZoomableImage"

export interface ImagePreviewSelection {
  images: Array<{ src: string; alt: string }>
  index: number
  trigger: HTMLButtonElement
  loadImages?: (signal: AbortSignal) => Promise<Array<{ src: string; alt: string }>>
}

export function ImagePreviewDialog({ selection, onClose }: { selection: ImagePreviewSelection; onClose: () => void }) {
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  const navigationRef = useRef<HTMLElement>(null)
  const [images, setImages] = useState(selection.images)
  const [loading, setLoading] = useState(Boolean(selection.loadImages))
  const [loadFailed, setLoadFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [index, setIndex] = useState(selection.index)
  const [failed, setFailed] = useState(false)
  const image = images[index]

  useEffect(() => {
    if (!selection.loadImages) return
    const controller = new AbortController()
    setLoading(true)
    setLoadFailed(false)
    selection.loadImages(controller.signal).then(authorized => {
      if (controller.signal.aborted) return
      setImages(authorized)
      const selected = authorized.findIndex(item => item.src === selection.images[selection.index]?.src)
      setIndex(Math.max(0, selected))
      setFailed(false)
      setLoading(false)
      closeRef.current?.focus()
    }).catch(() => {
      if (controller.signal.aborted) return
      setLoadFailed(true)
      setLoading(false)
    })
    return () => controller.abort()
  }, [selection, attempt])

  function move(offset: number) {
    const next = index + offset
    if (loading || loadFailed || next < 0 || next >= images.length) return
    navigationRef.current?.focus()
    setIndex(next)
    setFailed(false)
  }

  return createPortal(
    <ModalDialog
      titleId={titleId}
      className="composer-dialog image-preview-dialog"
      backdropClassName="dialog-backdrop image-preview-backdrop"
      returnFocus={selection.trigger}
      onClose={onClose}
    >
      <div className="image-preview-dialog__layout" onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
        event.preventDefault()
        event.stopPropagation()
        move(event.key === "ArrowLeft" ? -1 : 1)
      }}>
        <div className="dialog-header">
          <h2 id={titleId}>图片预览</h2>
          <button ref={closeRef} aria-label="关闭图片预览" className="icon-button" onClick={onClose} title="关闭图片预览" type="button">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {loading ? <div className="image-preview-dialog__body"><p role="status">正在加载图片…</p></div>
          : loadFailed ? <div className="image-preview-dialog__body"><p role="alert">图片列表加载失败，请重试。</p><button className="button button--secondary" type="button" onClick={() => setAttempt(value => value + 1)}>重试加载图片</button></div>
          : !image ? <div className="image-preview-dialog__body"><p role="status">没有可查看的图片。</p></div>
          : failed
          ? <div className="image-preview-dialog__body"><p role="alert">图片加载失败，请稍后重新打开预览。</p></div>
          : <ZoomableImage alt={image.alt || "预览图片"} key={index} src={image.src} onError={() => setFailed(true)} onSwipe={images.length > 1 ? move : undefined} />}
        {!loading && !loadFailed && images.length > 1 && <nav aria-label="图片切换" className="image-preview-dialog__navigation" ref={navigationRef} tabIndex={-1}>
          <button aria-label="上一张" className="icon-button" disabled={index === 0} onClick={() => move(-1)} title="上一张" type="button">
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
          <span aria-live="polite">{index + 1} / {images.length}</span>
          <button aria-label="下一张" className="icon-button" disabled={index === images.length - 1} onClick={() => move(1)} title="下一张" type="button">
            <ChevronRight size={20} aria-hidden="true" />
          </button>
        </nav>}
      </div>
    </ModalDialog>,
    document.body,
  )
}
