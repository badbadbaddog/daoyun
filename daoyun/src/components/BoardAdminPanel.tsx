import { ChevronsDown, ChevronsUp, LoaderCircle, Plus, Search, X } from "lucide-react"
import { useMemo, useRef, useState } from "react"

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
import { BoardTree, buildBoardTree, compareBoards, filterBoardTree } from "./BoardTree"
import { RevisionConflictNotice } from "./admin/RevisionConflictNotice"
import { Drawer } from "./ui/Drawer"
import { ModalDialog } from "./ui/ModalDialog"

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
  section: "basic" | "content" | "access" | "governance" | "danger"
}

type AccessPolicyDraft = Pick<AdminContentAccessPolicyInput, "operator" | "subjects">

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
  const visibleTree = useMemo(() => filterBoardTree(tree, query), [query, tree])

  function startCreate(parentId: string | null) {
    const siblings = siblingBoards(boards, parentId)
    setEditor({ mode: "create", parentId, board: null, section: "basic" })
    setDraft(emptyDraft(parentId, siblings.length))
    setMessage("")
  }

  function startEdit(board: AdminBoard, section: BoardEditorState["section"] = "basic") {
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

  async function loadAccessPolicy(board: AdminBoard) {
    setAccessLoading(true)
    setAccessPolicy(null)
    setAccessDraft(null)
    setMessage("")
    setRevisionConflict(false)
    try {
      const policy = await getAdminContentAccessPolicy("board", board.id)
      setAccessPolicy(policy)
      setAccessDraft({ operator: policy.operator, subjects: policy.subjects })
    } catch (reason) {
      setMessage(apiMessage(reason, "访问策略读取失败，请稍后重试。"))
    } finally {
      setAccessLoading(false)
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

  async function saveEditor(event: React.FormEvent) {
    event.preventDefault()
    if (!editor || !beginMutation(editor.board?.id ?? "create")) return
    setMessage("")
    try {
      if (editor.mode === "edit" && editor.section === "access" && editor.board && accessPolicy && accessDraft) {
        await putAdminContentAccessPolicy("board", editor.board.id, {
          ...accessDraft,
          expectedRevision: accessPolicy.revision,
        }, csrfToken)
        setEditor(null)
        setMessage("访问策略已保存")
      } else if (editor.mode === "create") {
        const saved = await createAdminBoard(draft, csrfToken)
        const synchronized = await refreshBoards()
        if (saved.parentId) setExpandedIds((current) => new Set(current).add(saved.parentId as string))
        setMessage(synchronized ? "版块已创建" : "版块已创建，但列表刷新失败，请刷新页面。")
        setEditor(null)
      } else if (editor.board) {
        const saved = await updateAdminBoard(editor.board.id, toUpdateInput(editor.board, draft), csrfToken)
        const synchronized = await refreshBoards()
        setFeedback({ boardId: saved.id, message: synchronized ? `${saved.name}的设置已保存` : `${saved.name}已保存，列表同步失败`, kind: synchronized ? "success" : "error" })
        setEditor(null)
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
      {message && <p className={message.includes("失败") ? "form-alert" : "admin-success"} role={message.includes("失败") ? "alert" : "status"}>{message}</p>}
      {editor && <BoardEditor editor={editor} draft={draft} accessPolicy={accessPolicy} accessDraft={accessDraft} accessLoading={accessLoading} saving={pendingId !== null} conflict={revisionConflict} error={message} onDraft={setDraft} onAccessDraft={setAccessDraft} onCancel={() => { setEditor(null); setRevisionConflict(false) }} onRefresh={() => void refreshEditorConflict()} onSubmit={saveEditor} parentName={boards.find((board) => board.id === editor.parentId)?.name ?? null} />}
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

function BoardEditor({ editor, draft, accessPolicy, accessDraft, accessLoading, saving, conflict, error, onDraft, onAccessDraft, onCancel, onRefresh, onSubmit, parentName }: { editor: BoardEditorState; draft: AdminBoardInput; accessPolicy: AdminContentAccessPolicy | null; accessDraft: AccessPolicyDraft | null; accessLoading: boolean; saving: boolean; conflict: boolean; error: string; onDraft: (draft: AdminBoardInput) => void; onAccessDraft: (draft: AccessPolicyDraft | null) => void; onCancel: () => void; onRefresh: () => void; onSubmit: (event: React.FormEvent) => void; parentName: string | null }) {
  const heading = editor.mode === "edit" ? `编辑“${editor.board?.name ?? "版块"}”` : parentName ? `在“${parentName}”下新增子版块` : "新建顶级版块"
  return <Drawer title={heading} description={editor.board ? `当前 revision ${editor.board.revision}` : "创建后可继续配置访问策略和治理人员"} onClose={onCancel} busy={saving}><form className="admin-form admin-board-editor" onSubmit={onSubmit}>
    <nav className="admin-board-editor__sections" aria-label="版块设置分区"><a href="#board-basic">基本信息</a><a href="#board-content">内容规则</a><a href="#board-access">访问权限</a><a href="#board-governance">治理人员</a><a href="#board-danger">危险操作</a></nav>
    <fieldset id="board-basic"><legend>基本信息</legend>
    <div className="admin-form__grid"><label><span>版块名称</span><input value={draft.name} onChange={(event) => onDraft({ ...draft, name: event.target.value })} maxLength={80} required /></label><label><span>版块 Slug</span><input value={draft.slug} onChange={(event) => onDraft({ ...draft, slug: event.target.value })} maxLength={80} required /></label></div>
    <label><span>版块描述</span><textarea rows={2} value={draft.description} onChange={(event) => onDraft({ ...draft, description: event.target.value })} maxLength={280} /></label>
    <div className="admin-form__grid"><label><span>图标 Slug</span><input value={draft.icon} onChange={(event) => onDraft({ ...draft, icon: event.target.value })} maxLength={32} required /></label><label><span>色调</span><select value={draft.tone} onChange={(event) => onDraft({ ...draft, tone: event.target.value as BoardTone })}><option value="green">绿色</option><option value="blue">蓝色</option><option value="amber">琥珀</option><option value="rose">玫红</option></select></label></div>
    <label><span>可见状态（与访问策略分离）</span><select value={draft.visibility} onChange={(event) => onDraft({ ...draft, visibility: event.target.value as AdminBoardVisibility })}><option value="public">公开</option><option value="hidden">隐藏</option></select></label></fieldset>
    <fieldset id="board-content"><legend>内容规则</legend><p>主题、回复和附件规则沿用服务端社区权限与版块限制。</p></fieldset>
    <fieldset id="board-access"><legend>访问权限</legend>
      {editor.mode === "create" && <p>创建版块后可配置访问策略。</p>}
      {editor.mode === "edit" && accessLoading && <p role="status">正在加载访问策略…</p>}
      {editor.mode === "edit" && accessDraft && <>
        <label><span>匹配方式</span><select aria-label="访问策略匹配方式" value={accessDraft.operator} onChange={(event) => onAccessDraft({ ...accessDraft, operator: event.target.value as ContentAccessOperator })}><option value="any_of">满足任一主体</option><option value="all_of">满足全部主体</option></select></label>
        {accessDraft.subjects.map((subject, index) => <div className="admin-form__grid" key={`${index}-${subject.subjectType}`}>
          <label><span>访问主体 {index + 1}</span><select aria-label={`访问主体 ${index + 1}`} value={subject.subjectType} onChange={(event) => onAccessDraft({ ...accessDraft, subjects: accessDraft.subjects.map((item, itemIndex) => itemIndex === index ? emptyAccessSubject(event.target.value as ContentAccessSubjectType) : item) })}><option value="public">所有访客</option><option value="authenticated">已登录用户</option><option value="community_group">社区用户组</option><option value="entitlement">标准权益</option><option value="governance">治理人员</option></select></label>
          {subject.subjectType === "community_group" && <label><span>社区用户组 ID</span><input aria-label={`社区用户组 ID ${index + 1}`} value={subject.communityGroupId ?? ""} onChange={(event) => onAccessDraft({ ...accessDraft, subjects: accessDraft.subjects.map((item, itemIndex) => itemIndex === index ? { ...item, communityGroupId: event.target.value } : item) })} required /></label>}
          {subject.subjectType === "entitlement" && <label><span>标准权益 Key</span><input aria-label={`标准权益 Key ${index + 1}`} value={subject.subjectKey ?? ""} onChange={(event) => onAccessDraft({ ...accessDraft, subjects: accessDraft.subjects.map((item, itemIndex) => itemIndex === index ? { ...item, subjectKey: event.target.value } : item) })} required /></label>}
          {accessDraft.subjects.length > 1 && <button className="secondary-button" type="button" onClick={() => onAccessDraft({ ...accessDraft, subjects: accessDraft.subjects.filter((_, itemIndex) => itemIndex !== index) })}>移除主体 {index + 1}</button>}
        </div>)}
        <button className="secondary-button" type="button" onClick={() => onAccessDraft({ ...accessDraft, subjects: [...accessDraft.subjects, emptyAccessSubject("authenticated")] })}>添加访问主体</button>
        {accessPolicy && <p>当前访问策略 revision {accessPolicy.revision}</p>}
      </>}
    </fieldset>
    <fieldset id="board-governance"><legend>治理人员</legend><p>治理角色继续使用 RBAC 与版块 scope，不写入社区用户组或标准权益。</p></fieldset>
    <fieldset id="board-danger"><legend>危险操作</legend><p>合并和删除必须先读取影响预览，并返回审计编号。</p></fieldset>
    {conflict && <RevisionConflictNotice onRefresh={onRefresh} />}{error && !conflict && <p className="form-alert" role="alert">{error}</p>}
    <button className="primary-button" type="submit" disabled={saving || (editor.section === "access" && (accessLoading || !accessDraft))}>{saving && <LoaderCircle className="topic-loading__spinner" size={15} aria-hidden="true" />}{editor.section === "access" ? "保存访问策略" : editor.mode === "edit" ? "保存版块" : editor.parentId ? "创建子版块" : "创建顶级版块"}</button>
  </form></Drawer>
}

function emptyDraft(parentId: string | null, position: number): AdminBoardInput { return { parentId, slug: "", name: "", description: "", icon: "messages", tone: "green", position, visibility: "public" } }
function emptyAccessSubject(subjectType: ContentAccessSubjectType) { return { subjectType, communityGroupId: null, subjectKey: null } }
function rootBoards(boards: AdminBoard[]) { return siblingBoards(boards, null) }
function siblingBoards(boards: AdminBoard[], parentId: string | null) { return boards.filter((board) => board.parentId === parentId).sort(compareBoards) }
function toUpdateInput(board: AdminBoard, changes: Partial<AdminBoardInput>): AdminBoardUpdateInput { return { parentId: changes.parentId === undefined ? board.parentId : changes.parentId, slug: changes.slug ?? board.slug, name: changes.name ?? board.name, description: changes.description ?? board.description, icon: changes.icon ?? board.icon, tone: changes.tone ?? board.tone, position: changes.position ?? board.position, visibility: changes.visibility ?? board.visibility, expectedRevision: board.revision } }
function toggleSet(values: Set<string>, value: string) { const next = new Set(values); if (next.has(value)) next.delete(value); else next.add(value); return next }
function apiMessage(reason: unknown, fallback: string) { return reason instanceof AdminApiError ? reason.message : fallback }
function mergeBlockedReasonMessage(reason: NonNullable<AdminBoardMergeImpact["blockedReason"]>) { return ({ same_board: "源版块和目标版块不能相同。", target_descendant: "目标版块不能是源版块的子版块。", source_has_children: "源版块仍有子版块，请先迁移子版块。", topic_limit_exceeded: "合并后的主题数量超过 5000 条限制。", source_unavailable: "源版块当前不可合并。", target_unavailable: "目标版块当前不可接收合并。" })[reason] }
