import { ChevronsDown, ChevronsUp, LoaderCircle, Plus, Search, X } from "lucide-react"
import { useMemo, useState } from "react"

import {
  AdminApiError,
  createAdminBoard,
  deleteAdminBoard,
  getAdminBoardDeletionImpact,
  listAdminBoards,
  updateAdminBoard,
  type AdminBoard,
  type AdminBoardInput,
  type AdminBoardDeletionImpact,
  type AdminBoardUpdateInput,
  type AdminBoardVisibility,
  type BoardTone,
} from "../api/admin"
import { BoardTree, buildBoardTree, compareBoards, filterBoardTree } from "./BoardTree"

interface BoardAdminPanelProps {
  boards: AdminBoard[]
  csrfToken: string
  canWrite: boolean
  onChange: (boards: AdminBoard[]) => void
}

interface BoardEditorState {
  mode: "create" | "edit"
  parentId: string | null
  board: AdminBoard | null
}

export function BoardAdminPanel({ boards, csrfToken, canWrite, onChange }: BoardAdminPanelProps) {
  const tree = useMemo(() => buildBoardTree(boards), [boards])
  const [query, setQuery] = useState("")
  const [expandedIds, setExpandedIds] = useState(() => new Set(tree.filter((node) => node.children.length > 0).map((node) => node.board.id)))
  const [editor, setEditor] = useState<BoardEditorState | null>(null)
  const [draft, setDraft] = useState<AdminBoardInput>(() => emptyDraft(null, rootBoards(boards).length))
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ boardId: string; message: string; kind: "success" | "error" } | null>(null)
  const [message, setMessage] = useState("")
  const [deleting, setDeleting] = useState<AdminBoard | null>(null)
  const [deletionImpact, setDeletionImpact] = useState<AdminBoardDeletionImpact | null>(null)
  const [deletionLoading, setDeletionLoading] = useState(false)
  const [syncRequired, setSyncRequired] = useState(false)
  const visibleTree = useMemo(() => filterBoardTree(tree, query), [query, tree])

  function startCreate(parentId: string | null) {
    const siblings = siblingBoards(boards, parentId)
    setEditor({ mode: "create", parentId, board: null })
    setDraft(emptyDraft(parentId, siblings.length))
    setMessage("")
  }

  function startEdit(board: AdminBoard) {
    setEditor({ mode: "edit", parentId: board.parentId, board })
    setDraft({
      parentId: board.parentId,
      slug: board.slug,
      name: board.name,
      description: board.description,
      icon: board.icon,
      tone: board.tone,
      position: board.position,
      visibility: board.visibility,
    })
    setMessage("")
  }

  async function saveEditor(event: React.FormEvent) {
    event.preventDefault()
    if (!editor) return
    setPendingId(editor.board?.id ?? "create")
    setMessage("")
    try {
      if (editor.mode === "create") {
        const saved = await createAdminBoard(draft, csrfToken)
        const synchronized = await refreshBoards()
        if (saved.parentId) setExpandedIds((current) => new Set(current).add(saved.parentId as string))
        setMessage(synchronized ? "版块已创建" : "版块已创建，但列表刷新失败，请刷新页面。")
      } else if (editor.board) {
        const saved = await updateAdminBoard(editor.board.id, toUpdateInput(editor.board, draft), csrfToken)
        const synchronized = await refreshBoards()
        setFeedback({ boardId: saved.id, message: synchronized ? "已保存" : "已保存，请刷新页面", kind: synchronized ? "success" : "error" })
      }
      setEditor(null)
    } catch (reason) {
      setMessage(apiMessage(reason, "保存失败，请稍后重试。"))
    } finally {
      setPendingId(null)
    }
  }

  async function mutate(board: AdminBoard, changes: Partial<AdminBoardInput>) {
    setPendingId(board.id)
    setFeedback(null)
    try {
      const saved = await updateAdminBoard(board.id, toUpdateInput(board, changes), csrfToken)
      const synchronized = await refreshBoards()
      setFeedback({ boardId: saved.id, message: synchronized ? "已保存" : "已保存，请刷新页面", kind: synchronized ? "success" : "error" })
    } catch (reason) {
      setFeedback({ boardId: board.id, message: apiMessage(reason, "保存失败，请重试。"), kind: "error" })
    } finally {
      setPendingId(null)
    }
  }

  function move(board: AdminBoard, direction: "up" | "down" | "in" | "out") {
    const siblings = siblingBoards(boards, board.parentId)
    const index = siblings.findIndex((item) => item.id === board.id)
    if (direction === "up" && index > 0) void mutate(board, { position: index - 1 })
    if (direction === "down" && index >= 0 && index < siblings.length - 1) void mutate(board, { position: index + 1 })
    if (direction === "in" && index > 0) {
      const nextParent = siblings[index - 1]
      void mutate(board, { parentId: nextParent.id, position: siblingBoards(boards, nextParent.id).length })
    }
    if (direction === "out" && board.parentId) {
      const parent = boards.find((item) => item.id === board.parentId)
      if (parent) void mutate(board, { parentId: parent.parentId, position: parent.position + 1 })
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    setPendingId(deleting.id)
    setMessage("")
    try {
      await deleteAdminBoard(deleting.id, csrfToken)
      const synchronized = await refreshBoards()
      setDeleting(null)
      setMessage(synchronized ? "版块已删除" : "版块已删除，但列表刷新失败，请刷新页面。")
    } catch (reason) {
      setMessage(apiMessage(reason, "删除失败，请稍后重试。"))
    } finally {
      setPendingId(null)
    }
  }

  async function refreshBoards() {
    try {
      onChange(await listAdminBoards())
      setSyncRequired(false)
      return true
    } catch {
      setSyncRequired(true)
      return false
    }
  }

  async function openDeletion(board: AdminBoard) {
    setDeleting(board)
    setDeletionImpact(null)
    setDeletionLoading(true)
    setMessage("")
    try {
      setDeletionImpact(await getAdminBoardDeletionImpact(board.id))
    } catch (reason) {
      setMessage(apiMessage(reason, "删除影响暂时无法读取，请稍后重试。"))
    } finally {
      setDeletionLoading(false)
    }
  }

  const deletionBlocked = !deletionImpact?.canDelete

  return (
    <section className="admin-panel admin-board-panel" aria-labelledby="board-admin-heading">
      <div className="admin-panel__heading">
        <div><p>内容组织</p><h2 id="board-admin-heading">版块管理</h2><span>按层级管理社区入口，每次只保存一个动作。</span></div>
        <span className="admin-badge">{boards.length} 个版块</span>
      </div>
      <div className="admin-board-toolbar">
        <label className="admin-board-search"><Search size={15} aria-hidden="true" /><span className="sr-only">搜索版块</span><input type="search" aria-label="搜索版块" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称或 Slug" /></label>
        <button className="secondary-button" type="button" onClick={() => setExpandedIds(new Set(boards.map((board) => board.id)))}><ChevronsDown size={14} aria-hidden="true" />全部展开</button>
        <button className="secondary-button" type="button" onClick={() => setExpandedIds(new Set())}><ChevronsUp size={14} aria-hidden="true" />全部收起</button>
        {canWrite && <button className="primary-button" type="button" onClick={() => startCreate(null)} disabled={syncRequired}><Plus size={14} aria-hidden="true" />新建顶级版块</button>}
      </div>
      {visibleTree.length > 0 ? (
        <BoardTree
          nodes={visibleTree}
          expandedIds={expandedIds}
          forceExpanded={query.trim().length > 0}
          reorderDisabled={query.trim().length > 0}
          canWrite={canWrite && !syncRequired}
          pendingId={pendingId}
          feedback={feedback}
          onToggle={(boardId) => setExpandedIds((current) => toggleSet(current, boardId))}
          onAddChild={(board) => startCreate(board.id)}
          onEdit={startEdit}
          onMove={move}
          onVisibility={(board) => void mutate(board, { visibility: board.visibility === "public" ? "hidden" : "public" })}
          onDelete={(board) => void openDeletion(board)}
        />
      ) : <p className="admin-empty" role="status">{query ? "没有匹配的版块" : "尚未创建版块"}</p>}
      {syncRequired && <p className="form-alert" role="alert">服务端已完成操作，但无法同步最新顺序。请刷新页面后再继续编辑。</p>}
      {message && <p className={message.includes("失败") ? "form-alert" : "admin-success"} role={message.includes("失败") ? "alert" : "status"}>{message}</p>}
      {editor && <BoardEditor editor={editor} draft={draft} saving={pendingId !== null} onDraft={setDraft} onCancel={() => setEditor(null)} onSubmit={saveEditor} parentName={boards.find((board) => board.id === editor.parentId)?.name ?? null} />}
      {deleting && (
        <section className="admin-confirm-panel" role="dialog" aria-modal="true" aria-labelledby="board-delete-heading">
          <div><h3 id="board-delete-heading">删除“{deleting.name}”</h3><button className="icon-button" type="button" onClick={() => { setDeleting(null); setDeletionImpact(null) }} aria-label="关闭删除确认" title="关闭"><X size={15} /></button></div>
          <p>删除后版块会从社区隐藏，首版不会自动迁移或合并内容。</p>
          {deletionLoading && <p role="status">正在计算删除影响…</p>}
          {deletionImpact && <ul><li>{deletionImpact.childCount} 个子版块</li><li>{deletionImpact.topicCount} 个主题</li><li>{deletionImpact.replyCount} 条回复</li></ul>}
          {deletionImpact && deletionBlocked && <p className="form-alert" role="alert">请先处理子版块和主题，再删除此版块。</p>}
          <button className="danger-button" type="button" onClick={() => void confirmDelete()} disabled={deletionLoading || deletionBlocked || pendingId !== null}>确认删除版块</button>
        </section>
      )}
    </section>
  )
}

