import {getPollPolicy,isPollInput,type PollInput} from "../api/polls"
import {PollEditor,newPoll} from "./PollEditor"
import { ArrowLeft, ArrowRight, ImagePlus, LoaderCircle, Send, Trash2, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { uploadDraftImage } from "../api/attachments"
import { getBoard, type BoardViewerCapabilities } from "../api/boards"
import { isSessionExpiredError, type AuthSession } from "../api/auth"
import { createPost, type CreatePostInput } from "../api/posts"
import { TopicApiError } from "../api/topics"
import { attachmentThumbnailUrl, isRichTextDocument, plainTextDocument, sanitizeRichContent, toPlainText, type RichTextDocument, type RichTextNode } from "../editor/richContent"
import type { Board, Topic, TopicTag } from "../types/community"
import { extractTopicTags } from "../utils/tags"
import { RichTextEditor } from "./RichTextEditor"
import { DraftShelf, type DraftHandle } from "./DraftShelf"
import { ConfirmDialog } from "./ui/ConfirmDialog"

interface TopicComposerProps {
  open: boolean
  boards: Board[]
  session: AuthSession | null
  suspended?: boolean
  onSessionExpired?: () => void
  onLogin?: () => void
  availableTags?: TopicTag[]
  defaultBoardId?: string | null
  onClose: () => void
  onPublished: (topic: Topic) => void
}

interface ComposerImage {
  attachmentId: string
  fileName: string
  expiresAt?: string
  uploadId?: string
  file?: File
  status?: "pending" | "uploading" | "failed"
  error?: string
  percent?: number
}

interface PendingPublication { idempotencyKey: string; input: CreatePostInput; draftSnapshot: string }

interface ComposerDraft {
  publication?: PendingPublication | null
  poll?: PollInput | null
  version: 2
  title: string
  richContent: RichTextDocument
  images: ComposerImage[]
  boardId: string
  savedAt: string
}

interface UploadStatus {
  current: number
  total: number
  percent: number
}

type FieldErrors = Record<string, string[]>
type LocalSaveResult = { ok: true; savedAt: string } | { ok: false }

const MAX_TOPIC_IMAGES = 9
const DRAFT_SAVE_DELAY_MS = 150
const DRAFT_IMAGE_FALLBACK_RETENTION_MS = 24 * 60 * 60 * 1_000

export function TopicComposer({ open, boards, session, suspended = false, onSessionExpired, onLogin, availableTags = [], defaultBoardId = null, onClose, onPublished }: TopicComposerProps) {
  const serverDraftRef = useRef<DraftHandle>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const replacementInputRef = useRef<HTMLInputElement>(null)
  const replacementImageRef = useRef<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const recoveryButtonRef = useRef<HTMLButtonElement>(null)
  const submittingRef = useRef(false)
  const uploadingRef = useRef(false)
  const closeConfirmationOpenRef = useRef(false)
  const idempotencyKeyRef = useRef<string | null>(null)
  const publicationRef = useRef<PendingPublication | null>(null)
  const copyRef = useRef<HTMLTextAreaElement>(null)
  const [publicationPending, setPublicationPending] = useState(false)
  const [copyFallback, setCopyFallback] = useState(false)
  const [copyMessage, setCopyMessage] = useState("")
  const uploadControllerRef = useRef<AbortController | null>(null)
  const operationControllerRef = useRef<AbortController | null>(null)
  const operationScopeRef = useRef("")
  const requestCloseRef = useRef<() => void>(() => undefined)
  const [poll, setPoll] = useState<PollInput | null>(null)
  const [canCreatePoll, setCanCreatePoll] = useState(false)
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [richContent, setRichContent] = useState<RichTextDocument>(() => plainTextDocument(""))
  const [images, setImages] = useState<ComposerImage[]>([])
  const [draggedImageId, setDraggedImageId] = useState<string | null>(null)
  const [uploadStatus, setUploadStatus] = useState<UploadStatus | null>(null)
  const [imageError, setImageError] = useState("")
  const [boardId, setBoardId] = useState("")
  const [boardPermission, setBoardPermission] = useState<{ scope: string; viewer: BoardViewerCapabilities | null; failed: boolean } | null>(null)
  const [permissionRetry, setPermissionRetry] = useState(0)
  const [restoredDraftKey, setRestoredDraftKey] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [closing, setClosing] = useState(false)
  const [localSave, setLocalSave] = useState<{ key: string; snapshot: string; savedAt: string | null; ok: boolean }>({ key: "", snapshot: "", savedAt: null, ok: false })
  const [closeError, setCloseError] = useState("")
  const [closeConfirmation, setCloseConfirmation] = useState<{ returnFocus: HTMLElement | null } | null>(null)
  const uploading = uploadStatus !== null
  const embeddedImageCount = countImages(richContent)
  const imageCount = embeddedImageCount + images.length
  const uploadedImageCount = embeddedImageCount + images.filter(image => image.attachmentId).length
  const unresolvedImages = images.some(image => !image.attachmentId)
  const busy = submitting || uploading || closing
  const editingLocked = busy
  submittingRef.current = submitting || closing
  uploadingRef.current = uploading
  closeConfirmationOpenRef.current = closeConfirmation !== null
  requestCloseRef.current = requestClose
  const currentDraftRef = useRef({ title, richContent, images, boardId, poll })
  currentDraftRef.current = { title, richContent, images, boardId, poll }
  const draftSnapshot = composerDraftSnapshot(currentDraftRef.current)
  const expiredTokenRef = useRef<string | null>(null)
  const [expiredSession, setExpiredSession] = useState<{ ownerId: string; csrfToken: string } | null>(null)
  const sessionExpired = Boolean(expiredSession && (!session || (session.user.id === expiredSession.ownerId && session.csrfToken === expiredSession.csrfToken)))
  const draftOwnerId = session?.user.id ?? expiredSession?.ownerId
  const draftKey = useMemo(
    () => `daoyun:composer-draft:v2:${draftOwnerId ?? "guest"}:${defaultBoardId ?? "global"}`,
    [defaultBoardId, draftOwnerId],
  )

  const selectedBoard = useMemo(
    () => boards.find((board) => board.id === boardId) ?? boards[0],
    [boardId, boards],
  )

  const permissionScope = JSON.stringify([open, session?.user.id, session?.csrfToken, selectedBoard?.id, selectedBoard?.slug, sessionExpired])
  const currentPermission = boardPermission?.scope === permissionScope ? boardPermission : null
  const boardCapabilities = currentPermission?.viewer
  const canUploadImages = Boolean(!publicationPending && !sessionExpired && session && boardCapabilities?.canCreateTopic && boardCapabilities.canUploadAttachment)
  const publicationBlocked = sessionExpired || Boolean(session && (!boardCapabilities?.canCreateTopic || (imageCount > 0 && !boardCapabilities.canUploadAttachment)))
  const permissionMessage = !session || sessionExpired ? "" : currentPermission?.failed
    ? "版块权限暂时不可用，请重试；草稿内容已保留。"
    : !boardCapabilities ? "正在检查版块权限…"
    : !boardCapabilities.canCreateTopic ? "当前版块不可发布；草稿内容已保留。"
    : !boardCapabilities.canUploadAttachment ? "当前版块不允许上传图片；已选图片仍保留，可移除图片或切换版块。" : ""

  useEffect(() => {
    if (uploadControllerRef.current) cancelUpload()
    if (!open || !session || sessionExpired || !selectedBoard) return
    const controller = new AbortController()
    setBoardPermission({ scope: permissionScope, viewer: null, failed: false })
    getBoard(selectedBoard.slug, controller.signal).then(board => {
      if (!controller.signal.aborted) setBoardPermission({ scope: permissionScope, viewer: board.viewer, failed: false })
    }).catch(error => {
      if (controller.signal.aborted) return
      if (isSessionExpiredError(error)) { expireSession(); return }
      if (!controller.signal.aborted) setBoardPermission({ scope: permissionScope, viewer: null, failed: true })
    })
    return () => controller.abort()
  }, [permissionScope, permissionRetry])

  const operationScope = JSON.stringify([open, draftKey, session?.csrfToken, selectedBoard?.id, sessionExpired])
  operationScopeRef.current = operationScope
  useEffect(() => {
    setSubmitting(false)
    setClosing(false)
    setCloseConfirmation(null)
    return () => operationControllerRef.current?.abort()
  }, [operationScope])


  useEffect(() => {
    if (!open || sessionExpired || boards.length === 0) return
    setBoardId((current) => {
      const preferred = defaultBoardId && boards.some((board) => board.id === defaultBoardId)
        ? defaultBoardId
        : null
      const next = boards.some((board) => board.id === current) ? current : preferred ?? boards[0]?.id ?? ""
      if (next !== current) idempotencyKeyRef.current = null
      return next
    })
    setFieldErrors({})
    setFormError("")
  }, [boards, defaultBoardId, open, sessionExpired])

  useEffect(() => () => uploadControllerRef.current?.abort(), [])
  useEffect(() => {
    setCanCreatePoll(false)
    if(!open || !session || sessionExpired) return
    const controller=new AbortController()
    getPollPolicy(controller.signal).then(policy=>{if(!controller.signal.aborted)setCanCreatePoll(policy.can_create)}).catch(()=>undefined)
    return()=>controller.abort()
  },[open,session?.user.id,session?.csrfToken,sessionExpired])

  useEffect(() => {
    if (!open || restoredDraftKey === draftKey) return
    if (restoredDraftKey) {
      writeComposerDraft(restoredDraftKey, { ...currentDraftRef.current, publication: publicationRef.current })
    }
    uploadControllerRef.current?.abort()
    uploadControllerRef.current = null
    uploadingRef.current = false
    replacementImageRef.current = null
    setUploadStatus(null)
    setImageError("")
    const draft = readComposerDraft(draftKey, draftOwnerId)
    publicationRef.current = draft?.publication ?? null
    setPublicationPending(Boolean(publicationRef.current))
    setCopyFallback(false)
    setCopyMessage("")
    const nextRichContent = draft?.richContent ?? plainTextDocument("")
    setPoll(draft?.poll ?? null)
    setTitle(draft?.title ?? "")
    setRichContent(nextRichContent)
    setContent(toPlainText(nextRichContent))
    setImages(draft?.images ?? [])
    setBoardId(draft && boards.some((board) => board.id === draft.boardId)
      ? draft.boardId
      : defaultBoardId && boards.some((board) => board.id === defaultBoardId)
        ? defaultBoardId
        : boards[0]?.id ?? "")
    setFieldErrors({})
    setFormError("")
    idempotencyKeyRef.current = null
    setRestoredDraftKey(draftKey)
  }, [boardId, boards, defaultBoardId, draftKey, images, open, restoredDraftKey, richContent, title, poll, draftOwnerId])

  useEffect(() => {
    if (!open || restoredDraftKey !== draftKey) return
    const timer = window.setTimeout(() => {
      saveLocalDraft({ title, richContent, images, boardId, poll })
    }, DRAFT_SAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [boardId, draftKey, images, open, restoredDraftKey, richContent, title, poll])

  useEffect(() => {
    if (open) return
    uploadControllerRef.current?.abort()
    uploadControllerRef.current = null
    uploadingRef.current = false
    setPoll(null)
    setTitle("")
    setContent("")
    setRichContent(plainTextDocument(""))
    setImages([])
    setDraggedImageId(null)
    setUploadStatus(null)
    setImageError("")
    setBoardId("")
    setRestoredDraftKey(null)
    setFieldErrors({})
    setFormError("")
    idempotencyKeyRef.current = null
    setExpiredSession(null)
    expiredTokenRef.current = null
  }, [open])

  useEffect(() => {
    if (!open || suspended) return

    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submittingRef.current && !uploadingRef.current && !closeConfirmationOpenRef.current) requestCloseRef.current()
    }
    const handleTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || closeConfirmationOpenRef.current) return
      const focusable = dialogRef.current
        ? Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
          .filter((element) => !element.hasAttribute("disabled") && element.tabIndex >= 0)
        : []
      if (focusable.length === 0) {
        event.preventDefault()
        return
      }
      const first = focusable[0]
      const last = focusable.at(-1) ?? first
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener("keydown", handleEscape)
    document.addEventListener("keydown", handleTab)
    return () => {
      document.removeEventListener("keydown", handleEscape)
      document.removeEventListener("keydown", handleTab)
      document.body.style.overflow = previousOverflow
      if (returnFocus?.isConnected) returnFocus.focus()
    }
  }, [open, suspended])

  useEffect(() => {
    if (session && expiredSession && (session.user.id !== expiredSession.ownerId || session.csrfToken !== expiredSession.csrfToken)) {
      setExpiredSession(null)
      expiredTokenRef.current = null
      setFormError("")
    }
  }, [session, expiredSession])

  useEffect(() => {
    if (sessionExpired && !suspended) queueMicrotask(() => recoveryButtonRef.current?.focus())
  }, [sessionExpired, suspended])

  function expireSession() {
    if (!session || sessionExpired || expiredTokenRef.current === session.csrfToken) return
    expiredTokenRef.current = session.csrfToken
    saveLocalDraft()
    cancelUpload()
    setExpiredSession({ ownerId: session.user.id, csrfToken: session.csrfToken })
    setFormError("")
    setFieldErrors({})
    onSessionExpired?.()
  }

  function saveLocalDraft(value = currentDraftRef.current): LocalSaveResult {
    const result = writeComposerDraft(draftKey, { ...value, publication: publicationRef.current })
    const hasDraftContent = Boolean(value.title.trim() || toPlainText(value.richContent).trim() || value.images.length || value.poll || publicationRef.current)
    setLocalSave(previous => ({ key: draftKey, snapshot: composerDraftSnapshot(value),
      savedAt: result.ok ? hasDraftContent ? result.savedAt : null : previous.key === draftKey ? previous.savedAt : null, ok: result.ok }))
    return result
  }

  useEffect(() => {
    if (!open) return
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const hasContent = Boolean(title.trim() || content.trim() || images.length || poll || publicationRef.current)
      if (hasContent && (publicationRef.current || unresolvedImages || !(localSave.key === draftKey && localSave.snapshot === draftSnapshot && localSave.ok) && !serverDraftRef.current?.isSaved())) {
        event.preventDefault()
        event.returnValue = ""
      }
    }
    window.addEventListener("beforeunload", beforeUnload)
    return () => window.removeEventListener("beforeunload", beforeUnload)
  }, [open, title, content, images, poll, unresolvedImages, localSave, draftKey, draftSnapshot])

  useEffect(() => { if (copyFallback) { copyRef.current?.focus(); copyRef.current?.select() } }, [copyFallback])

  async function copyBody() {
    try { await navigator.clipboard.writeText(content); setCopyMessage("正文已复制") }
    catch { setCopyFallback(true); setCopyMessage("请选择并手动复制下方正文") }
  }

  function requestClose() {
    saveLocalDraft()
    setCloseError("")
    const hasUnsavedChanges = Boolean(title.trim() || content.trim() || images.length || poll || publicationRef.current)
    if (hasUnsavedChanges) {
      setCloseConfirmation({
        returnFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      })
      return
    }
    performClose()
  }

  function performClose(clearDraft = false) {
    if (clearDraft) { serverDraftRef.current?.complete(); removeComposerDraft(draftKey) }
    else saveLocalDraft()
    uploadControllerRef.current?.abort()
    uploadControllerRef.current = null
    uploadingRef.current = false
    setPoll(null)
    setTitle("")
    setContent("")
    setRichContent(plainTextDocument(""))
    setImages([])
    setDraggedImageId(null)
    setUploadStatus(null)
    setImageError("")
    setBoardId("")
    setRestoredDraftKey(null)
    setFieldErrors({})
    setFormError("")
    idempotencyKeyRef.current = null
    publicationRef.current = null
    setPublicationPending(false)
    onClose()
  }

  function validate(): FieldErrors {
    const errors: FieldErrors = {}
    if (countCharacters(title.trim()) > 160) errors.title = ["标题最多 160 个字符"]
    if (countCharacters(content.trim()) < 1) errors.content = ["请输入正文"]
    if (unresolvedImages) errors.images = ["请先重试或移除未完成的图片"]
    if (imageCount > MAX_TOPIC_IMAGES) errors.rich_content = ["最多上传 9 张图片，请移除多余图片"]
    if (poll && !canCreatePoll) errors.poll = ["投票功能未启用或当前账号没有创建权限，请移除投票后发布"]
    return errors
  }


  async function addImages(files: File[]) {
    if (uploadingRef.current || files.length === 0) return
    if (!session) {
      setImageError("请先登录后上传图片")
      return
    }
    if (!canUploadImages) {
      setImageError(permissionMessage)
      return
    }
    const remaining = MAX_TOPIC_IMAGES - imageCount
    if (remaining <= 0) {
      setImageError("最多上传 9 张图片")
      return
    }
    const selected = files.slice(0, remaining).map(file => ({
      attachmentId: "",
      fileName: file.name,
      uploadId: createIdempotencyKey(),
      file,
      status: "pending" as const,
    }))
    setImageError(files.length > remaining ? "最多上传 9 张图片" : "")
    setImages(current => [...current, ...selected])
    idempotencyKeyRef.current = null
    await uploadImages(selected)
  }

  async function uploadImages(selected: ComposerImage[]) {
    if (uploadingRef.current || !session || !canUploadImages) return
    const controller = new AbortController()
    uploadControllerRef.current?.abort()
    uploadControllerRef.current = controller
    uploadingRef.current = true
    setUploadStatus({ current: 1, total: selected.length, percent: 0 })
    const updateImage = (image: ComposerImage, patch: Partial<ComposerImage>) => {
      setImages(current => current.map(item => imageKey(item) === imageKey(image) ? {...item, ...patch} : item))
    }
    try {
      for (let index = 0; index < selected.length; index += 1) {
        if (controller.signal.aborted || uploadControllerRef.current !== controller) break
        const image = selected[index]
        if (!image.file) continue
        updateImage(image, {status: "uploading", error: undefined, percent: 0})
        setUploadStatus({ current: index + 1, total: selected.length, percent: 0 })
        try {
          const attachment = await uploadDraftImage(image.file, session.csrfToken, percent => {
            if (!controller.signal.aborted && uploadControllerRef.current === controller) {
              setUploadStatus({current: index + 1, total: selected.length, percent})
              updateImage(image, {percent})
            }
          }, controller.signal)
          if (controller.signal.aborted || uploadControllerRef.current !== controller) break
          setImages(current => current.map(item => imageKey(item) === imageKey(image) ? {
            attachmentId: attachment.id,
            fileName: attachment.originalName || image.fileName,
            expiresAt: attachment.expiresAt,
            uploadId: image.uploadId,
          } : item))
          idempotencyKeyRef.current = null
        } catch (error) {
          if (!controller.signal.aborted && uploadControllerRef.current === controller) {
            updateImage(image, {status: "failed", error: error instanceof Error ? error.message : "图片上传失败，请重试"})
            if (isSessionExpiredError(error)) { expireSession(); break }
          }
        }
      }
    } finally {
      if (uploadControllerRef.current === controller) {
        uploadControllerRef.current = null
        uploadingRef.current = false
        setUploadStatus(null)
      }
    }
  }

  function cancelUpload() {
    uploadControllerRef.current?.abort()
    uploadControllerRef.current = null
    uploadingRef.current = false
    setUploadStatus(null)
    setImages(current => current.map(image => image.attachmentId ? image : {
      ...image, status: "failed", error: "上传已取消，可重试或移除",
    }))
  }

  function retryImage(image: ComposerImage) {
    if (busy || !canUploadImages) return
    setImageError("")
    if (image.file) {
      void uploadImages([image])
    } else {
      replacementImageRef.current = imageKey(image)
      replacementInputRef.current?.click()
    }
  }

  function moveImage(fromIndex: number, toIndex: number) {
    if (busy || fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || toIndex >= images.length) return
    setImages((current) => {
      const next = [...current]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return next
    })
    idempotencyKeyRef.current = null
  }

  function removeImage(index: number) {
    setImages((current) => current.filter((_, currentIndex) => currentIndex !== index))
    idempotencyKeyRef.current = null
    setImageError("")
  }

  async function submit() {
    if (submittingRef.current || busy || publicationBlocked) return
    const errors = publicationRef.current ? {} : validate()
    setFieldErrors(errors)
    setFormError("")
    if (Object.keys(errors).length > 0) return
    if (!session) {
      setFormError("请先登录后发布主题")
      return
    }

    const controller = new AbortController()
    operationControllerRef.current = controller
    const active = () => !controller.signal.aborted && operationScopeRef.current === operationScope
    submittingRef.current = true
    setSubmitting(true)
    try {
      let publication = publicationRef.current
      if (!publication) {
        const draft = await serverDraftRef.current?.flush()
        if (!active()) return
        const idempotencyKey = idempotencyKeyRef.current ?? createIdempotencyKey()
        idempotencyKeyRef.current = idempotencyKey
        const tags = extractTopicTags(content, availableTags)
        publication = { idempotencyKey, draftSnapshot: composerDraftSnapshot(currentDraftRef.current), input: {
          ...(title.trim() ? { title: title.trim() } : {}), content: content.trim(),
          ...(draft ? { draft } : {}), ...(poll ? { poll } : {}),
          richContent: withComposerImages(richContent, images), boardId: selectedBoard?.id,
          ...(tags.length > 0 ? { tags } : {}),
        } }
        publicationRef.current = publication
        setPublicationPending(true)
        saveLocalDraft()
      }
      const topic = await createPost(publication.input,
        { csrfToken: session.csrfToken, idempotencyKey: publication.idempotencyKey, signal: controller.signal })
      if (!active()) return
      const newerEdits = composerDraftSnapshot(currentDraftRef.current) !== publication.draftSnapshot
      if (newerEdits) {
        publicationRef.current = null
        setPublicationPending(false)
        serverDraftRef.current?.complete()
      }
      performClose(!newerEdits)
      onPublished(topic)
    } catch (error) {
      if (!active()) return
      if (isSessionExpiredError(error)) { expireSession(); return }
      if (error instanceof TopicApiError && error.status < 500) {
        publicationRef.current = null
        setPublicationPending(false)
        saveLocalDraft()
        setFieldErrors(error.fields)
        setFormError(error.fields.body?.[0] ?? error.message)
      } else {
        setFormError("主题服务暂时不可用，请稍后重试；未发布的正文仍保留")
      }
    } finally {
      if (active()) { submittingRef.current = false; setSubmitting(false) }
    }
  }

  const inputError = (field: string) => fieldErrors[field]?.[0]

  if (!open || suspended || restoredDraftKey !== draftKey) return null

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target && !busy && !closeConfirmation) requestClose()
    }}>
      <div ref={dialogRef} className="composer-dialog" role="dialog" aria-modal="true" aria-labelledby="composer-title">
        <div className="dialog-header">
          <div>
            <p>{selectedBoard?.name ?? "社区广场"}</p>
            <h2 id="composer-title">发布内容</h2>
          </div>
          <button className="icon-button" type="button" onClick={() => requestClose()} disabled={busy} aria-label="关闭发布窗口" title="关闭">
            <X size={19} aria-hidden="true" />
          </button>
        </div>
        <form className="dialog-body" aria-busy={busy} onSubmit={(event) => { event.preventDefault(); void submit() }}>
          <p role="status" aria-label="本机保存状态">{localSave.key !== draftKey || localSave.snapshot !== draftSnapshot ? "本机：等待保存" : localSave.ok ? `本机：已保存 ${localSave.savedAt ? new Date(localSave.savedAt).toLocaleTimeString() : ""}` : "本机保存失败，正文仍在当前窗口"}</p>
          {localSave.key === draftKey && !localSave.ok && localSave.savedAt && <small>上次本机成功保存：{new Date(localSave.savedAt).toLocaleTimeString()}；当前修改尚未保存到本机。</small>}
          {session && !sessionExpired && <DraftShelf key={draftKey} ref={serverDraftRef} ownerId={session.user.id} csrfToken={session.csrfToken} storageKey={draftKey} onSessionExpired={expireSession} recoveringPublication={publicationPending} ready={restoredDraftKey === draftKey} busy={editingLocked || publicationPending || unresolvedImages}
            content={{title,board_id:boardId || null,rich_content:richContent,images:images.filter(image=>image.attachmentId).map(({attachmentId,fileName})=>({attachmentId,fileName})),poll}}
            onRestore={draft=>{setPoll(isPollInput(draft.poll)?draft.poll:null);setTitle(draft.title);setRichContent(draft.rich_content);setContent(toPlainText(draft.rich_content));setImages(draft.images);setBoardId(draft.board_id??"");setFieldErrors({});setFormError("");idempotencyKeyRef.current=null;saveLocalDraft({title:draft.title,richContent:draft.rich_content,images:draft.images,boardId:draft.board_id??"",poll:isPollInput(draft.poll)?draft.poll:null})}} />}
          {sessionExpired && <div className="composer-form-error" role="alert">
            <p>登录已失效，正文和图片已保留。请使用原账号重新登录，再继续发布。</p>
            <button ref={recoveryButtonRef} className="secondary-button" type="button" onClick={onLogin}>重新登录</button>
          </div>}
          {boards.length > 1 && (
            <label>
              <span>板块</span>
              <select value={boardId} disabled={editingLocked} onChange={(event) => {
                setBoardId(event.target.value)
                idempotencyKeyRef.current = null
              }}>
                {boards.map((board) => <option value={board.id} key={board.id}>{board.name}</option>)}
              </select>
            </label>
          )}
          {permissionMessage && <p className="composer-field-error" role={currentPermission?.failed ? "alert" : "status"}>
            {permissionMessage}
            {currentPermission?.failed && <button className="secondary-button" type="button" disabled={busy} onClick={() => setPermissionRetry(value => value + 1)}>重试版块权限</button>}
          </p>}
          <label>
            <span>标题（可选）</span>
            <input
              type="text"
              value={title}
              maxLength={160}
              disabled={editingLocked}
              placeholder="一句话说明你想分享的内容"
              aria-invalid={inputError("title") ? "true" : undefined}
              aria-describedby={inputError("title") ? "composer-title-error" : undefined}
              onChange={(event) => {
                setTitle(event.target.value)
                idempotencyKeyRef.current = null
              }}
            />
            {inputError("title") && <p id="composer-title-error" className="composer-field-error">{inputError("title")}</p>}
          </label>

          {(canCreatePoll || poll) && <div className="composer-poll">
            {!poll ? <button className="secondary-button" type="button" disabled={busy} onClick={()=>{setPoll(newPoll());idempotencyKeyRef.current=null}}>添加单选投票</button> : <>
              <PollEditor value={poll} disabled={editingLocked || !canCreatePoll} onChange={value=>{setPoll(value);idempotencyKeyRef.current=null}} />
              {!canCreatePoll && <p role="alert">投票插件未启用或创建权限不可用。草稿配置已保留；可移除投票后发布。</p>}
              <button className="secondary-button" type="button" disabled={busy} onClick={()=>{setPoll(null);idempotencyKeyRef.current=null}}>移除投票</button>
            </>}
            {inputError("poll") && <p role="alert">{inputError("poll")}</p>}
          </div>}
          <div className="composer-image-field">
            <div className="composer-image-field__heading">
              <span className="composer-field__label">图片</span>
              <span>已上传 {uploadedImageCount} / {MAX_TOPIC_IMAGES} 张</span>
              {uploading && <button className="secondary-button composer-image-cancel" type="button" onClick={cancelUpload}>取消上传</button>}
            </div>
            <div
              className="composer-image-dropzone"
              data-testid="composer-image-dropzone"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                if (!busy) void addImages(Array.from(event.dataTransfer.files))
              }}
            >
              {images.length > 0 && (
                <ol className="composer-image-grid" aria-label="帖子图片">
                  {images.map((image, index) => (
                    <li
                      className={draggedImageId === imageKey(image) ? "composer-image-item composer-image-item--dragging" : "composer-image-item"}
                      key={imageKey(image)}
                      draggable={!busy}
                      onDragStart={(event) => {
                        setDraggedImageId(imageKey(image))
                        event.dataTransfer.setData("text/plain", imageKey(image))
                      }}
                      onDragEnd={() => setDraggedImageId(null)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        if (busy) return
                        if (event.dataTransfer.files.length > 0) {
                          void addImages(Array.from(event.dataTransfer.files))
                          return
                        }
                        const sourceId = event.dataTransfer.getData("text/plain") || draggedImageId
                        const sourceIndex = images.findIndex((item) => imageKey(item) === sourceId)
                        moveImage(sourceIndex, index)
                        setDraggedImageId(null)
                      }}
                    >

                      <div className="composer-image-item__preview">
                        {image.attachmentId
                          ? <img src={attachmentThumbnailUrl(image.attachmentId) ?? ""} alt={image.fileName} />
                          : <div className="composer-image-item__placeholder">
                            <ImagePlus size={22} aria-hidden="true" />
                            <span>{image.fileName}</span>
                          </div>}
                        <span className="composer-image-item__number">{index + 1}</span>
                        {index === 0 && <span className="composer-image-item__primary">主图</span>}
                      </div>
                      <div className="composer-image-item__status">
                        {image.status === "failed" ? <p role="alert">{image.error}</p> : <span role="status">
                          {image.status === "pending" ? "等待上传" : image.status === "uploading"
                            ? image.percent === 99 ? "图片已上传，正在处理" : `上传中 ${image.percent ?? 0}%`
                            : "上传成功"}
                        </span>}
                        {image.status === "failed" && <button type="button" disabled={busy || !canUploadImages}
                          aria-label={`${image.file ? "重试" : "重新选择"}图片 ${index + 1}`}
                          onClick={() => retryImage(image)}>{image.file ? "重试" : "重新选择"}</button>}
                      </div>
                      <div className="composer-image-item__actions">
                        {([-1, 1] as const).map(direction => <button
                          key={direction}
                          className="composer-image-item__sort"
                          type="button"
                          disabled={busy}
                          aria-disabled={direction === -1 ? index === 0 : index === images.length - 1}
                          aria-label={`${direction === -1 ? "前移" : "后移"}图片 ${index + 1}`}
                          title={direction === -1 ? "前移图片，也可使用方向键" : "后移图片，也可使用方向键"}
                          onClick={() => moveImage(index, index + direction)}
                          onKeyDown={event => {
                            if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                              event.preventDefault()
                              moveImage(index, index - 1)
                            } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                              event.preventDefault()
                              moveImage(index, index + 1)
                            }
                          }}
                        >{direction === -1 ? <ArrowLeft size={16} aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />}</button>)}
                        <button className="composer-image-item__delete" type="button" disabled={busy}
                          aria-label={`删除图片 ${index + 1}`} title="删除图片" onClick={() => removeImage(index)}>
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                      </div>

                    </li>
                  ))}
                </ol>
              )}
              {imageCount < MAX_TOPIC_IMAGES && (
                <button
                  className="composer-image-upload"
                  type="button"
                  disabled={busy || !canUploadImages}
                  aria-label="上传图片"
                  onClick={() => imageInputRef.current?.click()}
                >
                  {uploading ? <LoaderCircle className="topic-loading__spinner" size={20} aria-hidden="true" /> : <ImagePlus size={20} aria-hidden="true" />}
                  <strong>{uploading ? `上传中 ${uploadStatus.percent}%` : "上传图片"}</strong>
                  <span>{uploading ? `${uploadStatus.current} / ${uploadStatus.total}` : "点击选择或拖拽到这里"}</span>
                </button>
              )}
              <input
                ref={imageInputRef}
                className="visually-hidden"
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                multiple
                aria-label="选择帖子图片"
                disabled={busy || !canUploadImages}
                onChange={(event) => {
                  void addImages(Array.from(event.target.files ?? []))
                  event.target.value = ""
                }}
              />
            </div>

              <input ref={replacementInputRef} className="visually-hidden" type="file"
                accept="image/png,image/jpeg,image/gif,image/webp" aria-label="重新选择失败图片" disabled={busy || !canUploadImages}
                onChange={event => {
                  const file = event.target.files?.[0]
                  const image = images.find(item => imageKey(item) === replacementImageRef.current)
                  event.target.value = ""
                  replacementImageRef.current = null
                  if (!file || !image || busy) return
                  const replacement = {...image, file, fileName: file.name}
                  setImages(current => current.map(item => imageKey(item) === imageKey(image) ? replacement : item))
                  idempotencyKeyRef.current = null
                  void uploadImages([replacement])
                }} />

            <div className="composer-image-field__help">
              <span>支持 JPG、PNG、GIF、WebP；拖动或用前移/后移按钮排序</span>
              <span>第一张为详情页主图，首页展示前 3 张</span>
            </div>
            {unresolvedImages && <p className="composer-field-error" role="status">未完成图片只保存在当前窗口，关闭后需重新选择；请重试或移除后发布并同步草稿。</p>}
            {imageError && <p className="composer-field-error" role="alert">{imageError}</p>}
          </div>

          <div className="composer-field">
            <span className="composer-field__label">正文</span>
            <RichTextEditor
              value={richContent}
              ariaLabel="正文"
              placeholder="补充背景和想法；输入 #标签 可自动归类"
              maxCharacters={1_000_000}
              autoFocus={!sessionExpired}
              showImageUpload={false}
              disabled={editingLocked}
              invalid={Boolean(inputError("content") || inputError("rich_content"))}
              errorMessageId={(inputError("content") || inputError("rich_content")) ? "composer-content-error" : undefined}
              onChange={(document, plainText) => {
                if (plainText !== content || JSON.stringify(document) !== JSON.stringify(richContent)) idempotencyKeyRef.current = null
                setRichContent(document)
                setContent(plainText)
              }}
            />
            {(inputError("content") || inputError("rich_content")) && <p id="composer-content-error" className="composer-field-error">{inputError("content") ?? inputError("rich_content")}</p>}
          </div>
          {inputError("tags") && <p id="composer-tags-error" className="composer-field-error">{inputError("tags")}</p>}
          {publicationPending && <p role="status">发布结果尚未确认，点击发布将重试原请求；期间的新修改会另行保留为草稿。</p>}
          <button className="secondary-button" type="button" onClick={() => void copyBody()}>复制正文</button>
          {copyMessage && <p role="status">{copyMessage}</p>}
          {copyFallback && <label><span>手动复制正文</span><textarea ref={copyRef} readOnly value={content} /></label>}
          {formError && <p className="composer-form-error" role="alert">{formError}</p>}
          <div className="dialog-toolbar">
            <span className="dialog-toolbar__hint">正文输入 #标签 · 最多 9 张图片</span>
            <button className="primary-button" type="submit" disabled={busy || unresolvedImages || publicationBlocked}>
              {submitting ? <LoaderCircle className="topic-loading__spinner" size={16} aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
              {closing ? "正在保存" : submitting ? "正在发布" : uploading ? "正在上传" : "发布"}
            </button>
          </div>
        </form>
      </div>
      {closeConfirmation && <ConfirmDialog
        title="关闭发布窗口？"
        confirmLabel="确认关闭"
        busy={busy}
        returnFocus={closeConfirmation.returnFocus}
        onCancel={() => setCloseConfirmation(null)}
        onConfirm={() => {
          const controller = new AbortController()
          operationControllerRef.current = controller
          setClosing(true)
          void (unresolvedImages || publicationRef.current ? Promise.resolve() : serverDraftRef.current?.flush() ?? Promise.resolve()).catch(() => undefined).finally(() => {
            if (controller.signal.aborted || operationScopeRef.current !== operationScope) return
            const local = saveLocalDraft()
            if (!local.ok && (publicationRef.current || !serverDraftRef.current?.isSaved())) {
              setCloseError(publicationRef.current ? "发布结果尚未确认，恢复请求未能保存到本机，请先重试确认结果或复制正文。" : "本机和云端均未保存，请继续编辑、重试或复制正文。")
              setClosing(false)
              return
            }
            setCloseConfirmation(null)
            performClose()
            setClosing(false)
          })
        }}
      >
        <p>{localSave.key === draftKey && localSave.snapshot === draftSnapshot && localSave.ok
          ? "当前内容已保存为本地草稿，下次打开时可继续编辑。"
          : serverDraftRef.current?.isSaved() ? "本机保存失败，云端已保存；重新打开后可从草稿箱继续编辑。" : "本机保存失败；关闭前将尝试同步云端，未保存内容仍保留在窗口中。"}</p>
        {publicationPending && <p>发布结果尚未确认；重新打开后必须先重试原请求。</p>}
        {unresolvedImages && <p>未上传图片尚未持久保存，关闭后需要重新选择文件。</p>}
        {closeError && <><p role="alert">{closeError}</p>
          <button className="danger-button" type="button" disabled={busy} onClick={() => { setCloseConfirmation(null); performClose() }}>放弃未保存内容并关闭</button>
          {publicationPending && <p>原发布可能已经成功，放弃恢复后请先检查帖子，避免再次发布相同内容。</p>}</>}
        <p>确认关闭编辑窗口吗？</p>
      </ConfirmDialog>}
    </div>
  )
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",")

