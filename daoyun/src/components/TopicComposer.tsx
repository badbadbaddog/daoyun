import {getPollPolicy,isPollInput,type PollInput} from "../api/polls"
import {PollEditor,newPoll} from "./PollEditor"
import { ArrowLeft, ArrowRight, ImagePlus, LoaderCircle, Send, Trash2, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { uploadDraftImage } from "../api/attachments"
import type { AuthSession } from "../api/auth"
import { createPost } from "../api/posts"
import { TopicApiError } from "../api/topics"
import { attachmentThumbnailUrl, plainTextDocument, sanitizeRichContent, toPlainText, type RichTextDocument, type RichTextNode } from "../editor/richContent"
import type { Board, Topic, TopicTag } from "../types/community"
import { extractTopicTags } from "../utils/tags"
import { RichTextEditor } from "./RichTextEditor"
import { DraftShelf, type DraftHandle } from "./DraftShelf"
import { ConfirmDialog } from "./ui/ConfirmDialog"

interface TopicComposerProps {
  open: boolean
  boards: Board[]
  session: AuthSession | null
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

interface ComposerDraft {
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

const MAX_TOPIC_IMAGES = 9
const DRAFT_SAVE_DELAY_MS = 150
const DRAFT_IMAGE_FALLBACK_RETENTION_MS = 24 * 60 * 60 * 1_000

export function TopicComposer({ open, boards, session, availableTags = [], defaultBoardId = null, onClose, onPublished }: TopicComposerProps) {
  const serverDraftRef = useRef<DraftHandle>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const replacementInputRef = useRef<HTMLInputElement>(null)
  const replacementImageRef = useRef<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const submittingRef = useRef(false)
  const uploadingRef = useRef(false)
  const closeConfirmationOpenRef = useRef(false)
  const idempotencyKeyRef = useRef<string | null>(null)
  const uploadControllerRef = useRef<AbortController | null>(null)
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
  const [restoredDraftKey, setRestoredDraftKey] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [closing, setClosing] = useState(false)
  const [closeConfirmation, setCloseConfirmation] = useState<{ returnFocus: HTMLElement | null } | null>(null)
  const uploading = uploadStatus !== null
  const embeddedImageCount = countImages(richContent)
  const imageCount = embeddedImageCount + images.length
  const uploadedImageCount = embeddedImageCount + images.filter(image => image.attachmentId).length
  const unresolvedImages = images.some(image => !image.attachmentId)
  const busy = submitting || uploading || closing
  submittingRef.current = submitting || closing
  uploadingRef.current = uploading
  closeConfirmationOpenRef.current = closeConfirmation !== null
  requestCloseRef.current = requestClose
  const draftKey = useMemo(
    () => `daoyun:composer-draft:v2:${session?.user.id ?? "guest"}:${defaultBoardId ?? "global"}`,
    [defaultBoardId, session?.user.id],
  )

  const selectedBoard = useMemo(
    () => boards.find((board) => board.id === boardId) ?? boards[0],
    [boardId, boards],
  )

  useEffect(() => {
    if (!open) return
    setBoardId((current) => {
      const preferred = defaultBoardId && boards.some((board) => board.id === defaultBoardId)
        ? defaultBoardId
        : null
      const next = preferred ?? (boards.some((board) => board.id === current) ? current : boards[0]?.id || "")
      if (next !== current) idempotencyKeyRef.current = null
      return next
    })
    setFieldErrors({})
    setFormError("")
  }, [boards, defaultBoardId, open])

  useEffect(() => () => uploadControllerRef.current?.abort(), [])
  useEffect(() => {
    setCanCreatePoll(false)
    if(!open || !session) return
    const controller=new AbortController()
    getPollPolicy(controller.signal).then(policy=>{if(!controller.signal.aborted)setCanCreatePoll(policy.can_create)}).catch(()=>undefined)
    return()=>controller.abort()
  },[open,session?.user.id])

  useEffect(() => {
    if (!open || restoredDraftKey === draftKey) return
    if (restoredDraftKey) {
      writeComposerDraft(restoredDraftKey, { title, richContent, images, boardId, poll })
    }
    uploadControllerRef.current?.abort()
    uploadControllerRef.current = null
    uploadingRef.current = false
    replacementImageRef.current = null
    setUploadStatus(null)
    setImageError("")
    const draft = readComposerDraft(draftKey, session?.user.id)
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
  }, [boardId, boards, defaultBoardId, draftKey, images, open, restoredDraftKey, richContent, title, poll, session?.user.id])

  useEffect(() => {
    if (!open || restoredDraftKey !== draftKey) return
    const timer = window.setTimeout(() => {
      writeComposerDraft(draftKey, { title, richContent, images, boardId, poll })
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
  }, [open])

  useEffect(() => {
    if (!open) return

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
  }, [open])

  function requestClose() {
    const hasUnsavedChanges = Boolean(title.trim() || content.trim() || images.length || poll)
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
    else writeComposerDraft(draftKey, { title, richContent, images, boardId, poll })
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
    if (uploadingRef.current || !session) return
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
    if (busy) return
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
    if (busy) return
    const errors = validate()
    setFieldErrors(errors)
    setFormError("")
    if (Object.keys(errors).length > 0) return
    if (!session) {
      setFormError("请先登录后发布主题")
      return
    }

    setSubmitting(true)
    try {
      const draft = await serverDraftRef.current?.flush()
      const idempotencyKey = idempotencyKeyRef.current ?? createIdempotencyKey()
      idempotencyKeyRef.current = idempotencyKey
      const tags = extractTopicTags(content, availableTags)
      const topic = await createPost(
        {
          ...(title.trim() ? { title: title.trim() } : {}),
          content: content.trim(),
          ...(draft ? { draft } : {}),
          ...(poll ? { poll } : {}),
          richContent: withComposerImages(richContent, images),
          boardId: selectedBoard?.id,
          ...(tags.length > 0 ? { tags } : {}),
        },
        { csrfToken: session.csrfToken, idempotencyKey },
      )
      performClose(true)
      onPublished(topic)
    } catch (error) {
      if (error instanceof TopicApiError) {
        setFieldErrors(error.fields)
        setFormError(error.fields.body?.[0] ?? error.message)
      } else {
        setFormError("主题服务暂时不可用，请稍后重试；未发布的正文仍保留")
      }
    } finally {
      setSubmitting(false)
    }
  }

  const inputError = (field: string) => fieldErrors[field]?.[0]

  if (!open) return null

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
          {session && <DraftShelf key={draftKey} ref={serverDraftRef} ownerId={session.user.id} csrfToken={session.csrfToken} storageKey={draftKey} ready={restoredDraftKey === draftKey} busy={busy || unresolvedImages}
            content={{title,board_id:boardId || null,rich_content:richContent,images:images.filter(image=>image.attachmentId).map(({attachmentId,fileName})=>({attachmentId,fileName})),poll}}
            onRestore={draft=>{setPoll(isPollInput(draft.poll)?draft.poll:null);setTitle(draft.title);setRichContent(draft.rich_content);setContent(toPlainText(draft.rich_content));setImages(draft.images);setBoardId(draft.board_id??"");setFieldErrors({});setFormError("");idempotencyKeyRef.current=null;writeComposerDraft(draftKey,{title:draft.title,richContent:draft.rich_content,images:draft.images,boardId:draft.board_id??"",poll:draft.poll})}} />}
          {boards.length > 1 && (
            <label>
              <span>板块</span>
              <select value={boardId} disabled={busy} onChange={(event) => {
                setBoardId(event.target.value)
                idempotencyKeyRef.current = null
              }}>
                {boards.map((board) => <option value={board.id} key={board.id}>{board.name}</option>)}
              </select>
            </label>
          )}
          <label>
            <span>标题（可选）</span>
            <input
              type="text"
              value={title}
              maxLength={160}
              disabled={busy}
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
              <PollEditor value={poll} disabled={busy || !canCreatePoll} onChange={value=>{setPoll(value);idempotencyKeyRef.current=null}} />
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
                        {image.status === "failed" && <button type="button" disabled={busy}
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
                  disabled={busy || !session}
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
                disabled={busy || !session}
                onChange={(event) => {
                  void addImages(Array.from(event.target.files ?? []))
                  event.target.value = ""
                }}
              />
            </div>

              <input ref={replacementInputRef} className="visually-hidden" type="file"
                accept="image/png,image/jpeg,image/gif,image/webp" aria-label="重新选择失败图片" disabled={busy || !session}
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
            {unresolvedImages && <p className="composer-field-error" role="status">未完成图片仅保存在本机；请重试或移除后发布并同步草稿。</p>}
            {imageError && <p className="composer-field-error" role="alert">{imageError}</p>}
          </div>

          <div className="composer-field">
            <span className="composer-field__label">正文</span>
            <RichTextEditor
              value={richContent}
              ariaLabel="正文"
              placeholder="补充背景和想法；输入 #标签 可自动归类"
              maxCharacters={1_000_000}
              autoFocus
              showImageUpload={false}
              disabled={busy}
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
          {formError && <p className="composer-form-error" role="alert">{formError}</p>}
          <div className="dialog-toolbar">
            <span className="dialog-toolbar__hint">本地草稿自动保存 · 正文输入 #标签 · 最多 9 张图片</span>
            <button className="primary-button" type="submit" disabled={busy || unresolvedImages}>
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
          setCloseConfirmation(null)
          setClosing(true)
          void (unresolvedImages ? Promise.resolve() : serverDraftRef.current?.flush() ?? Promise.resolve()).catch(() => undefined).finally(() => {
            performClose()
            setClosing(false)
          })
        }}
      >
        <p>当前内容已保存为本地草稿，下次打开时可继续编辑。</p>
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

function writeComposerDraft(
  key: string,
  value: Pick<ComposerDraft, "title" | "richContent" | "images" | "boardId" | "poll">,
) {
  try {
    if (!value.title.trim() && !toPlainText(value.richContent).trim() && value.images.length === 0 && !value.poll) {
      window.localStorage.removeItem(key)
      return
    }
    window.localStorage.setItem(key, JSON.stringify({
      version: 2,
      ...value,
      images: value.images.map(({attachmentId, fileName, expiresAt, uploadId, status}) => ({attachmentId, fileName, expiresAt, uploadId, status})),
      savedAt: new Date().toISOString(),
    } satisfies ComposerDraft))
  } catch {
    // localStorage may be unavailable or full; publishing remains usable.
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
