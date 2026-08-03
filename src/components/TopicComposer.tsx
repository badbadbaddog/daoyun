import { Image, Link2, Paperclip, Send, X } from "lucide-react"
import { useEffect, useRef } from "react"

interface TopicComposerProps {
  open: boolean
  onClose: () => void
}
export function TopicComposer({ open, onClose }: TopicComposerProps) {
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return

    titleRef.current?.focus()
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handleEscape)
    return () => document.removeEventListener("keydown", handleEscape)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose()
    }}>
      <div className="composer-dialog" role="dialog" aria-modal="true" aria-labelledby="composer-title">
        <div className="dialog-header">
          <div>
            <p>工程实践</p>
            <h2 id="composer-title">发布新主题</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭发布窗口" title="关闭">
            <X size={19} />
          </button>
        </div>
        <div className="dialog-body">
          <label>
            <span>标题</span>
            <input ref={titleRef} type="text" placeholder="清晰地概括你想讨论的内容" />
          </label>
          <label>
            <span>正文</span>
            <textarea rows={8} placeholder="补充背景、你的判断和希望大家讨论的问题" />
          </label>
        </div>
        <div className="dialog-toolbar">
          <div>
            <button className="icon-button" type="button" aria-label="添加图片" title="图片"><Image size={18} /></button>
            <button className="icon-button" type="button" aria-label="添加附件" title="附件"><Paperclip size={18} /></button>
            <button className="icon-button" type="button" aria-label="添加链接" title="链接"><Link2 size={18} /></button>
          </div>
          <button className="primary-button" type="button"><Send size={16} />发布</button>
        </div>
      </div>
    </div>
  )
}