function imageKey(image: ComposerImage): string {
  return image.uploadId ?? image.attachmentId
}

function countImages(node: RichTextNode): number {
  return (node.type === "image" ? 1 : 0) + (node.content?.reduce((count, child) => count + countImages(child), 0) ?? 0)
}

function withComposerImages(document: RichTextDocument, images: ComposerImage[]): RichTextDocument {
  return {
    type: "doc",
    content: [
      ...document.content,
      ...images.map((image) => ({
        type: "image",
        attrs: { attachmentId: image.attachmentId, alt: image.fileName },
      })),
    ],
  }
}

function readComposerDraft(key: string, ownerId?: string): ComposerDraft | null {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? "null")
    if (!value || typeof value !== "object" || (value as { version?: unknown }).version !== 2) return null
    const record = value as Record<string, unknown>
    const server = ownerId ? JSON.parse(window.localStorage.getItem(key + ":server:" + ownerId) ?? "null") : null
    const serverReferenced = server && Number.isSafeInteger(server.revision) && server.revision > 0
    const richContent = sanitizeRichContent(record.richContent)
    const savedAt = typeof record.savedAt === "string" ? record.savedAt : ""
    const fallbackImagesFresh = Number.isFinite(Date.parse(savedAt))
      && Date.now() - Date.parse(savedAt) < DRAFT_IMAGE_FALLBACK_RETENTION_MS
    const images = Array.isArray(record.images)
      ? record.images.flatMap<ComposerImage>((image) => {
        if (!image || typeof image !== "object") return []
        const { attachmentId, fileName, expiresAt, uploadId, status } = image as Record<string, unknown>
        if (typeof uploadId === "string" && !attachmentId && (status === "pending" || status === "uploading" || status === "failed")) {
          return [{attachmentId: "", uploadId, fileName: typeof fileName === "string" ? fileName.slice(0, 300) : "未完成图片", status: "failed" as const, error: "请重新选择图片后重试"}]
        }
        if (typeof attachmentId !== "string" || !attachmentThumbnailUrl(attachmentId)) return []
        const hasFreshExpiry = typeof expiresAt === "string"
          && Number.isFinite(Date.parse(expiresAt))
          && Date.parse(expiresAt) > Date.now()
        if (!serverReferenced && !hasFreshExpiry && (typeof expiresAt === "string" || !fallbackImagesFresh)) return []
        return [{
          attachmentId,
          fileName: typeof fileName === "string" ? fileName.slice(0, 300) : "草稿图片",
          ...(typeof expiresAt === "string" ? { expiresAt } : {}),
        }]
      }).slice(0, MAX_TOPIC_IMAGES)
      : []
    return {
      version: 2,
      publication: readPendingPublication(record.publication),
      title: typeof record.title === "string" ? record.title.slice(0, 160) : "",
      richContent,
      poll: isPollInput(record.poll) ? record.poll : null,
      images,
      boardId: typeof record.boardId === "string" ? record.boardId : "",
      savedAt,
    }
  } catch {
    return null
  }
}

