import { LoaderCircle, Send, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { createTopic, TopicApiError } from "../api/topics"
import { uploadDraftImage } from "../api/attachments"
import type { AuthSession } from "../api/auth"
import type { Topic } from "../types/community"
import type { Board, TopicTag } from "../types/community"
import { parseTopicTags } from "../utils/tags"
import { plainTextDocument, type RichTextDocument } from "../editor/richContent"
import { RichTextEditor } from "./RichTextEditor"

interface TopicComposerProps {
  open: boolean
  boards: Board[]
  session: AuthSession | null
  availableTags?: TopicTag[]
  onClose: () => void
  onPublished: (topic: Topic) => void
}

type FieldErrors = Record<string, string[]>

export function TopicComposer({ open, boards, session, availableTags = [], onClose, onPublished }: TopicComposerProps) {
  const titleRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const submittingRef = useRef(false)
  const idempotencyKeyRef = useRef<string | null>(null)
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [richContent, setRichContent] = useState<RichTextDocument>(() => plainTextDocument(""))
  const [boardId, setBoardId] = useState("")
  const [tagInput, setTagInput] = useState("")
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState("")
  const [submitting, setSubmitting] = useState(false)
  submittingRef.current = submitting

  const selectedBoard = useMemo(
    () => boards.find((board) => board.id === boardId) ?? boards[0],
    [boardId, boards],
  )

  useEffect(() => {
    if (!open) return

    setBoardId((current) => {
      const next = boards.some((board) => board.id === current) ? current : boards[0]?.id || ""
      if (next !== current) idempotencyKeyRef.current = null
      return next
    })
    setFieldErrors({})
    setFormError("")
  }, [boards, open])

  useEffect(() => {
    if (!open) return

    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    titleRef.current?.focus()
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submittingRef.current) close()
    }
    const handleTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return
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

  function close() {
    setTitle("")
    setContent("")
    setRichContent(plainTextDocument(""))
    setTagInput("")
    setFieldErrors({})
    setFormError("")
    idempotencyKeyRef.current = null
    onClose()
  }

  function validate(): FieldErrors {
    const errors: FieldErrors = {}
    const normalizedTitle = title.trim()
    const normalizedContent = content.trim()
    if (countCharacters(normalizedTitle) < 1 || countCharacters(normalizedTitle) > 160) {
      errors.title = ["标题需为 1-160 个字符"]
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
      const topic = await createTopic(
        {
          title: title.trim(),
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
      onPublished(topic)
      close()
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
      if (event.currentTarget === event.target && !submitting) close()
    }}>
      <div ref={dialogRef} className="composer-dialog" role="dialog" aria-modal="true" aria-labelledby="composer-title">
        <div className="dialog-header">
          <div>
            <p>{selectedBoard?.name ?? "社区广场"}</p>
            <h2 id="composer-title">发布新主题</h2>
          </div>
          <button className="icon-button" type="button" onClick={close} disabled={submitting} aria-label="关闭发布窗口" title="关闭">
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
          <label>
            <span>标题</span>
            <input
              ref={titleRef}
              type="text"
              value={title}
              maxLength={160}
              placeholder="清晰地概括你想讨论的内容"
              aria-invalid={inputError("title") ? "true" : undefined}
              aria-describedby={inputError("title") ? "composer-title-error" : undefined}
              onChange={(event) => {
                setTitle(event.target.value)
                idempotencyKeyRef.current = null
              }}
            />
            {inputError("title") && <p id="composer-title-error" className="composer-field-error">{inputError("title")}</p>}
          </label>
          <div className="composer-field">
            <span className="composer-field__label">正文</span>
            <RichTextEditor
              value={richContent}
              ariaLabel="正文"
              placeholder="补充背景、你的判断和希望大家讨论的问题"
              maxCharacters={1_000_000}
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
            <span className="dialog-toolbar__hint">内容将自动保存为安全的结构化格式</span>
            <button className="primary-button" type="submit" disabled={submitting}>
              {submitting ? <LoaderCircle className="topic-loading__spinner" size={16} aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
              {submitting ? "正在发布" : "发布"}
            </button>
          </div>
        </form>
      </div>
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
