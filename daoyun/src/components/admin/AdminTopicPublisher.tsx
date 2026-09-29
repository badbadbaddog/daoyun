import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { LoaderCircle, Plus } from "lucide-react"
import type { AuthSession } from "../../api/auth"
import { listBoards } from "../../api/boards"
import type { Board } from "../../types/community"
import { TopicComposer } from "../TopicComposer"

export function AdminTopicPublisher({ session, defaultBoardId, onPublished }: { session: AuthSession; defaultBoardId?: string; onPublished: () => void }) {
  const trigger = useRef<HTMLButtonElement>(null)
  function closeComposer() {
    setOpen(false)
    requestAnimationFrame(() => trigger.current?.focus())
  }
  const [open, setOpen] = useState(false)
  const [boards, setBoards] = useState<Board[] | null>(null)
  const [error, setError] = useState("")
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    listBoards(controller.signal).then((result) => {
      if (controller.signal.aborted) return
      if (!result.length) { setError("暂无可用板块，暂时无法发布主题。"); closeComposer(); return }
      setBoards(result)
    }).catch(() => {
      if (!controller.signal.aborted) { setError("板块加载失败，请重新点击发布主题。"); closeComposer() }
    })
    return () => controller.abort()
  }, [open])
  return <>
    <button ref={trigger} className="primary-button" type="button" disabled={open && !boards} onClick={() => { setBoards(null); setError(""); setOpen(true) }}>{open && !boards ? <LoaderCircle size={15} className="topic-loading__spinner" aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}发布主题</button>
    {error && <span className="topic-publisher-error" role="alert">{error}</span>}
    {open && boards && createPortal(<TopicComposer open boards={boards} session={session} defaultBoardId={boards.some((board) => board.id === defaultBoardId) ? defaultBoardId : undefined} onClose={closeComposer} onPublished={() => { closeComposer(); onPublished() }} />, document.body)}
  </>
}