function readPendingPublication(value: unknown): PendingPublication | null {
  if (!value || typeof value !== "object") return null
  const { idempotencyKey, input, draftSnapshot } = value as Record<string, unknown>
  if (typeof idempotencyKey !== "string" || !/^[!-~]{1,128}$/.test(idempotencyKey) || !input || typeof input !== "object") return null
  const payload = input as Record<string, unknown>
  if (typeof draftSnapshot !== "string" || typeof payload.content !== "string" || !payload.content.trim() || payload.content.length > 1_000_000) return null
  if (payload.title !== undefined && (typeof payload.title !== "string" || payload.title.length > 160)) return null
  if (payload.boardId !== undefined && (typeof payload.boardId !== "string" || !attachmentThumbnailUrl(payload.boardId))) return null
  if (payload.richContent !== undefined && !isRichTextDocument(payload.richContent)) return null
  if (payload.poll !== undefined && !isPollInput(payload.poll)) return null
  if (payload.tags !== undefined && (!Array.isArray(payload.tags) || !payload.tags.every(tag => tag && typeof tag === "object" && typeof tag.slug === "string" && typeof tag.name === "string"))) return null
  if (payload.draft !== undefined) {
    if (!payload.draft || typeof payload.draft !== "object") return null
    const draft = payload.draft as Record<string, unknown>
    if (typeof draft.id !== "string" || !attachmentThumbnailUrl(draft.id) || !Number.isSafeInteger(draft.revision) || Number(draft.revision) < 0) return null
  }
  return { idempotencyKey, input: input as CreatePostInput, draftSnapshot }
}