function BoardEditor({ editor, draft, saving, onDraft, onCancel, onSubmit, parentName }: { editor: BoardEditorState; draft: AdminBoardInput; saving: boolean; onDraft: (draft: AdminBoardInput) => void; onCancel: () => void; onSubmit: (event: React.FormEvent) => void; parentName: string | null }) {
  const heading = editor.mode === "edit" ? `编辑“${editor.board?.name ?? "版块"}”` : parentName ? `在“${parentName}”下新增子版块` : "新建顶级版块"
  return <form className="admin-form admin-board-editor" onSubmit={onSubmit}><div className="admin-form__heading"><h3>{heading}</h3><button className="icon-button" type="button" onClick={onCancel} aria-label="取消版块编辑" title="取消"><X size={15} /></button></div>
    <div className="admin-form__grid"><label><span>版块名称</span><input value={draft.name} onChange={(event) => onDraft({ ...draft, name: event.target.value })} maxLength={80} required /></label><label><span>版块 Slug</span><input value={draft.slug} onChange={(event) => onDraft({ ...draft, slug: event.target.value })} maxLength={80} required /></label></div>
    <label><span>版块描述</span><textarea rows={2} value={draft.description} onChange={(event) => onDraft({ ...draft, description: event.target.value })} maxLength={280} /></label>
    <div className="admin-form__grid"><label><span>图标 Slug</span><input value={draft.icon} onChange={(event) => onDraft({ ...draft, icon: event.target.value })} maxLength={32} required /></label><label><span>色调</span><select value={draft.tone} onChange={(event) => onDraft({ ...draft, tone: event.target.value as BoardTone })}><option value="green">绿色</option><option value="blue">蓝色</option><option value="amber">琥珀</option><option value="rose">玫红</option></select></label></div>
    <label><span>可见性</span><select value={draft.visibility} onChange={(event) => onDraft({ ...draft, visibility: event.target.value as AdminBoardVisibility })}><option value="public">公开</option><option value="hidden">隐藏</option></select></label>
    <button className="primary-button" type="submit" disabled={saving}>{saving && <LoaderCircle className="topic-loading__spinner" size={15} aria-hidden="true" />}{editor.mode === "edit" ? "保存版块" : editor.parentId ? "创建子版块" : "创建顶级版块"}</button>
  </form>
}

function emptyDraft(parentId: string | null, position: number): AdminBoardInput { return { parentId, slug: "", name: "", description: "", icon: "messages", tone: "green", position, visibility: "public" } }
function rootBoards(boards: AdminBoard[]) { return siblingBoards(boards, null) }
function siblingBoards(boards: AdminBoard[], parentId: string | null) { return boards.filter((board) => board.parentId === parentId).sort(compareBoards) }
function toUpdateInput(board: AdminBoard, changes: Partial<AdminBoardInput>): AdminBoardUpdateInput { return { parentId: changes.parentId === undefined ? board.parentId : changes.parentId, slug: changes.slug ?? board.slug, name: changes.name ?? board.name, description: changes.description ?? board.description, icon: changes.icon ?? board.icon, tone: changes.tone ?? board.tone, position: changes.position ?? board.position, visibility: changes.visibility ?? board.visibility, expectedRevision: board.revision } }
function toggleSet(values: Set<string>, value: string) { const next = new Set(values); if (next.has(value)) next.delete(value); else next.add(value); return next }
function apiMessage(reason: unknown, fallback: string) { return reason instanceof AdminApiError ? reason.message : fallback }
