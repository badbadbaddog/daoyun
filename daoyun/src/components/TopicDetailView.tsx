import {
  ArrowLeft,
  Bookmark,
  Edit3,
  FileSearch,
  Flag,
  History,
  LoaderCircle,
  MessageCircle,
  RefreshCw,
  Save,
  Send,
  Trash2,
  ThumbsUp,
  X,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"

import type { AuthSession } from "../api/auth"
import { createReport, ReportApiError, type ReportReason } from "../api/reports"
import { RelationApiError, setPostLike, setTopicBookmark } from "../api/relations"
import {
  createReply,
  getTopic,
  listRevisions,
  listReplies,
  TopicApiError,
  deleteTopic,
  updateTopic,
} from "../api/topics"
import type { TopicDetail, TopicReply, TopicRevision } from "../api/topics"
import { parseTopicTags } from "../utils/tags"
import { ReplyItem } from "./ReplyItem"
import { UserAvatar } from "./UserAvatar"

interface TopicDetailViewProps {
  topicId: string
  session: AuthSession | null
  onBack: () => void
  onLogin: () => void
  onReplyPublished: (topicId: string) => void
  onReplyDeleted?: (topicId: string) => void
  onTopicUpdated?: (topic: TopicDetail) => void
  onTopicDeleted?: (topicId: string) => void
}

type LoadStatus = "loading" | "ready" | "error"

export function TopicDetailView({
  topicId,
  session,
  onBack,
  onLogin,
  onReplyPublished,
  onReplyDeleted = () => undefined,
  onTopicUpdated = () => undefined,
  onTopicDeleted = () => undefined,
}: TopicDetailViewProps) {
  const idempotencyKeyRef = useRef<string | null>(null)
  const [topic, setTopic] = useState<TopicDetail | null>(null)
  const [replies, setReplies] = useState<TopicReply[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading")
  const [requestVersion, setRequestVersion] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [content, setContent] = useState("")
  const [fieldError, setFieldError] = useState("")
  const [formError, setFormError] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState("")
  const [draftContent, setDraftContent] = useState("")
  const [draftTags, setDraftTags] = useState("")
  const [editError, setEditError] = useState("")
  const [revisionConflict, setRevisionConflict] = useState(false)
  const [revisions, setRevisions] = useState<TopicRevision[]>([])
  const [revisionStatus, setRevisionStatus] = useState<LoadStatus>("ready")
  const [showRevisions, setShowRevisions] = useState(false)
  const [interactionBusy, setInteractionBusy] = useState<"bookmark" | "like" | null>(null)
  const [interactionError, setInteractionError] = useState("")
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deletePending, setDeletePending] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [reportReason, setReportReason] = useState<ReportReason>("spam")
  const [reportDetails, setReportDetails] = useState("")
  const [reportPending, setReportPending] = useState(false)
  const [reportMessage, setReportMessage] = useState("")
  const [reportError, setReportError] = useState("")
  const deleteConfirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (confirmingDelete) deleteConfirmRef.current?.focus()
  }, [confirmingDelete])

  useEffect(() => {
    const controller = new AbortController()
    setLoadStatus("loading")
    setTopic(null)
    setReplies([])
    setNextCursor(null)

    Promise.all([
      getTopic(topicId, controller.signal),
      listReplies(topicId, { signal: controller.signal }),
    ]).then(([loadedTopic, page]) => {
      if (!controller.signal.aborted) {
        setTopic(loadedTopic)
        setDraftTitle(loadedTopic.title)
        setDraftContent(loadedTopic.content)
        setDraftTags(loadedTopic.tags.map((tag) => tag.name).join(", "))
        setEditing(false)
        setRevisionConflict(false)
        setShowRevisions(false)
        setRevisions([])
        setReplies(page.replies)
        setNextCursor(page.nextCursor)
        setLoadStatus("ready")
      }
    }).catch(() => {
      if (!controller.signal.aborted) {
        setLoadStatus("error")
      }
    })

    return () => controller.abort()
  }, [requestVersion, session?.user.id, topicId])

  const canEdit = Boolean(session && topic && session.user.id === topic.authorId)

  function beginEditing() {
    if (!topic || !canEdit) return
    setDraftTitle(topic.title)
    setDraftContent(topic.content)
    setDraftTags(topic.tags.map((tag) => tag.name).join(", "))
    setEditError("")
    setRevisionConflict(false)
    setEditing(true)
  }

  async function confirmDelete() {
    if (!session || !topic || !canEdit || deletePending) return
    setDeletePending(true)
    setInteractionError("")
    try {
      await deleteTopic(topic.id, { csrfToken: session.csrfToken })
      setConfirmingDelete(false)
      onTopicDeleted(topic.id)
    } catch (error) {
      setInteractionError(error instanceof TopicApiError && error.status === 403
        ? "你没有权限删除这个主题。"
        : "主题暂时无法删除，请重试。")
    } finally {
      setDeletePending(false)
    }
  }

  function cancelEditing() {
    if (!topic) return
    setDraftTitle(topic.title)
    setDraftContent(topic.content)
    setDraftTags(topic.tags.map((tag) => tag.name).join(", "))
    setEditError("")
    setRevisionConflict(false)
    setEditing(false)
  }

  async function submitEdit() {
    if (!topic || !session || !canEdit || submitting) return
    const title = draftTitle.trim()
    const contentValue = draftContent.trim()
    if ([...title].length < 1 || [...title].length > 160) {
      setEditError("标题需为 1-160 个字符")
      return
    }
    if ([...contentValue].length < 1 || [...contentValue].length > 100_000) {
      setEditError("正文需为 1-100,000 个字符")
      return
    }
    setSubmitting(true)
    setEditError("")
    try {
      const updated = await updateTopic(topic.id, {
        baseRevision: topic.contentRevision,
        title,
        content: contentValue,
        tags: parseTopicTags(draftTags, topic.tags),
      }, { csrfToken: session.csrfToken })
      setTopic(updated)
      setDraftTitle(updated.title)
      setDraftContent(updated.content)
      setDraftTags(updated.tags.map((tag) => tag.name).join(", "))
      setEditing(false)
      setRevisionConflict(false)
      onTopicUpdated(updated)
    } catch (error) {
      if (error instanceof TopicApiError && error.status === 409) {
        setRevisionConflict(true)
        setEditError("主题已被其他操作更新，请刷新最新内容后再提交")
      } else if (error instanceof TopicApiError) {
        setEditError(
          error.fields.body?.[0]
          ?? error.fields.title?.[0]
          ?? error.fields.content?.[0]
          ?? error.fields.tags?.[0]
          ?? error.message,
        )
      } else {
        setEditError("主题编辑服务暂时不可用，请稍后重试")
      }
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleRevisions() {
    if (!topic || !canEdit) return
    if (showRevisions) {
      setShowRevisions(false)
      return
    }
    setShowRevisions(true)
    setRevisionStatus("loading")
    try {
      setRevisions(await listRevisions(topic.id))
      setRevisionStatus("ready")
    } catch {
      setRevisionStatus("error")
    }
  }

  async function loadMoreReplies() {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await listReplies(topicId, { cursor: nextCursor })
      setReplies((current) => [
        ...current,
        ...page.replies.filter((reply) => !current.some((item) => item.id === reply.id)),
      ])
      setNextCursor(page.nextCursor)
    } catch {
      setFormError("更多回复暂时无法加载，请重试")
    } finally {
      setLoadingMore(false)
    }
  }

  async function submitReply() {
    if (submitting) return
    const normalizedContent = content.trim()
    setFieldError("")
    setFormError("")
    if ([...normalizedContent].length < 1) {
      setFieldError("请输入回复内容")
      return
    }
    if ([...normalizedContent].length > 100_000) {
      setFieldError("回复不能超过 100,000 个字符")
      return
    }
    if (!session) {
      onLogin()
      return
    }

    setSubmitting(true)
    try {
      const idempotencyKey = idempotencyKeyRef.current ?? createIdempotencyKey()
      idempotencyKeyRef.current = idempotencyKey
      const reply = await createReply(topicId, normalizedContent, {
        csrfToken: session.csrfToken,
        idempotencyKey,
      })
      setReplies((current) => current.some((item) => item.id === reply.id)
        ? current
        : [...current, reply])
      setTopic((current) => current ? { ...current, replies: current.replies + 1 } : current)
      setContent("")
      idempotencyKeyRef.current = null
      onReplyPublished(topicId)
    } catch (error) {
      if (error instanceof TopicApiError) {
        setFieldError(error.fields.content?.[0] ?? "")
        setFormError(error.fields.body?.[0] ?? error.message)
      } else {
        setFormError("回复服务暂时不可用，请稍后重试")
      }
    } finally {
      setSubmitting(false)
    }
  }

  function handleReplyUpdated(updated: TopicReply) {
    setReplies((current) => current.map((reply) => (
      reply.id === updated.id ? updated : reply
    )))
  }

  function handleReplyDeleted(replyId: string) {
    setReplies((current) => current.filter((reply) => reply.id !== replyId))
    setTopic((current) => current
      ? { ...current, replies: Math.max(0, current.replies - 1) }
      : current)
    onReplyDeleted(topicId)
  }

  async function toggleBookmark() {
    if (!topic) return
    if (!session) {
      onLogin()
      return
    }
    if (interactionBusy) return
    setInteractionBusy("bookmark")
    setInteractionError("")
    try {
      const state = await setTopicBookmark(topic.id, topic.bookmarked !== true, session.csrfToken)
      const updated = { ...topic, bookmarked: state.bookmarked }
      setTopic(updated)
      onTopicUpdated(updated)
    } catch (caught) {
      if (caught instanceof RelationApiError && caught.status === 401) onLogin()
      setInteractionError("收藏操作失败，请重试")
    } finally {
      setInteractionBusy(null)
    }
  }

  async function toggleTopicLike() {
    if (!topic) return
    if (!session) {
      onLogin()
      return
    }
    if (interactionBusy) return
    setInteractionBusy("like")
    setInteractionError("")
    try {
      const state = await setPostLike(topic.id, topic.liked !== true, session.csrfToken)
      const updated = { ...topic, liked: state.liked, likes: state.likeCount }
      setTopic(updated)
      onTopicUpdated(updated)
    } catch (caught) {
      if (caught instanceof RelationApiError && caught.status === 401) onLogin()
      setInteractionError("点赞操作失败，请重试")
    } finally {
      setInteractionBusy(null)
    }
  }

  function beginReport() {
    if (!session) {
      onLogin()
      return
    }
    setReporting(true)
    setReportMessage("")
    setReportError("")
  }

  async function submitReport() {
    if (!topic || !session || reportPending) return
    const details = reportDetails.trim()
    if ([...details].length > 1000) {
      setReportError("补充说明不能超过 1,000 个字符")
      return
    }
    setReportPending(true)
    setReportError("")
    try {
      const receipt = await createReport("topic", topic.id, reportReason, details || null, session.csrfToken)
      setReportMessage(receipt.created ? "举报已提交，管理员会尽快处理" : "你已经举报过该主题")
      setReporting(false)
      setReportDetails("")
    } catch (error) {
      setReportError(error instanceof ReportApiError && error.status === 404
        ? "主题已不可访问，无法提交举报"
        : "举报服务暂时不可用，请稍后重试")
    } finally {
      setReportPending(false)
    }
  }

  if (loadStatus === "loading") {
    return (
      <div className="topic-detail-state" role="status">
        <LoaderCircle className="topic-loading__spinner" size={22} aria-hidden="true" />
        <span>正在加载主题</span>
      </div>
    )
  }

  if (loadStatus === "error" || !topic) {
    return (
      <div className="empty-state topic-detail-state" role="alert">
        <FileSearch size={28} aria-hidden="true" />
        <h1>主题暂时无法加载</h1>
        <p>主题可能不存在，或网络连接暂时不可用。</p>
        <button className="secondary-button" type="button" onClick={() => setRequestVersion((value) => value + 1)}>
          <RefreshCw size={15} aria-hidden="true" />
          重试加载主题
        </button>
      </div>
    )
  }

  return (
    <section className="topic-detail" aria-labelledby="topic-detail-title">
      <div className="topic-detail__toolbar">
        <button className="secondary-button" type="button" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" />
          返回主题列表
        </button>
      </div>

      <article className="topic-detail__article">
        <div className="topic-detail__board">
          <span className={`board-tag board-tag--${topic.boardTone}`}>{topic.board}</span>
          <time>{topic.publishedAt}</time>
        </div>
        <div className="topic-detail__title-row">
          <h1 id="topic-detail-title">{topic.title}</h1>
          {canEdit && !editing && (
            <button className="secondary-button" type="button" onClick={beginEditing}>
              <Edit3 size={15} aria-hidden="true" />
              编辑
            </button>
          )}
        </div>
        <a
          className="topic-detail__author"
          href={`#user/${topic.authorUsername}`}
          aria-label={`查看 ${topic.author} 的主页`}
        >
          <UserAvatar
            username={topic.authorUsername}
            displayName={topic.author}
            avatarUrl={topic.avatarUrl}
            size="medium"
          />
          <strong>{topic.author}</strong>
        </a>
        {topic.tags.length > 0 && (
          <div className="topic-detail__tags" aria-label="主题标签">
            {topic.tags.map((tag) => <span className="topic-tag" key={tag.slug}>#{tag.name}</span>)}
          </div>
        )}
        {editing ? (
          <form className="topic-edit-form" onSubmit={(event) => { event.preventDefault(); void submitEdit() }} aria-busy={submitting}>
            <label>
              <span>标题</span>
              <input value={draftTitle} maxLength={160} onChange={(event) => setDraftTitle(event.target.value)} />
            </label>
            <label>
              <span>正文</span>
              <textarea rows={10} value={draftContent} onChange={(event) => setDraftContent(event.target.value)} />
            </label>
            <label>
              <span>标签</span>
              <input value={draftTags} placeholder="用逗号分隔标签" onChange={(event) => setDraftTags(event.target.value)} />
            </label>
            {editError && <p className="composer-form-error" role="alert">{editError}</p>}
            {revisionConflict && (
              <button className="secondary-button" type="button" onClick={() => setRequestVersion((value) => value + 1)}>
                <RefreshCw size={15} aria-hidden="true" />
                刷新最新内容
              </button>
            )}
            <div className="topic-edit-form__actions">
              <button className="secondary-button" type="button" onClick={cancelEditing} disabled={submitting}>
                <X size={15} aria-hidden="true" />
                取消
              </button>
              <button className="primary-button" type="submit" disabled={submitting}>
                {submitting ? <LoaderCircle className="topic-loading__spinner" size={15} aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}
                {submitting ? "正在保存" : "保存修改"}
              </button>
            </div>
          </form>
        ) : (
          <div className="topic-detail__content">{topic.content}</div>
        )}
        <div className="topic-interactions" aria-label="主题互动">
          <button
            className="secondary-button"
            type="button"
            aria-label={topic.bookmarked ? "取消收藏主题" : "收藏主题"}
            aria-pressed={topic.bookmarked === true}
            disabled={interactionBusy !== null}
            onClick={() => void toggleBookmark()}
          >
            {interactionBusy === "bookmark"
              ? <LoaderCircle className="topic-loading__spinner" size={15} aria-hidden="true" />
              : <Bookmark size={15} fill={topic.bookmarked ? "currentColor" : "none"} aria-hidden="true" />}
            {topic.bookmarked ? "已收藏" : "收藏"}
          </button>
          <button
            className="secondary-button"
            type="button"
            aria-label={topic.liked ? "取消点赞主题" : "点赞主题"}
            aria-pressed={topic.liked === true}
            disabled={interactionBusy !== null}
            onClick={() => void toggleTopicLike()}
          >
            {interactionBusy === "like"
              ? <LoaderCircle className="topic-loading__spinner" size={15} aria-hidden="true" />
              : <ThumbsUp size={15} fill={topic.liked ? "currentColor" : "none"} aria-hidden="true" />}
            {topic.likes}
          </button>
          <button className="secondary-button" type="button" onClick={beginReport}>
            <Flag size={15} aria-hidden="true" />
            举报主题
          </button>
        </div>
        {interactionError && <p className="interaction-alert" role="alert">{interactionError}</p>}
        {reportMessage && <p className="interaction-alert" role="status">{reportMessage}</p>}
        {reporting && (
          <form className="report-form" aria-label="举报主题" onSubmit={(event) => { event.preventDefault(); void submitReport() }} aria-busy={reportPending}>
            <label>
              <span>举报原因</span>
              <select value={reportReason} onChange={(event) => setReportReason(event.target.value as ReportReason)}>
                <option value="spam">垃圾广告</option>
                <option value="harassment">骚扰或攻击</option>
                <option value="illegal">违法内容</option>
                <option value="copyright">版权问题</option>
                <option value="other">其他</option>
              </select>
            </label>
            <label>
              <span>补充说明</span>
              <textarea rows={3} maxLength={1000} value={reportDetails} onChange={(event) => setReportDetails(event.target.value)} placeholder="可选，帮助管理员理解问题" />
            </label>
            {reportError && <p className="composer-form-error" role="alert">{reportError}</p>}
            <div className="report-form__actions">
              <button className="secondary-button" type="button" onClick={() => setReporting(false)} disabled={reportPending}><X size={15} aria-hidden="true" />取消</button>
              <button className="primary-button" type="submit" disabled={reportPending}>{reportPending ? <LoaderCircle className="topic-loading__spinner" size={15} aria-hidden="true" /> : <Flag size={15} aria-hidden="true" />}{reportPending ? "正在提交" : "提交举报"}</button>
            </div>
          </form>
        )}
        {canEdit && !editing && (
          <div className="topic-detail__revision-actions">
            <button className="secondary-button" type="button" onClick={() => void toggleRevisions()}>
              <History size={15} aria-hidden="true" />
              {showRevisions ? "收起修订历史" : "查看修订历史"}
            </button>
            <button className="secondary-button reply-action--danger" type="button" onClick={() => setConfirmingDelete(true)}>
              <Trash2 size={15} aria-hidden="true" />
              删除主题
            </button>
          </div>
        )}
        {confirmingDelete && (
          <div className="reply-delete-confirm" role="alertdialog" aria-label="确认删除主题" aria-describedby="topic-delete-message">
            <span id="topic-delete-message">删除后主题和回复将不再公开，确认继续？</span>
            <div>
              <button className="secondary-button" type="button" onClick={() => setConfirmingDelete(false)} disabled={deletePending}>取消删除</button>
              <button ref={deleteConfirmRef} className="primary-button reply-delete-confirm__submit" type="button" onClick={() => void confirmDelete()} disabled={deletePending}>
                {deletePending && <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" />}
                {deletePending ? "正在删除" : "确认删除"}
              </button>
            </div>
          </div>
        )}
        {showRevisions && (
          <div className="topic-revisions" aria-live="polite">
            {revisionStatus === "loading" ? <span>正在加载修订历史</span> : revisionStatus === "error" ? (
              <span role="alert">修订历史暂时无法加载</span>
            ) : revisions.length === 0 ? <span>暂无修订历史</span> : revisions.map((revision) => (
              <article key={revision.id} className="topic-revision">
                <header><strong>第 {revision.revisionNumber} 版</strong><time>{revision.createdAt}</time></header>
                <p>{revision.content}</p>
              </article>
            ))}
          </div>
        )}
      </article>

      <section className="reply-section" aria-labelledby="reply-heading">
        <div className="reply-section__heading">
          <MessageCircle size={18} aria-hidden="true" />
          <h2 id="reply-heading">回复</h2>
          <span>{topic.replies}</span>
        </div>

        {replies.length === 0 ? (
          <div className="reply-empty" role="status">还没有回复</div>
        ) : (
          <ol className="reply-list">
            {replies.map((reply, index) => (
              <li key={reply.id}>
                <ReplyItem
                  reply={reply}
                  floor={index + 1}
                  session={session}
                  onLogin={onLogin}
                  onUpdated={handleReplyUpdated}
                  onDeleted={handleReplyDeleted}
                  onRefresh={() => setRequestVersion((value) => value + 1)}
                />
              </li>
            ))}
          </ol>
        )}

        {nextCursor && (
          <button className="secondary-button reply-load-more" type="button" onClick={() => void loadMoreReplies()} disabled={loadingMore}>
            {loadingMore && <LoaderCircle className="topic-loading__spinner" size={15} aria-hidden="true" />}
            {loadingMore ? "正在加载" : "加载更多回复"}
          </button>
        )}

        {session ? (
          <form className="reply-form" onSubmit={(event) => { event.preventDefault(); void submitReply() }} aria-busy={submitting}>
            <label htmlFor="reply-content">参与讨论</label>
            <textarea
              id="reply-content"
              rows={5}
              value={content}
              placeholder="写下你的回复"
              aria-invalid={fieldError ? "true" : undefined}
              aria-describedby={fieldError ? "reply-content-error" : undefined}
              onChange={(event) => {
                setContent(event.target.value)
                idempotencyKeyRef.current = null
              }}
            />
            {fieldError && <p id="reply-content-error" className="composer-field-error">{fieldError}</p>}
            {formError && <p className="composer-form-error" role="alert">{formError}</p>}
            <div className="reply-form__actions">
              <span>{[...content].length.toLocaleString("zh-CN")} / 100,000</span>
              <button className="primary-button" type="submit" disabled={submitting}>
                {submitting ? <LoaderCircle className="topic-loading__spinner" size={16} aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
                {submitting ? "正在发布" : "发布回复"}
              </button>
            </div>
          </form>
        ) : (
          <div className="reply-sign-in">
            <span>登录后参与讨论</span>
            <button className="secondary-button" type="button" onClick={onLogin}>登录</button>
          </div>
        )}
      </section>
    </section>
  )
}

function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `reply-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