function composerDraftSnapshot(value: Pick<ComposerDraft, "title" | "richContent" | "images" | "boardId" | "poll" | "publication">): string {
  return JSON.stringify({ ...value, images: value.images.map(({attachmentId, fileName, expiresAt, uploadId, status}) => ({attachmentId, fileName, expiresAt, uploadId, status})) })
}

function writeComposerDraft(
  key: string,
  value: Pick<ComposerDraft, "title" | "richContent" | "images" | "boardId" | "poll" | "publication">,
): LocalSaveResult {
  try {
    const savedAt = new Date().toISOString()
    if (!value.title.trim() && !toPlainText(value.richContent).trim() && value.images.length === 0 && !value.poll && !value.publication) {
      window.localStorage.removeItem(key)
      return { ok: true, savedAt }
    }
    window.localStorage.setItem(key, JSON.stringify({
      version: 2,
      ...value,
      images: value.images.map(({attachmentId, fileName, expiresAt, uploadId, status}) => ({attachmentId, fileName, expiresAt, uploadId, status})),
      savedAt,
    } satisfies ComposerDraft))
    return { ok: true, savedAt }
  } catch {
    return { ok: false }
  }
}

function removeComposerDraft(key: string) {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Ignore unavailable browser storage.
  }
}

function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID()
  return `topic-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function countCharacters(value: string): number {
  return [...value].length
}
