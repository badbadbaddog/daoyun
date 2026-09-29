import { Award, Pencil, Plus, RefreshCw, Search, Trash2, X } from "lucide-react"
import { useEffect, useId, useRef, useState, type FormEvent } from "react"
import { AdminApiError, createMembershipMedalRule, deleteMembershipMedalRule, updateMembershipMedalRule, uploadMembershipMedalAsset, type MembershipMedalRule, type MembershipMedalRuleInput } from "../../api/admin"
import { ModalDialog } from "../../components/ui/ModalDialog"
import { ConfirmDialog } from "../../components/ui/ConfirmDialog"

interface MedalsWorkspaceProps {
  rules: MembershipMedalRule[]
  canWrite: boolean
  csrfToken: string
  onChange: (rules: MembershipMedalRule[]) => void
  onRefresh: () => Promise<MembershipMedalRule[]>
}

const emptyDraft = (): MembershipMedalRuleInput => ({ displayName: "", assetKey: "", enabled: false, requiredLifetimePoints: null })

export function MedalsWorkspace({ rules, canWrite, csrfToken, onChange, onRefresh }: MedalsWorkspaceProps) {
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState("all")
  const [editor, setEditor] = useState<{ rule: MembershipMedalRule | null; draft: MembershipMedalRuleInput; file?: File; uploadedUrl?: string } | null>(null)
  const [previewUrl, setPreviewUrl] = useState("")
  const [deletion, setDeletion] = useState<MembershipMedalRule | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [conflict, setConflict] = useState(false)
  const lock = useRef(false)
  const createRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const file = editor?.file
  useEffect(() => {
    if (!file) { setPreviewUrl(""); return }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  const selectedAssetUrl = previewUrl || editor?.uploadedUrl || editor?.rule?.assetUrl
  const filtered = rules.filter(rule => rule.displayName.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) && (filter === "all" || rule.enabled === (filter === "automatic")))

  function edit(rule: MembershipMedalRule | null) {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setError(""); setMessage(""); setConflict(false)
    setEditor({ rule, draft: rule ? { displayName: rule.displayName, assetKey: rule.assetKey, enabled: rule.enabled, requiredLifetimePoints: rule.requiredLifetimePoints } : emptyDraft() })
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!editor || !canWrite || lock.current) return
    if (!editor.draft.displayName.trim() || (editor.draft.enabled && (editor.draft.requiredLifetimePoints === null || !Number.isSafeInteger(editor.draft.requiredLifetimePoints) || editor.draft.requiredLifetimePoints < 0))) {
      setError("请填写名称，并为自动授予设置非负的整数积分阈值。"); return
    }
    if (!editor.file && !editor.draft.assetKey) { setError("请上传勋章图标。"); return }
    lock.current = true; setBusy(true); setError("")
    try {
      const draft = { ...editor.draft, requiredLifetimePoints: editor.draft.enabled ? editor.draft.requiredLifetimePoints : null }
      if (editor.file) {
        const asset = await uploadMembershipMedalAsset(editor.file, csrfToken)
        draft.assetKey = asset.assetKey
        setEditor(current => current ? { ...current, file: undefined, uploadedUrl: asset.assetUrl, draft: { ...current.draft, assetKey: asset.assetKey } } : current)
      }
      const saved = editor.rule
        ? await updateMembershipMedalRule(editor.rule.key, { ...draft, expectedRevision: editor.rule.revision }, csrfToken)
        : await createMembershipMedalRule(draft, csrfToken)
      onChange(editor.rule ? rules.map(rule => rule.key === saved.key ? saved : rule) : [...rules, saved])
      setEditor(null); setMessage(`${saved.displayName} 已${editor.rule ? "保存" : "创建"}`)
    } catch (reason) {
      setConflict(reason instanceof AdminApiError && reason.code === "membership.medal_revision_conflict")
      setError(reason instanceof AdminApiError ? Object.values(reason.fields).flat().filter(Boolean).join("；") || reason.message : "勋章保存失败，请稍后重试。")
    } finally { lock.current = false; setBusy(false) }
  }

  async function refreshConflict() {
    if (lock.current) return
    lock.current = true; setBusy(true)
    try {
      const latest = await onRefresh()
      const current = latest.find(rule => rule.key === editor?.rule?.key)
      if (!current) { setError("该勋章已被删除，请关闭编辑窗口。"); return }
      setEditor(value => value ? { ...value, rule: current } : value)
      setConflict(false); setError("")
    } catch (reason) { setError(reason instanceof Error ? reason.message : "刷新失败，请重试。") }
    finally { lock.current = false; setBusy(false) }
  }

  async function remove() {
    if (!deletion || !canWrite || lock.current) return
    lock.current = true; setBusy(true); setError("")
    try {
      await deleteMembershipMedalRule(deletion.key, deletion.revision, csrfToken)
      onChange(rules.filter(rule => rule.key !== deletion.key))
      setMessage(`${deletion.displayName} 已从目录删除`); setDeletion(null)
      queueMicrotask(() => createRef.current?.focus())
    } catch (reason) { setError(reason instanceof AdminApiError ? reason.message : "删除失败，请重试。") }
    finally { lock.current = false; setBusy(false) }
  }

  return <>
    <div inert={editor || deletion ? true : undefined}>
      <div className="admin-catalog-toolbar medal-catalog-toolbar">
        <label className="admin-catalog-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="搜索勋章" placeholder="搜索勋章名称" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <select aria-label="勋章发放方式" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">全部发放方式</option><option value="manual">手动发放</option><option value="automatic">自动授予</option></select>
        <button type="button" className="icon-button" aria-label="刷新勋章" title="刷新勋章" disabled={busy} onClick={() => { setBusy(true); setError(""); void onRefresh().catch(reason => setError(reason instanceof Error ? reason.message : "刷新失败")).finally(() => setBusy(false)) }}><RefreshCw size={16} aria-hidden="true" /></button>
        {canWrite && <button ref={createRef} type="button" className="primary-button" onClick={() => edit(null)}><Plus size={16} aria-hidden="true" />新增勋章</button>}
      </div>
      {message && <p className="admin-success medal-catalog-notice" role="status">{message}</p>}
      {error && !editor && !deletion && <p className="form-alert medal-catalog-notice" role="alert">{error}</p>}
      <div className="medal-catalog-columns" aria-hidden="true"><span>勋章</span><span>发放方式</span><span>自动授予条件</span><span>操作</span></div>
      <ul className="membership-medal-list" aria-label="勋章规则列表">
        {filtered.map(rule => <li className="membership-medal-row medal-catalog-row" key={rule.key}>
          <header><span className="medal-artwork"><img src={rule.assetUrl} alt={rule.displayName} width="44" height="44" /></span><div><strong>{rule.displayName}</strong><small>社区荣誉勋章</small></div></header>
          <span className="admin-badge">{rule.enabled ? "自动 + 手动" : "手动发放"}</span>
          <span className="medal-threshold">{rule.enabled ? `累计积分 ≥ ${rule.requiredLifetimePoints?.toLocaleString("zh-CN")}` : "由管理员按需发放"}</span>
          <div className="medal-row-actions">{canWrite ? <><button type="button" className="admin-text-button" aria-label={`编辑 ${rule.displayName}`} onClick={() => edit(rule)}><Pencil size={14} aria-hidden="true" />编辑</button><button type="button" className="admin-text-button medal-delete-button" aria-label={`删除 ${rule.displayName}`} onClick={event => { returnFocusRef.current = event.currentTarget; setError(""); setDeletion(rule) }}><Trash2 size={14} aria-hidden="true" />删除</button></> : <span>只读</span>}</div>
        </li>)}
      </ul>
      {!filtered.length && <div className="admin-empty"><Award size={24} aria-hidden="true" /><span>{rules.length ? "没有匹配的勋章" : "尚未创建勋章"}</span></div>}
      <div className="admin-catalog-footer"><span>共 {rules.length} 枚勋章 · 显示 {filtered.length} 枚</span><span>删除目录项不会撤销成员已持有的勋章。</span></div>
    </div>
    {editor && <ModalDialog returnFocus={returnFocusRef.current} titleId={titleId} className="dialog-panel medal-editor admin-form" busy={busy} onClose={() => setEditor(null)} initialFocusSelector="input[name='medal-name']"><form className="medal-editor-form" onSubmit={save}>
      <div className="admin-form__heading"><div><h3 id={titleId}>{editor.rule ? "编辑勋章" : "新增勋章"}</h3><p>设置名称、图标和发放方式。</p></div><button className="icon-button" type="button" title="关闭" aria-label="关闭勋章编辑" disabled={busy} onClick={() => setEditor(null)}><X size={18} /></button></div>
      <fieldset disabled={busy} className="medal-editor-fields">
        <label><span>勋章名称</span><input name="medal-name" value={editor.draft.displayName} required maxLength={80} placeholder="例如：社区贡献者" onChange={event => setEditor({ ...editor, draft: { ...editor.draft, displayName: event.target.value } })} /></label>
        <div className="medal-upload">
          {selectedAssetUrl ? <img src={selectedAssetUrl} alt="当前勋章图标预览" width="72" height="72" /> : <span className="medal-upload-placeholder" aria-hidden="true"><Award size={32} /></span>}
          <div><strong>勋章图标</strong><label className="medal-upload-control"><span>{selectedAssetUrl ? "更换图片" : "选择图片"}</span><input aria-label="上传自定义图标" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => {
            const selected = event.target.files?.[0]
            event.target.value = ""
            if (!selected) return
            if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(selected.type) || !selected.size || selected.size > 2 * 1024 * 1024) {
              setError("请选择 PNG、JPEG、WebP 或 GIF 图片，文件不能为空且最大为 2 MB。"); return
            }
            setError(""); setEditor({ ...editor, file: selected })
          }} /></label><p>支持 PNG、JPEG、WebP、GIF，最大 2 MB，宽高不超过 1024px。</p><small>{editor.file ? `${editor.file.name} · 保存时上传` : editor.draft.assetKey ? "保留当前图标，重新上传可替换。" : "上传图片后即可预览。"}</small></div>
        </div>
        <label><span>发放方式</span><select aria-label="发放方式" value={editor.draft.enabled ? "automatic" : "manual"} onChange={event => setEditor({ ...editor, draft: { ...editor.draft, enabled: event.target.value === "automatic" } })}><option value="manual">仅手动发放</option><option value="automatic">按累计积分自动授予（也可手动发放）</option></select></label>
        {editor.draft.enabled && <label><span>累计积分阈值</span><input aria-label="累计积分阈值" type="number" min={0} step={1} required value={editor.draft.requiredLifetimePoints ?? ""} onChange={event => setEditor({ ...editor, draft: { ...editor.draft, requiredLifetimePoints: event.target.value === "" ? null : Number(event.target.value) } })} /><small>在后续积分增长达到条件时授予，不会增加 EXP。</small></label>}
      </fieldset>
      {error && <p className="form-alert" role="alert">{error}</p>}
      {conflict && <button className="secondary-button" type="button" disabled={busy} onClick={() => void refreshConflict()}>刷新版本并保留草稿</button>}
      <div className="admin-editor-footer"><button className="secondary-button" type="button" disabled={busy} onClick={() => setEditor(null)}>取消</button><button className="primary-button" type="submit" disabled={busy || conflict}>{busy ? "正在保存" : editor.rule ? "保存勋章" : "创建勋章"}</button></div>
    </form></ModalDialog>}
    {deletion && <ConfirmDialog returnFocus={returnFocusRef.current} title="删除勋章" confirmLabel="确认删除" busy={busy} onCancel={() => setDeletion(null)} onConfirm={() => void remove()}>
      <p>确定从目录删除“{deletion.displayName}”？删除后不能继续发放，自动授予也会停止。</p><p>成员已持有的勋章与历史记录会保留。如需移除某位成员的勋章，请在操作记录中撤销。</p>
      {error && <p className="form-alert" role="alert">{error}</p>}
    </ConfirmDialog>}
  </>
}
