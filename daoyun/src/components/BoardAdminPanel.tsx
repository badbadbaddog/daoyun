import { Aperture, Code2, LayoutGrid, MessagesSquare, ChevronsDown, ChevronsUp, Folder, LoaderCircle, Plus, Search, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import {
  AdminApiError,
  createAdminBoard,
  deleteAdminBoard,
  getAdminBoardMergeImpact,
  getAdminBoardDeletionImpact,
  getAdminContentAccessPolicy,
  listAdminBoards,
  mergeAdminBoard,
  putAdminContentAccessPolicy,
  rollbackAdminBoardMerge,
  updateAdminBoard,
  type AdminBoard,
  type AdminBoardMergeImpact,
  type AdminBoardMergeMutation,
  type AdminBoardInput,
  type AdminBoardDeletionImpact,
  type AdminBoardUpdateInput,
  type AdminBoardVisibility,
  type AdminContentAccessPolicy,
  type AdminContentAccessPolicyInput,
  type ContentAccessOperator,
  type ContentAccessSubjectType,
  type BoardTone,
} from "../api/admin"
import { BoardAccessSubjectPicker } from "./BoardAccessSubjectPicker"
import { BoardGovernanceManager } from "./BoardGovernanceManager"
import { BoardPermissionMatrix } from "./BoardPermissionMatrix"
import { BoardTree, buildBoardTree, compareBoards, filterBoardTree } from "./BoardTree"
import { RevisionConflictNotice } from "./admin/RevisionConflictNotice"
import { Drawer } from "./ui/Drawer"
import { ModalDialog } from "./ui/ModalDialog"
import { adminObjectId, adminObjectQuery, restoreAdminScroll } from "./admin/adminQuery"

interface BoardAdminPanelProps {
  requestedQuery?: string
  onQueryChange?: (query: string) => void
  boards: AdminBoard[]
  csrfToken: string
  canWrite: boolean
  capabilityKeys?: string[]
  onChange: (boards: AdminBoard[]) => void
}

interface BoardEditorState {
  mode: "create" | "edit"
  parentId: string | null
  board: AdminBoard | null
  section: "basic" | "appearance" | "access" | "governance" | "matrix"
}

type AccessPolicyDraft = Pick<AdminContentAccessPolicyInput, "operator" | "subjects">

export function BoardAdminPanel({ requestedQuery = "", onQueryChange, boards, csrfToken, canWrite, capabilityKeys = [], onChange }: BoardAdminPanelProps) {
  const canReadAccess = capabilityKeys.includes("content.access_policies.read")
  const canWriteAccess = canReadAccess && capabilityKeys.includes("content.access_policies.write")
  const canReadGovernance = capabilityKeys.includes("authorization.roles.read") && capabilityKeys.includes("authorization.assignments.read")
  const tree = useMemo(() => buildBoardTree(boards), [boards])
  const [query, setQuery] = useState(() => new URLSearchParams(requestedQuery).get("q") ?? "")
  const [expandedIds, setExpandedIds] = useState(() => new Set(tree.filter((node) => node.children.length > 0).map((node) => node.board.id)))
  const [editor, setEditor] = useState<BoardEditorState | null>(null)
  const [draft, setDraft] = useState<AdminBoardInput>(() => emptyDraft(null, rootBoards(boards).length))
  const [governanceBusy, setGovernanceBusy] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ boardId: string; message: string; kind: "success" | "error" } | null>(null)
  const [message, setMessage] = useState("")
  const [deleting, setDeleting] = useState<AdminBoard | null>(null)
  const [deletionImpact, setDeletionImpact] = useState<AdminBoardDeletionImpact | null>(null)
  const [deletionLoading, setDeletionLoading] = useState(false)
  const [syncRequired, setSyncRequired] = useState(false)
  const [revisionConflict, setRevisionConflict] = useState(false)
  const [accessPolicy, setAccessPolicy] = useState<AdminContentAccessPolicy | null>(null)
  const [accessDraft, setAccessDraft] = useState<AccessPolicyDraft | null>(null)
  const [accessLoading, setAccessLoading] = useState(false)
  const [merging, setMerging] = useState<AdminBoard | null>(null)
  const [mergeTargetId, setMergeTargetId] = useState("")
  const [mergeImpact, setMergeImpact] = useState<AdminBoardMergeImpact | null>(null)
  const [mergeMutation, setMergeMutation] = useState<AdminBoardMergeMutation | null>(null)
  const [mergeLoading, setMergeLoading] = useState(false)
  const [mergeMessage, setMergeMessage] = useState("")
  const mergeReturnFocusRef = useRef<HTMLElement | null>(null)
  const deletionReturnFocusRef = useRef<HTMLElement | null>(null)
  const mutationRef = useRef(false)
  const accessRequest = useRef<AbortController | null>(null)
  useEffect(() => () => accessRequest.current?.abort(), [])
  const visibleTree = useMemo(() => filterBoardTree(tree, query), [query, tree])

  const requestedBoardId = adminObjectId(requestedQuery, "board_id")
  const openedBoardId = useRef<string | null>(null)
  useEffect(() => {
    setQuery(new URLSearchParams(requestedQuery).get("q") ?? "")
  }, [requestedQuery])
  useEffect(() => {
    if (requestedBoardId === openedBoardId.current) return
    openedBoardId.current = requestedBoardId
    if (!requestedBoardId) { accessRequest.current?.abort(); setAccessLoading(false); setEditor(null); return }
    if (editor?.board?.id === requestedBoardId) return
    const board = boards.find((item) => item.id === requestedBoardId)
    if (board) startEdit(board, "basic", false)
    else setMessage("目标版块已不存在或当前不可访问，请返回列表。")
    // The request ID controls opening; refreshed data must not replace an edit draft.
  }, [requestedBoardId, boards])

  function closeEditor() {
    if (mutationRef.current || governanceBusy) return
    accessRequest.current?.abort(); setAccessLoading(false)
    setEditor(null); setRevisionConflict(false); setMessage("")
    onQueryChange?.(adminObjectQuery(requestedQuery, "board_id", null))
    restoreAdminScroll(requestedQuery)
  }

  function startCreate(parentId: string | null) {
    if (!canWrite || mutationRef.current || governanceBusy) return
    accessRequest.current?.abort(); setAccessLoading(false)
    const siblings = siblingBoards(boards, parentId)
    setEditor({ mode: "create", parentId, board: null, section: "basic" })
    setDraft(emptyDraft(parentId, siblings.length))
    setMessage("")
    setRevisionConflict(false)
    setAccessDraft(null)
    setAccessPolicy(null)
  }

  function startEdit(board: AdminBoard, section: BoardEditorState["section"] = "basic", publish = true) {
    if (mutationRef.current || governanceBusy) return
    if (publish) onQueryChange?.(adminObjectQuery(requestedQuery, "board_id", board.id))
    accessRequest.current?.abort(); setAccessLoading(false)
    setAccessDraft(null)
    setAccessPolicy(null)
    setEditor({ mode: "edit", parentId: board.parentId, board, section })
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
    setRevisionConflict(false)
    if (section === "access") void loadAccessPolicy(board)
  }

  function changeEditorSection(section: BoardEditorState["section"]) {
    if (!editor || pendingId || accessLoading || governanceBusy) return
    setEditor({ ...editor, section })
    setMessage("")
    setRevisionConflict(false)
    if (section === "access" && editor.board && !accessDraft) void loadAccessPolicy(editor.board)
  }

  async function loadAccessPolicy(board: AdminBoard) {
    if (!canReadAccess) { setMessage("没有读取访问策略的权限。"); return }
    accessRequest.current?.abort()
    const controller = new AbortController()
    accessRequest.current = controller
    setAccessLoading(true)
    setAccessPolicy(null)
    setAccessDraft(null)
    setMessage("")
    setRevisionConflict(false)
    try {
      const policy = await getAdminContentAccessPolicy("board", board.id, controller.signal)
      if (controller.signal.aborted) return
      setAccessPolicy(policy)
      setAccessDraft({ operator: policy.operator, subjects: policy.subjects })
    } catch (reason) {
      if (controller.signal.aborted) return
      if (reason instanceof AdminApiError && reason.status === 404 && reason.code === "content.access_policy_not_found") {
        setAccessDraft({ operator: "any_of", subjects: [emptyAccessSubject("authenticated")] })
      } else {
        setMessage(apiMessage(reason, "访问策略读取失败，请稍后重试。"))
      }
    } finally {
      if (!controller.signal.aborted) setAccessLoading(false)
    }
  }

  function beginMutation(id: string) {
    if (mutationRef.current) return false
    mutationRef.current = true
    setPendingId(id)
    return true
  }

  function endMutation() {
    mutationRef.current = false
    setPendingId(null)
  }

  function finishEditor() {
    setEditor(null)
    onQueryChange?.(adminObjectQuery(requestedQuery, "board_id", null))
    restoreAdminScroll(requestedQuery)
  }

  async function saveEditor(event: React.FormEvent) {
    event.preventDefault()
    if (!editor || editor.section === "governance" || editor.section === "matrix" || (editor.section === "access" ? !canWriteAccess || !validAccessDraft(accessDraft) : !canWrite) || !beginMutation(editor.board?.id ?? "create")) return
    setMessage("")
    try {
      if (editor.mode === "edit" && editor.section === "access" && editor.board && accessDraft) {
        await putAdminContentAccessPolicy("board", editor.board.id, {
          ...accessDraft,
          expectedRevision: accessPolicy?.revision,
        }, csrfToken)
        finishEditor()
        setMessage("访问策略已保存")
      } else if (editor.mode === "create") {
        const saved = await createAdminBoard(draft, csrfToken)
        const synchronized = await refreshBoards()
        if (saved.parentId) setExpandedIds((current) => new Set(current).add(saved.parentId as string))
        setMessage(synchronized ? "版块已创建" : "版块已创建，但列表刷新失败，请刷新页面。")
        finishEditor()
      } else if (editor.board) {
        const saved = await updateAdminBoard(editor.board.id, toUpdateInput(editor.board, draft), csrfToken)
        const synchronized = await refreshBoards()
        setFeedback({ boardId: saved.id, message: synchronized ? `${saved.name}的设置已保存` : `${saved.name}已保存，列表同步失败`, kind: synchronized ? "success" : "error" })
        finishEditor()
      }
    } catch (reason) {
      setRevisionConflict(reason instanceof AdminApiError && reason.status === 409)
      setMessage(apiMessage(reason, "保存失败，请稍后重试。"))
    } finally {
      endMutation()
    }
  }

  async function mutate(board: AdminBoard, changes: Partial<AdminBoardInput>, action: string) {
    if (!beginMutation(board.id)) return
    setFeedback(null)
    try {
      const saved = await updateAdminBoard(board.id, toUpdateInput(board, changes), csrfToken)
      const synchronized = await refreshBoards()
      setFeedback({ boardId: saved.id, message: synchronized ? `${saved.name}${action}已保存` : `${saved.name}${action}已保存，列表同步失败`, kind: synchronized ? "success" : "error" })
    } catch (reason) {
      setFeedback({ boardId: board.id, message: apiMessage(reason, "保存失败，请重试。"), kind: "error" })
    } finally {
      endMutation()
    }
  }

  function move(board: AdminBoard, direction: "up" | "down" | "in" | "out") {
    const siblings = siblingBoards(boards, board.parentId)
    const index = siblings.findIndex((item) => item.id === board.id)
    if (direction === "up" && index > 0) void mutate(board, { position: index - 1 }, "上移")
    if (direction === "down" && index >= 0 && index < siblings.length - 1) void mutate(board, { position: index + 1 }, "下移")
    if (direction === "in" && index > 0) {
      const nextParent = siblings[index - 1]
      void mutate(board, { parentId: nextParent.id, position: siblingBoards(boards, nextParent.id).length }, `移入${nextParent.name}`)
    }
    if (direction === "out" && board.parentId) {
      const parent = boards.find((item) => item.id === board.parentId)
      if (parent) void mutate(board, { parentId: parent.parentId, position: parent.position + 1 }, "移出父版块")
    }
  }

  async function confirmDelete() {
    if (!deleting || !beginMutation(deleting.id)) return
    setMessage("")
    try {
      await deleteAdminBoard(deleting.id, csrfToken)
      const synchronized = await refreshBoards()
      setDeleting(null)
      setMessage(synchronized ? "版块已删除" : "版块已删除，但列表刷新失败，请刷新页面。")
    } catch (reason) {
      setMessage(apiMessage(reason, "删除失败，请稍后重试。"))
    } finally {
      endMutation()
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

  async function refreshEditorConflict() {
    if (!editor) return
    if (editor.section === "access" && editor.board) {
      await loadAccessPolicy(editor.board)
      return
    }
    if (!editor.board) {
      await refreshBoards()
      return
    }
    try {
      const refreshed = await listAdminBoards()
      onChange(refreshed)
      setSyncRequired(false)
      const latest = refreshed.find((board) => board.id === editor.board?.id)
      if (!latest) {
        setMessage("该版块已不存在，请关闭编辑器后刷新页面。")
        return
      }
      setEditor((current) => current?.board?.id === latest.id ? { ...current, board: latest, parentId: latest.parentId } : current)
      setRevisionConflict(false)
      setMessage("")
    } catch {
      setMessage("最新版块数据暂时无法加载，请稍后重试。")
    }
  }

  async function openDeletion(board: AdminBoard) {
    deletionReturnFocusRef.current = currentDialogReturnFocus()
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

  function openMerge(board: AdminBoard) {
    mergeReturnFocusRef.current = currentDialogReturnFocus()
    setMerging(board)
    setMergeTargetId("")
    setMergeImpact(null)
    setMergeMutation(null)
    setMergeMessage("")
  }

  async function previewMerge(targetBoardId: string) {
    if (!merging) return
    setMergeTargetId(targetBoardId)
    setMergeImpact(null)
    setMergeMutation(null)
    setMergeMessage("")
    if (!targetBoardId) return
    setMergeLoading(true)
    try {
      setMergeImpact(await getAdminBoardMergeImpact(merging.id, targetBoardId))
    } catch (reason) {
      setMergeMessage(apiMessage(reason, "合并影响读取失败，请稍后重试。"))
    } finally {
      setMergeLoading(false)
    }
  }

  async function confirmMerge() {
    if (!merging || !mergeImpact?.canMerge || !beginMutation(merging.id)) return
    setMergeLoading(true)
    setMergeMessage("")
    try {
      const mutation = await mergeAdminBoard(merging.id, {
        targetBoardId: mergeImpact.targetBoardId,
        expectedSourceRevision: mergeImpact.sourceRevision,
        expectedTargetRevision: mergeImpact.targetRevision,
        idempotencyKey: crypto.randomUUID(),
      }, csrfToken)
      setMergeMutation(mutation)
      setMergeMessage("版块合并已完成")
      await refreshBoards()
    } catch (reason) {
      setMergeMessage(apiMessage(reason, "版块合并失败，请稍后重试。"))
    } finally {
      setMergeLoading(false)
      endMutation()
    }
  }

  async function rollbackMerge() {
    if (!merging || !mergeMutation || mergeMutation.rolledBack || !beginMutation(merging.id)) return
    setMergeLoading(true)
    setMergeMessage("")
    try {
      const mutation = await rollbackAdminBoardMerge(merging.id, {
        auditId: mergeMutation.auditId,
        expectedSourceRevision: mergeMutation.sourceRevision,
        expectedTargetRevision: mergeMutation.targetRevision,
        idempotencyKey: crypto.randomUUID(),
      }, csrfToken)
      setMergeMutation(mutation)
      setMergeMessage("合并已回滚")
      await refreshBoards()
    } catch (reason) {
      setMergeMessage(apiMessage(reason, "合并回滚失败，请稍后重试。"))
    } finally {
      setMergeLoading(false)
      endMutation()
    }
  }

  const deletionBlocked = !deletionImpact?.canDelete

  return (
    <section className="admin-panel admin-board-panel admin-catalog" aria-labelledby="board-admin-heading">
      <div className="admin-panel__heading">
        <div><p>内容组织</p><h2 id="board-admin-heading">版块管理</h2><span>按层级管理社区入口，每次只保存一个动作。</span></div>
        <div className="admin-catalog-summary"><strong>全部版块 <span>{boards.length}</span></strong><span>{rootBoards(boards).length} 个顶级版块</span><span>{boards.filter((board) => board.visibility === "hidden").length} 个隐藏</span></div>
      </div>
      <div className="admin-board-toolbar">
        <label className="admin-board-search"><Search size={15} aria-hidden="true" /><span className="sr-only">搜索版块</span><input type="search" aria-label="搜索版块" value={query} onChange={(event) => { setQuery(event.target.value); const params = new URLSearchParams(requestedQuery); if (event.target.value) params.set("q", event.target.value); else params.delete("q"); onQueryChange?.(params.toString()) }} placeholder="搜索名称或 Slug" /></label>
        <button className="secondary-button" type="button" onClick={() => setExpandedIds(new Set(boards.map((board) => board.id)))}><ChevronsDown size={14} aria-hidden="true" />全部展开</button>
        <button className="secondary-button" type="button" onClick={() => setExpandedIds(new Set())}><ChevronsUp size={14} aria-hidden="true" />全部收起</button>
        {canWrite && <button className="primary-button" type="button" onClick={() => startCreate(null)} disabled={syncRequired}><Plus size={14} aria-hidden="true" />新建顶级版块</button>}
      </div>
      <div className="admin-board-columns" aria-hidden="true"><span>版块名称 / 层级</span><span>可见状态</span><span>内容数量</span><span>操作</span></div>
      {visibleTree.length > 0 ? (
        <BoardTree
          nodes={visibleTree}
          expandedIds={expandedIds}
          forceExpanded={query.trim().length > 0}
          reorderDisabled={query.trim().length > 0}
          canWrite={canWrite && !syncRequired}
          canReadAccess={canReadAccess}
          canReadGovernance={canReadGovernance}
          pendingId={pendingId}
          feedback={feedback}
          onToggle={(boardId) => setExpandedIds((current) => toggleSet(current, boardId))}
          onAddChild={(board) => startCreate(board.id)}
          onEdit={(board) => startEdit(board)}
          onMove={move}
          onVisibility={(board) => void mutate(board, { visibility: board.visibility === "public" ? "hidden" : "public" }, board.visibility === "public" ? "设为隐藏" : "设为公开")}
          onAccessPolicy={(board) => startEdit(board, "access")}
          onGovernance={(board) => startEdit(board, "governance")}
          onMerge={openMerge}
          onDelete={(board) => void openDeletion(board)}
        />
      ) : <p className="admin-empty" role="status">{query ? "没有匹配的版块" : "尚未创建版块"}</p>}
      {syncRequired && <p className="form-alert" role="alert">服务端已完成操作，但无法同步最新顺序。请刷新页面后再继续编辑。</p>}
      {message && !editor && !deleting && <p className={message.includes("失败") ? "form-alert" : "admin-success"} role={message.includes("失败") ? "alert" : "status"}>{message}</p>}
      <footer className="admin-catalog-footer"><span>按层级展示 · 最多三级</span><span>{query ? "搜索结果保留父级路径；清除搜索后可调整顺序。" : "点击版块名称编辑，更多菜单可调整层级和顺序。"}</span></footer>
      {editor && <BoardEditor key={editor.board?.id ?? "new-board"} csrfToken={csrfToken} capabilityKeys={capabilityKeys} onGovernanceBusy={setGovernanceBusy} canWrite={canWrite} editor={editor} draft={draft} accessPolicy={accessPolicy} accessDraft={accessDraft} accessLoading={accessLoading} saving={pendingId !== null || governanceBusy} conflict={revisionConflict} error={message} onSection={changeEditorSection} onDraft={setDraft} onAccessDraft={setAccessDraft} onCancel={closeEditor} onRefresh={() => void refreshEditorConflict()} onSubmit={saveEditor} parentName={boards.find((board) => board.id === editor.parentId)?.name ?? null} />}
      {merging && (
        <ModalDialog titleId="board-merge-heading" className="admin-confirm-panel" backdropClassName="dialog-backdrop admin-confirm-backdrop" busy={mergeLoading || pendingId === merging.id} returnFocus={mergeReturnFocusRef.current} onClose={() => setMerging(null)}>
          <div><h3 id="board-merge-heading">合并“{merging.name}”</h3><button className="icon-button" type="button" onClick={() => setMerging(null)} disabled={mergeLoading || pendingId === merging.id} aria-label="关闭合并确认" title="关闭"><X size={15} /></button></div>
          {!mergeMutation && <label><span>目标版块</span><select aria-label="目标版块" value={mergeTargetId} onChange={(event) => void previewMerge(event.target.value)} disabled={mergeLoading}><option value="">请选择目标版块</option>{boards.filter((board) => board.id !== merging.id && board.status !== "merged").map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}</select></label>}
          {mergeLoading && <p role="status">正在处理合并…</p>}
          {mergeImpact && !mergeMutation && <><ul><li>{mergeImpact.topicCount} 个主题</li><li>{mergeImpact.replyCount} 条回复</li><li>{mergeImpact.childCount} 个子版块</li></ul>{mergeImpact.blockedReason && <p className="form-alert" role="alert">{mergeBlockedReasonMessage(mergeImpact.blockedReason)}</p>}<button className="danger-button" type="button" onClick={() => void confirmMerge()} disabled={!mergeImpact.canMerge || mergeLoading}>确认合并版块</button></>}
          {mergeMutation && <><dl><div><dt>审计编号</dt><dd>{mergeMutation.auditId}</dd></div><div><dt>迁移主题</dt><dd>{mergeMutation.movedTopicCount}</dd></div><div><dt>回滚截止</dt><dd>{new Date(mergeMutation.rollbackDeadline).toLocaleString("zh-CN")}</dd></div></dl>{!mergeMutation.rolledBack && Date.parse(mergeMutation.rollbackDeadline) > Date.now() && <button className="danger-button" type="button" onClick={() => void rollbackMerge()} disabled={mergeLoading}>24 小时内回滚合并</button>}</>}
          {mergeMessage && <p className={mergeMessage.includes("失败") ? "form-alert" : "admin-success"} role={mergeMessage.includes("失败") ? "alert" : "status"}>{mergeMessage}</p>}
        </ModalDialog>
      )}
      {deleting && (
        <ModalDialog titleId="board-delete-heading" className="admin-confirm-panel" backdropClassName="dialog-backdrop admin-confirm-backdrop" busy={deletionLoading || pendingId === deleting.id} returnFocus={deletionReturnFocusRef.current} onClose={() => { setDeleting(null); setDeletionImpact(null) }}>
          <div><h3 id="board-delete-heading">删除“{deleting.name}”</h3><button className="icon-button" type="button" onClick={() => { setDeleting(null); setDeletionImpact(null) }} disabled={deletionLoading || pendingId === deleting.id} aria-label="关闭删除确认" title="关闭"><X size={15} /></button></div>
          <p>删除后版块会从社区隐藏，首版不会自动迁移或合并内容。</p>
          {deletionLoading && <p role="status">正在计算删除影响…</p>}
          {deletionImpact && <ul><li>{deletionImpact.childCount} 个子版块</li><li>{deletionImpact.topicCount} 个主题</li><li>{deletionImpact.replyCount} 条回复</li></ul>}
          {deletionImpact && deletionBlocked && <p className="form-alert" role="alert">请先处理子版块和主题，再删除此版块。</p>}
          <button className="danger-button" type="button" onClick={() => void confirmDelete()} disabled={deletionLoading || deletionBlocked || pendingId !== null}>确认删除版块</button>
        </ModalDialog>
      )}
    </section>
  )
}

function currentDialogReturnFocus() {
  const activeElement = document.activeElement
  if (!(activeElement instanceof HTMLElement)) return null
  return activeElement.closest(".action-menu")?.querySelector<HTMLElement>("[aria-haspopup='menu']") ?? activeElement
}

function BoardEditor({ csrfToken, capabilityKeys, onGovernanceBusy, canWrite, editor, draft, accessPolicy, accessDraft, accessLoading, saving, conflict, error, onSection, onDraft, onAccessDraft, onCancel, onRefresh, onSubmit, parentName }: { csrfToken: string; capabilityKeys: string[]; onGovernanceBusy: (busy: boolean) => void; canWrite: boolean; editor: BoardEditorState; draft: AdminBoardInput; accessPolicy: AdminContentAccessPolicy | null; accessDraft: AccessPolicyDraft | null; accessLoading: boolean; saving: boolean; conflict: boolean; error: string; onSection: (section: BoardEditorState["section"]) => void; onDraft: (draft: AdminBoardInput) => void; onAccessDraft: (draft: AccessPolicyDraft | null) => void; onCancel: () => void; onRefresh: () => void; onSubmit: (event: React.FormEvent) => void; parentName: string | null }) {
  const heading = editor.mode === "edit" ? `${canWrite ? "编辑" : "查看"}“${editor.board?.name ?? "版块"}”` : parentName ? `在“${parentName}”下新增子版块` : "新建顶级版块"
  const canReadAccess = capabilityKeys.includes("content.access_policies.read")
  const canWriteAccess = canReadAccess && capabilityKeys.includes("content.access_policies.write")
  const busy = saving || accessLoading
  const independentSection = editor.section === "governance" || editor.section === "matrix"
  const Container = independentSection ? "div" : "form"
  const Icon = boardIcons.find(item => item.key === draft.icon)?.icon ?? Folder
  return <Drawer title={heading} description={parentName ? `上级版块：${parentName}` : "社区目录中的顶级入口"} onClose={onCancel} busy={busy}>
    <Container className="admin-form admin-board-editor admin-board-editor--focused" onSubmit={independentSection ? undefined : onSubmit}>
      <nav className="admin-workspace-tabs" aria-label="版块设置分区">
        {([{ key: "basic", label: "基本信息" }, { key: "appearance", label: "外观展示" }, ...(editor.mode === "edit" ? [{ key: "access", label: "访问权限" }, { key: "matrix", label: "有效权限" }, { key: "governance", label: "治理人员" }] : [])] as Array<{ key: BoardEditorState["section"]; label: string }>).map((section) => <button key={section.key} type="button" aria-pressed={editor.section === section.key} disabled={busy && editor.section !== section.key} aria-disabled={busy} onClick={() => onSection(section.key)}>{section.label}</button>)}
      </nav>
      <div className="admin-board-editor__preview">
        <span className={`admin-board-mark admin-board-mark--${draft.tone}`} aria-hidden="true" data-testid="board-icon-preview"><Icon size={22} /></span>
        <div><strong>{draft.name || "新版块"}</strong><span>{draft.description || "添加一句描述，让成员了解这里适合讨论什么。"}</span></div>
        <span className="admin-badge">{draft.visibility === "public" ? "公开" : "隐藏"}</span>
      </div>
      {editor.section === "basic" && <fieldset disabled={busy || !canWrite}>
        <legend>基本信息</legend>
        <label><span>版块名称</span><input value={draft.name} onChange={(event) => onDraft({ ...draft, name: event.target.value })} maxLength={80} required placeholder="例如：社区交流" /></label>
        <label><span>版块描述</span><textarea rows={3} value={draft.description} onChange={(event) => onDraft({ ...draft, description: event.target.value })} maxLength={280} placeholder="介绍版块定位与讨论范围" /></label>
        <label><span>可见状态（与访问策略分离）</span><select aria-label="可见状态（与访问策略分离）" value={draft.visibility} onChange={(event) => onDraft({ ...draft, visibility: event.target.value as AdminBoardVisibility })}><option value="public">公开</option><option value="hidden">隐藏</option></select><small>隐藏版块不出现在公共目录，直接访问也会被拒绝；公开版块仍需满足自身访问策略。</small></label>
        <p>可见状态仅作用于本版块，不会自动隐藏子版块；子版块需分别设置。</p>
        <p>树层级不会自动继承版块访问策略；子版块需分别设置。主题、回复和附件仍须满足所属版块及自身内容的访问条件。</p>
      </fieldset>}
      {editor.section === "appearance" && <fieldset disabled={busy || !canWrite}>
        <legend>外观展示</legend>
        <label><span>版块图标</span><select aria-label="版块图标" value={draft.icon} onChange={event => onDraft({ ...draft, icon: event.target.value })}>{!boardIcons.some(item => item.key === draft.icon) && <option value={draft.icon}>当前图标 · {draft.icon}</option>}{boardIcons.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
        <label><span>色调</span><select value={draft.tone} onChange={(event) => onDraft({ ...draft, tone: event.target.value as BoardTone })}><option value="green">绿色</option><option value="blue">蓝色</option><option value="amber">琥珀</option><option value="rose">玫红</option></select></label>
      </fieldset>}
      {editor.section === "access" && <fieldset disabled={busy || !canWriteAccess}>
        <legend>谁可以访问这个版块</legend>
        <p>治理主体只是访问条件，不会授予置顶、精华、锁定或移动权限；这些动作仍需独立角色任命。</p>
        <p>选择允许访问的成员范围，保存的是这个版块的访问策略。隐藏版块不会出现在公共目录，直接访问也会被拒绝。可见状态和访问策略分别保存。</p>
        <p>可见状态仅作用于本版块，不会自动隐藏子版块；子版块需分别设置。</p>
        <p>树层级不会自动继承版块访问策略；子版块需分别设置。主题、回复和附件仍须满足所属版块及自身内容的访问条件。</p>
        {!accessLoading && !accessPolicy && accessDraft && <p className="admin-policy-draft-note">尚未设置独立访问策略。以下是待保存草稿，保存后才会生效。</p>}
        {canReadAccess && !accessLoading && !accessDraft && <button className="secondary-button" type="button" onClick={onRefresh}>重新加载访问策略</button>}
      {editor.mode === "create" && <p>创建版块后可配置访问策略。</p>}
      {editor.mode === "edit" && accessLoading && <p role="status">正在加载访问策略…</p>}
      {editor.mode === "edit" && accessDraft && <>
        <label><span>匹配方式</span><select aria-label="访问策略匹配方式" value={accessDraft.operator} onChange={(event) => onAccessDraft({ ...accessDraft, operator: event.target.value as ContentAccessOperator })}><option value="any_of">满足任一主体</option><option value="all_of">满足全部主体</option></select></label>
        {accessDraft.subjects.map((subject, index) => <div className="admin-form__grid" key={`${index}-${subject.subjectType}`}>
          <label><span>访问主体 {index + 1}</span><select aria-label={`访问主体 ${index + 1}`} value={subject.subjectType} onChange={(event) => onAccessDraft({ ...accessDraft, subjects: accessDraft.subjects.map((item, itemIndex) => itemIndex === index ? emptyAccessSubject(event.target.value as ContentAccessSubjectType) : item) })}><option value="public">所有访客</option><option value="authenticated">已登录用户</option><option value="community_group">社区用户组</option><option value="entitlement">标准权益</option><option value="governance">治理人员</option></select></label>
          {(subject.subjectType === "community_group" || subject.subjectType === "entitlement" || subject.subjectType === "governance") && <BoardAccessSubjectPicker kind={subject.subjectType} index={index + 1} value={(subject.subjectType === "community_group" ? subject.communityGroupId : subject.subjectKey) ?? ""} capabilityKeys={capabilityKeys} disabled={busy || !canWriteAccess} onChange={value => onAccessDraft({ ...accessDraft, subjects: accessDraft.subjects.map((item, itemIndex) => itemIndex === index ? { ...item, ...(subject.subjectType === "community_group" ? { communityGroupId: value } : { subjectKey: value }) } : item) })} />}
          {accessDraft.subjects.length > 1 && <button className="secondary-button" type="button" onClick={() => onAccessDraft({ ...accessDraft, subjects: accessDraft.subjects.filter((_, itemIndex) => itemIndex !== index) })}>移除主体 {index + 1}</button>}
        </div>)}
        <button className="secondary-button" type="button" disabled={accessDraft.subjects.length >= 32} onClick={() => onAccessDraft({ ...accessDraft, subjects: [...accessDraft.subjects, emptyAccessSubject("authenticated")] })}>添加访问主体</button>

      </>}

      </fieldset>}
      {editor.section === "matrix" && editor.board && <BoardPermissionMatrix board={editor.board} capabilityKeys={capabilityKeys} csrfToken={csrfToken} onBusyChange={onGovernanceBusy} />}
      {editor.section === "governance" && editor.board && <BoardGovernanceManager board={editor.board} csrfToken={csrfToken} capabilityKeys={capabilityKeys} onBusyChange={onGovernanceBusy} />}
      {!independentSection && <details className="admin-board-advanced"><summary>高级信息</summary><label><span>版块固定标识</span><input aria-label="版块固定标识" value={draft.slug} readOnly /><small>新建时自动生成；现有版块保持固定标识，确保入口链接稳定。</small></label></details>}
      {conflict && <RevisionConflictNotice onRefresh={onRefresh} />}{error && !conflict && <p className="form-alert" role="alert">{error}</p>}
      <div className="admin-editor-footer"><button className="secondary-button" type="button" disabled={busy} onClick={onCancel}>取消</button>
        {(editor.section === "access" ? canWriteAccess : canWrite) && !independentSection && <button className="primary-button" type="submit" disabled={busy || (editor.section === "access" ? !validAccessDraft(accessDraft) : !draft.name.trim() || !draft.slug.trim())}>{saving && <LoaderCircle className="topic-loading__spinner" size={15} aria-hidden="true" />}{editor.section === "access" ? "保存访问策略" : editor.mode === "edit" ? "保存版块" : editor.parentId ? "创建子版块" : "创建顶级版块"}</button>}
      </div>
    </Container>
  </Drawer>
}

function emptyDraft(parentId: string | null, position: number): AdminBoardInput { return { parentId, slug: "board-" + crypto.randomUUID(), name: "", description: "", icon: "messages", tone: "green", position, visibility: "public" } }
function emptyAccessSubject(subjectType: ContentAccessSubjectType) { return { subjectType, communityGroupId: null, subjectKey: null } }
function rootBoards(boards: AdminBoard[]) { return siblingBoards(boards, null) }
function siblingBoards(boards: AdminBoard[], parentId: string | null) { return boards.filter((board) => board.parentId === parentId).sort(compareBoards) }
function toUpdateInput(board: AdminBoard, changes: Partial<AdminBoardInput>): AdminBoardUpdateInput { return { parentId: changes.parentId === undefined ? board.parentId : changes.parentId, slug: changes.slug ?? board.slug, name: changes.name ?? board.name, description: changes.description ?? board.description, icon: changes.icon ?? board.icon, tone: changes.tone ?? board.tone, position: changes.position ?? board.position, visibility: changes.visibility ?? board.visibility, expectedRevision: board.revision } }
function toggleSet(values: Set<string>, value: string) { const next = new Set(values); if (next.has(value)) next.delete(value); else next.add(value); return next }
function apiMessage(reason: unknown, fallback: string) { return reason instanceof AdminApiError ? reason.message : fallback }
function mergeBlockedReasonMessage(reason: NonNullable<AdminBoardMergeImpact["blockedReason"]>) { return ({ same_board: "源版块和目标版块不能相同。", target_descendant: "目标版块不能是源版块的子版块。", source_has_children: "源版块仍有子版块，请先迁移子版块。", topic_limit_exceeded: "合并后的主题数量超过 5000 条限制。", source_unavailable: "源版块当前不可合并。", target_unavailable: "目标版块当前不可接收合并。" })[reason] }

const boardIcons = [{ key: "messages", label: "交流对话", icon: MessagesSquare }, { key: "code", label: "代码开发", icon: Code2 }, { key: "layout", label: "内容布局", icon: LayoutGrid }, { key: "aperture", label: "创意摄影", icon: Aperture }]
function validAccessDraft(draft: AccessPolicyDraft | null) { return Boolean(draft && draft.subjects.length > 0 && draft.subjects.length <= 32 && draft.subjects.every(subject => subject.subjectType === "community_group" ? Boolean(subject.communityGroupId) : subject.subjectType === "entitlement" || subject.subjectType === "governance" ? Boolean(subject.subjectKey) : true)) }
