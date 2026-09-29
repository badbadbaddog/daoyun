import { useEffect, useState } from "react"
import { X } from "lucide-react"

import { listAdminTopicRevisions, type TopicRevision } from "../api/topics"
import { RichTextContent } from "./RichTextContent"
import { ModalDialog } from "./ui/ModalDialog"

export function TopicRevisionDialog({ topicId, title, onClose }: { topicId: string; title: string; onClose: () => void }) {
  const [revisions, setRevisions] = useState<TopicRevision[]>([])
  const [selectedId, setSelectedId] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(false)
    setRevisions([])
    setSelectedId("")
    listAdminTopicRevisions(topicId, controller.signal)
      .then((records) => {
        if (controller.signal.aborted) return
        const sorted = [...records].sort((a, b) => b.revisionNumber - a.revisionNumber)
        setRevisions(sorted)
        setSelectedId(sorted[0]?.id ?? "")
      })
      .catch(() => { if (!controller.signal.aborted) setError(true) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [topicId, retry])

  const selected = revisions.find((revision) => revision.id === selectedId)

  return <ModalDialog titleId="topic-revision-title" className="composer-dialog topic-revision-dialog" onClose={onClose}>
    <header className="dialog-header">
      <div><p>帖子记录 · 只读</p><h2 id="topic-revision-title">修订历史</h2></div>
      <button type="button" className="icon-button" aria-label="关闭修订历史" title="关闭修订历史" onClick={onClose}><X size={18} aria-hidden="true" /></button>
    </header>
    <div className="dialog-body">
      <strong className="topic-revision-dialog__title">{title}</strong>
      {loading ? <p role="status">正在加载修订历史…</p>
        : error ? <div><p className="form-alert" role="alert">修订历史暂时无法加载，请稍后重试。</p><button type="button" className="secondary-button" onClick={() => setRetry((value) => value + 1)}>重试</button></div>
          : revisions.length === 0 ? <p className="admin-empty" role="status">暂无修订记录</p>
            : selected && <>
              <div className="topic-revision-dialog__selector"><label htmlFor="topic-revision-version">查看版本</label><select id="topic-revision-version" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{revisions.map((revision, index) => <option key={revision.id} value={revision.id}>第 {revision.revisionNumber} 版{index === 0 ? " · 最新记录" : ""}</option>)}</select><span>共 {revisions.length} 个版本</span></div>
              <div className="topic-revision-dialog__meta"><span>{selected.editor.displayName} · @{selected.editor.username}</span><time dateTime={selected.createdAt}>{new Date(selected.createdAt).toLocaleString("zh-CN", { hour12: false })}</time></div>
              <article className="topic-revision-dialog__content" aria-label={`第 ${selected.revisionNumber} 版正文`}>
                {selected.richContent ? <RichTextContent document={selected.richContent} /> : <div className="topic-revision-dialog__plain">{selected.content}</div>}
              </article>
            </>}
    </div>
  </ModalDialog>
}
