import { LoaderCircle, Send, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { createPost } from "../api/posts"
import { TopicApiError } from "../api/topics"
import { uploadDraftImage } from "../api/attachments"
import type { AuthSession } from "../api/auth"
import type { Topic } from "../types/community"
import type { Board, TopicTag } from "../types/community"
import { parseTopicTags } from "../utils/tags"
import { plainTextDocument, sanitizeRichContent, toPlainText, type RichTextDocument } from "../editor/richContent"
import { RichTextEditor } from "./RichTextEditor"
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

type FieldErrors = Record<string, string[]>
type ComposerCloseOptions = { skipConfirm?: boolean; clearDraft?: boolean }

interface ComposerDraft {
  version: 1
  title: string
  richContent: RichTextDocument
  boardId: string
  tagInput: string
  savedAt: string
}

export function TopicComposer({ open, boards, session, availableTags = [], defaultBoardId = null, onClose, onPublished }: TopicComposerProps) {
  const titleRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const submittingRef = useRef(false)
  const closeConfirmationOpenRef = useRef(false)
  const idempotencyKeyRef = useRef<string | null>(null)
  const savedDraftSnapshotRef = useRef("")
  const restoredDraftKeyRef = useRef<string | null>(null)
  const [title, setTitle] = useState("")
  const [titleVisible, setTitleVisible] = useState(false)
  const [content, setContent] = useState("")
  const [richContent, setRichContent] = useState<RichTextDocument>(() => plainTextDocument(""))
  const [boardId, setBoardId] = useState("")
  const [tagInput, setTagInput] = useState("")
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [closeConfirmation, setCloseConfirmation] = useState<{ options: ComposerCloseOptions; returnFocus: HTMLElement | null } | null>(null)
  submittingRef.current = submitting
  closeConfirmationOpenRef.current = closeConfirmation !== null

  const draftKey = useMemo(
    () => composerDraftKey(session?.user.id ?? "guest", defaultBoardId),
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

  useEffect(() => {
    if (!open) {
      setCloseConfirmation(null)
      restoredDraftKeyRef.current = null
      return
    }
    if (restoredDraftKeyRef.current === draftKey) return

    const draft = readComposerDraft(draftKey)
    if (draft) {
      const restoredRichContent = sanitizeRichContent(draft.richContent)
      setTitle(draft.title)
      setTitleVisible(Boolean(draft.title.trim()))
      setContent(toPlainText(restoredRichContent))
      setRichContent(restoredRichContent)
      if (!defaultBoardId && boards.some((board) => board.id === draft.boardId)) setBoardId(draft.boardId)
      setTagInput(draft.tagInput)
      savedDraftSnapshotRef.current = composerDraftSnapshot(
        draft.title,
        restoredRichContent,
        defaultBoardId ?? draft.boardId,
        draft.tagInput,
      )
    } else {
      savedDraftSnapshotRef.current = composerDraftSnapshot(title, richContent, boardId, tagInput)
    }
    restoredDraftKeyRef.current = draftKey
  }, [boardId, boards, defaultBoardId, draftKey, open, richContent, tagInput, title])

  useEffect(() => {
    if (!open || restoredDraftKeyRef.current !== draftKey) return
    const snapshot = composerDraftSnapshot(title, richContent, boardId, tagInput)
    const timer = window.setTimeout(() => {
      const saved = hasComposerDraftContent(title, content, tagInput)
        ? writeComposerDraft(draftKey, {
          version: 1,
          title,
          richContent,
          boardId,
          tagInput,
          savedAt: new Date().toISOString(),
        })
        : removeComposerDraft(draftKey)
      if (saved) savedDraftSnapshotRef.current = snapshot
    }, 150)
    return () => window.clearTimeout(timer)
  }, [boardId, content, draftKey, open, richContent, tagInput, title])

  useEffect(() => {
    if (!open) return

    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    /* body editor owns initial focus */
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submittingRef.current && !closeConfirmationOpenRef.current) requestClose()
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

  function requestClose(options: ComposerCloseOptions = {}) {
    const snapshot = composerDraftSnapshot(title, richContent, boardId, tagInput)
    const hasUnsavedChanges = hasComposerDraftContent(title, content, tagInput)
      && snapshot !== savedDraftSnapshotRef.current
    if (!options.skipConfirm && hasUnsavedChanges) {
      setCloseConfirmation({
        options,
        returnFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      })
      return
    }
    performClose(options)
  }

  function performClose(options: ComposerCloseOptions = {}) {
    if (options.clearDraft) removeComposerDraft(draftKey)
    setTitle("")
    setTitleVisible(false)
    setContent("")
    setRichContent(plainTextDocument(""))
    setBoardId("")
    setTagInput("")
    setFieldErrors({})
    setFormError("")
    idempotencyKeyRef.current = null
    savedDraftSnapshotRef.current = ""
    restoredDraftKeyRef.current = null
    onClose()
  }

  function validate(): FieldErrors {
    const errors: FieldErrors = {}
    const normalizedTitle = title.trim()
    const normalizedContent = content.trim()
    if (countCharacters(normalizedTitle) > 160) {
      errors.title = ["标题最多 160 个字符"]
    }
    if (countCharacters(normalizedContent) < 1) {
      errors.content = ["请输入正文"]
    }
    return errors
  }

  async function submit() {
    if (submitting) return
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
      const idempotencyKey = idempotencyKeyRef.current ?? createIdempotencyKey()
      idempotencyKeyRef.current = idempotencyKey
      const tags = parseTopicTags(tagInput, availableTags)
      const topic = await createPost(
        {
          ...(title.trim() ? { title: title.trim() } : {}),
          content: content.trim(),
          richContent,
          boardId: selectedBoard?.id,
          ...(tags.length > 0 ? { tags } : {}),
        },
        {
          csrfToken: session.csrfToken,
          idempotencyKey,
        },
      )
      performClose({ clearDraft: true })
      onPublished(topic)
    } catch (error) {
      if (error instanceof TopicApiError) {
        setFieldErrors(error.fields)
        setFormError(error.fields.body?.[0] ?? error.message)
      } else {
        setFormError("主题服务暂时不可用，请稍后重试")
      }
    } finally {
      setSubmitting(false)
    }
  }

  const inputError = (field: string) => fieldErrors[field]?.[0]

  if (!open) return null

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target && !submitting && !closeConfirmation) requestClose()
    }}>
      <div ref={dialogRef} className="composer-dialog" role="dialog" aria-modal="true" aria-labelledby="composer-title">
        <div className="dialog-header">
          <div>
            <p>{selectedBoard?.name ?? "社区广场"}</p>
            <h2 id="composer-title">发布内容</h2>
          </div>
          <button className="icon-button" type="button" onClick={() => requestClose()} disabled={submitting} aria-label="关闭发布窗口" title="关闭">
            <X size={19} aria-hidden="true" />
          </button>
        </div>
        <form className="dialog-body" aria-busy={submitting} onSubmit={(event) => { event.preventDefault(); void submit() }}>
          {boards.length > 1 && (
            <label>
              <span>板块</span>
              <select value={boardId} onChange={(event) => {
                setBoardId(event.target.value)
                idempotencyKeyRef.current = null
              }}>
                {boards.map((board) => <option value={board.id} key={board.id}>{board.name}</option>)}
              </select>
            </label>
          )}
          {titleVisible ? (
            <label>
              <span>标题（可选）</span>
              <input
                ref={titleRef}
                type="text"
                value={title}
                maxLength={160}
                placeholder="需要时再补充标题"
                aria-invalid={inputError("title") ? "true" : undefined}
                aria-describedby={inputError("title") ? "composer-title-error" : undefined}
                onChange={(event) => {
                  setTitle(event.target.value)
                  idempotencyKeyRef.current = null
                }}
              />
              {inputError("title") && <p id="composer-title-error" className="composer-field-error">{inputError("title")}</p>}
            </label>
          ) : (
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setTitleVisible(true)
                window.setTimeout(() => titleRef.current?.focus(), 0)
              }}
            >
              添加标题
            </button>
          )}
          <div className="composer-field">
            <span className="composer-field__label">正文</span>
            <RichTextEditor
              value={richContent}
              ariaLabel="正文"
              placeholder="补充背景、你的判断和希望大家讨论的问题"
              maxCharacters={1_000_000}
              autoFocus
              onImageUpload={session
                ? (file, onProgress, signal) => uploadDraftImage(file, session.csrfToken, onProgress, signal)
                : undefined}
              disabled={submitting}
              invalid={Boolean(inputError("content") || inputError("rich_content"))}
              errorMessageId={(inputError("content") || inputError("rich_content")) ? "composer-content-error" : undefined}
              onChange={(document, plainText) => {
                if (plainText !== content || JSON.stringify(document) !== JSON.stringify(richContent)) {
                  idempotencyKeyRef.current = null
                }
                setRichContent(document)
                setContent(plainText)
              }}
            />
            {(inputError("content") || inputError("rich_content")) && <p id="composer-content-error" className="composer-field-error">{inputError("content") ?? inputError("rich_content")}</p>}
          </div>
          <label>
            <span>标签</span>
            <input
              type="text"
              value={tagInput}
              placeholder="用逗号分隔，例如 rust, 架构"
              list="topic-tag-options"
              aria-invalid={inputError("tags") ? "true" : undefined}
              aria-describedby={inputError("tags") ? "composer-tags-error" : undefined}
              onChange={(event) => {
                setTagInput(event.target.value)
                idempotencyKeyRef.current = null
              }}
            />
            {availableTags.length > 0 && (
              <datalist id="topic-tag-options">
                {availableTags.map((tag) => <option value={tag.name} key={tag.slug} />)}
              </datalist>
            )}
            {inputError("tags") && <p id="composer-tags-error" className="composer-field-error">{inputError("tags")}</p>}
          </label>
          {formError && <p className="composer-form-error" role="alert">{formError}</p>}
          <div className="dialog-toolbar">
            <span className="dialog-toolbar__hint">本地草稿自动保存 · 发布后进入详情</span>
            <button className="primary-button" type="submit" disabled={submitting}>
              {submitting ? <LoaderCircle className="topic-loading__spinner" size={16} aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
              {submitting ? "正在发布" : "发布"}
            </button>
          </div>
        </form>
      </div>
      {closeConfirmation && <ConfirmDialog
        title="关闭发布窗口？"
        confirmLabel="确认关闭"
        busy={submitting}
        returnFocus={closeConfirmation.returnFocus}
        onCancel={() => setCloseConfirmation(null)}
        onConfirm={() => {
          const options = closeConfirmation.options
          setCloseConfirmation(null)
          performClose(options)
        }}
      >
        <p>还有尚未保存到本地草稿的编辑内容。现在关闭可能丢失最近的修改。</p>
        <p>建议取消后等待“本地草稿自动保存”，或确认关闭并放弃这些未保存修改。</p>
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

function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `topic-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function countCharacters(value: string): number {
  return [...value].length
}

function composerDraftKey(userId: string, defaultBoardId: string | null): string {
  return `daoyun:composer-draft:v1:${userId}:${defaultBoardId ?? "global"}`
}

function composerDraftSnapshot(
  title: string,
  richContent: RichTextDocument,
  boardId: string,
  tagInput: string,
): string {
  return JSON.stringify({ title, richContent, boardId, tagInput })
}

function hasComposerDraftContent(title: string, content: string, tagInput: string): boolean {
  return Boolean(title.trim() || content.trim() || tagInput.trim())
}

function readComposerDraft(key: string): ComposerDraft | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value)
      || value.version !== 1
      || typeof value.title !== "string"
      || typeof value.boardId !== "string"
      || typeof value.tagInput !== "string"
      || typeof value.savedAt !== "string") {
      return null
    }
    return {
      version: 1,
      title: value.title,
      richContent: sanitizeRichContent(value.richContent),
      boardId: value.boardId,
      tagInput: value.tagInput,
      savedAt: value.savedAt,
    }
  } catch {
    return null
  }
}

function writeComposerDraft(key: string, draft: ComposerDraft): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(draft))
    return true
  } catch {
    return false
  }
}

function removeComposerDraft(key: string): boolean {
  try {
    window.localStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
