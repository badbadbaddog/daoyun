import {
  ArrowLeft,
  Bookmark,
  ChevronRight,
  Edit3,
  FileSearch,
  Flag,
  History,
  LoaderCircle,
  MessageCircle,
  RefreshCw,
  Save,
  Send,
  Share2,
  Trash2,
  ThumbsUp,
  X,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"

import type { AuthSession } from "../api/auth"
import { uploadDraftImage } from "../api/attachments"
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
import { plainTextDocument, type RichTextDocument } from "../editor/richContent"
import { parseTopicTags } from "../utils/tags"
import { topicDisplayTitle } from "../utils/topicPresentation"
import { ReplyItem } from "./ReplyItem"
import { RichTextContent } from "./RichTextContent"
import { RichTextEditor } from "./RichTextEditor"
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
  onTopicLoaded?: (topic: TopicDetail | null) => void
}

type LoadStatus = "loading" | "ready" | "error"
const ignoreLoadedTopic = () => undefined

export function TopicDetailView({
  topicId,
  session,
  onBack,
  onLogin,
  onReplyPublished,
  onReplyDeleted = () => undefined,
  onTopicUpdated = () => undefined,
  onTopicDeleted = () => undefined,
  onTopicLoaded = ignoreLoadedTopic,
}: TopicDetailViewProps) {
  const idempotencyKeyRef = useRef<string | null>(null)
  const replyLoadGenerationRef = useRef(0)
  const topicStateRef = useRef<TopicDetail | null>(null)
  const [topic, setTopic] = useState<TopicDetail | null>(null)
  const [replies, setReplies] = useState<TopicReply[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading")
  const [requestVersion, setRequestVersion] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [content, setContent] = useState("")
  const [richContent, setRichContent] = useState<RichTextDocument>(() => plainTextDocument(""))
  const [replyTarget, setReplyTarget] = useState<TopicReply | null>(null)
  const [mobileReplyOpen, setMobileReplyOpen] = useState(false)
  const [fieldError, setFieldError] = useState("")
  const [formError, setFormError] = useState("")
  const [replyListError, setReplyListError] = useState("")
  const [replyStatus, setReplyStatus] = useState("")
  const [replyFocusId, setReplyFocusId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState("")
  const [draftContent, setDraftContent] = useState("")
  const [draftRichContent, setDraftRichContent] = useState<RichTextDocument>(() => plainTextDocument(""))
  const [draftTags, setDraftTags] = useState("")
  const [editError, setEditError] = useState("")
  const [revisionConflict, setRevisionConflict] = useState(false)
  const [revisions, setRevisions] = useState<TopicRevision[]>([])
  const [revisionStatus, setRevisionStatus] = useState<LoadStatus>("ready")
  const [showRevisions, setShowRevisions] = useState(false)
  const [bookmarkPending, setBookmarkPending] = useState(false)
  const [likePending, setLikePending] = useState(false)
  const [interactionError, setInteractionError] = useState("")
  const [shareMessage, setShareMessage] = useState("")
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deletePending, setDeletePending] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [reportReason, setReportReason] = useState<ReportReason>("spam")
  const [reportDetails, setReportDetails] = useState("")
  const [reportPending, setReportPending] = useState(false)
  const [reportMessage, setReportMessage] = useState("")
  const [reportError, setReportError] = useState("")
  const deleteConfirmRef = useRef<HTMLButtonElement>(null)
  const replyFormRef = useRef<HTMLFormElement>(null)
  const mobileReplyTriggerRef = useRef<HTMLButtonElement>(null)
  const onTopicLoadedRef = useRef(onTopicLoaded)
  onTopicLoadedRef.current = onTopicLoaded

  useEffect(() => {
    if (confirmingDelete) deleteConfirmRef.current?.focus()
  }, [confirmingDelete])

  useEffect(() => {
    if (!replyFocusId) return
    const replyElement = document.getElementById(`reply-${replyFocusId}`)
    if (!replyElement) return
    replyElement.focus()
    setReplyFocusId(null)
  }, [replies, replyFocusId])

  useEffect(() => {
    const controller = new AbortController()
    replyLoadGenerationRef.current += 1
    setLoadStatus("loading")
    setLoadingMore(false)
    setTopic(null)
    topicStateRef.current = null
    onTopicLoadedRef.current(null)
    setReplies([])
    setNextCursor(null)
    setReplyListError("")
    setReplyStatus("")

    Promise.all([
      getTopic(topicId, controller.signal),
      listReplies(topicId, { signal: controller.signal }),
    ]).then(([loadedTopic, page]) => {
      if (!controller.signal.aborted) {
        topicStateRef.current = loadedTopic
        setTopic(loadedTopic)
        onTopicLoadedRef.current(loadedTopic)
        setDraftTitle(loadedTopic.title)
        setDraftContent(loadedTopic.content)
        setDraftRichContent(loadedTopic.richContent ?? plainTextDocument(loadedTopic.content))
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
        onTopicLoadedRef.current(null)
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
    setDraftRichContent(topic.richContent ?? plainTextDocument(topic.content))
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
    setDraftRichContent(topic.richContent ?? plainTextDocument(topic.content))
    setDraftTags(topic.tags.map((tag) => tag.name).join(", "))
    setEditError("")
    setRevisionConflict(false)
    setEditing(false)
  }

  async function submitEdit() {
    if (!topic || !session || !canEdit || submitting) return
    const title = draftTitle.trim()
    const contentValue = draftContent.trim()
    if ([...title].length > 160) {
      setEditError("标题最多 160 个字符")
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
        richContent: draftRichContent,
        tags: parseTopicTags(draftTags, topic.tags),
      }, { csrfToken: session.csrfToken })
      topicStateRef.current = updated
      setTopic(updated)
      setDraftTitle(updated.title)
      setDraftContent(updated.content)
      setDraftRichContent(updated.richContent ?? plainTextDocument(updated.content))
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
          ?? error.fields.rich_content?.[0]
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
    const generation = replyLoadGenerationRef.current
    setLoadingMore(true)
    setReplyListError("")
    try {
      const page = await listReplies(topicId, { cursor: nextCursor })
      if (generation !== replyLoadGenerationRef.current) return
      setReplies((current) => [
        ...current,
        ...page.replies.filter((reply) => !current.some((item) => item.id === reply.id)),
      ])
      setNextCursor(page.nextCursor)
    } catch {
      if (generation !== replyLoadGenerationRef.current) return
      setReplyListError("更多回复暂时无法加载，请重试")
    } finally {
      if (generation === replyLoadGenerationRef.current) setLoadingMore(false)
    }
  }

  async function submitReply() {
    if (submitting) return
    const normalizedContent = content.trim()
    setFieldError("")
    setFormError("")
    setReplyStatus("")
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
        replyToId: replyTarget?.id,
      }, richContent)
      setReplies((current) => current.some((item) => item.id === reply.id)
        ? current
        : [...current, reply])
      setTopic((current) => {
        const updated = current ? { ...current, replies: current.replies + 1 } : current
        topicStateRef.current = updated
        return updated
      })
      setContent("")
      setRichContent(plainTextDocument(""))
      setReplyTarget(null)
      setMobileReplyOpen(false)
      setReplyStatus(`回复已发布至 #${reply.floorNumber} 楼`)
      setReplyFocusId(reply.id)
      idempotencyKeyRef.current = null
      onReplyPublished(topicId)
    } catch (error) {
      if (error instanceof TopicApiError) {
        setFieldError(error.fields.content?.[0] ?? error.fields.rich_content?.[0] ?? "")
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
    setTopic((current) => {
      const updated = current
        ? { ...current, replies: Math.max(0, current.replies - 1) }
        : current
      topicStateRef.current = updated
      return updated
    })
    onReplyDeleted(topicId)
    if (replyTarget?.id === replyId) clearReplyTarget()
  }

  function clearReplyTarget() {
    setReplyTarget(null)
    idempotencyKeyRef.current = null
  }

  function beginReplyTo(reply: TopicReply) {
    if (!session) {
      onLogin()
      return
    }
    setReplyTarget(reply)
    setMobileReplyOpen(true)
    idempotencyKeyRef.current = null
    queueMicrotask(() => replyFormRef.current?.querySelector<HTMLElement>("[role='textbox']")?.focus())
  }

  function openMobileReplyComposer() {
    if (!session) {
      onLogin()
      return
    }
    setReplyTarget(null)
    idempotencyKeyRef.current = null
    setMobileReplyOpen(true)
    queueMicrotask(() => replyFormRef.current?.querySelector<HTMLElement>("[role='textbox']")?.focus())
  }

  function closeMobileReplyComposer() {
    setMobileReplyOpen(false)
    queueMicrotask(() => mobileReplyTriggerRef.current?.focus())
  }

  async function toggleBookmark() {
    if (!topic) return
    if (!session) {
      onLogin()
      return
    }
    if (bookmarkPending) return
    const targetTopicId = topic.id
    setBookmarkPending(true)
    setInteractionError("")
    try {
      const state = await setTopicBookmark(targetTopicId, topic.bookmarked !== true, session.csrfToken)
      const current = topicStateRef.current
      if (!current || current.id !== targetTopicId) return
      const updated = { ...current, bookmarked: state.bookmarked }
      topicStateRef.current = updated
      setTopic(updated)
      onTopicUpdated(updated)
    } catch (caught) {
      if (caught instanceof RelationApiError && caught.status === 401) onLogin()
      setInteractionError("收藏操作失败，请重试")
    } finally {
      setBookmarkPending(false)
    }
  }

  async function toggleTopicLike() {
    if (!topic) return
    if (!session) {
      onLogin()
      return
    }
    if (likePending) return
    const targetTopicId = topic.id
    setLikePending(true)
    setInteractionError("")
    try {
      const state = await setPostLike(targetTopicId, topic.liked !== true, session.csrfToken)
      const current = topicStateRef.current
      if (!current || current.id !== targetTopicId) return
      const updated = { ...current, liked: state.liked, likes: state.likeCount }
      topicStateRef.current = updated
      setTopic(updated)
      onTopicUpdated(updated)
    } catch (caught) {
      if (caught instanceof RelationApiError && caught.status === 401) onLogin()
      setInteractionError("点赞操作失败，请重试")
    } finally {
      setLikePending(false)
    }
  }

  async function shareTopic() {
    if (!topic) return
    const shareUrl = new URL(window.location.href)
    shareUrl.hash = `topic/${topic.id}`
    setShareMessage("")
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable")
      await navigator.clipboard.writeText(shareUrl.toString())
      setShareMessage("链接已复制")
    } catch {
      setShareMessage("链接复制失败，请从地址栏复制")
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

  const displayTitle = topicDisplayTitle(topic)

  return (
    <section className="topic-detail" aria-labelledby="topic-detail-title">
      <div className="topic-detail__toolbar">
        <nav className="topic-detail__breadcrumb" aria-label="主题位置">
          <a href="#boards">社区</a>
          <ChevronRight size={12} aria-hidden="true" />
          <a href={topic.boardSlug ? `#board/${topic.boardSlug}` : "#boards"}>{topic.board}</a>
          <ChevronRight size={12} aria-hidden="true" />
          <span aria-current="page">主题详情</span>
        </nav>
        <button className="secondary-button" type="button" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" />
          返回主题列表
        </button>
      </div>

      <article className="topic-detail__article" aria-labelledby="topic-detail-title">
        <div className="topic-detail__title-row">
          <h1 id="topic-detail-title">{displayTitle}</h1>
          {canEdit && !editing && (
            <button className="secondary-button" type="button" onClick={beginEditing}>
              <Edit3 size={15} aria-hidden="true" />
              编辑
            </button>
          )}
        </div>
        <div className="topic-detail__author-meta" aria-label="主题作者与发布信息">
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
            <span className="topic-detail__author-copy">
              <strong>{topic.author}</strong>
              <span>@{topic.authorUsername}</span>
            </span>
          </a>
          <div className="topic-detail__publication">
            <a className={`board-tag board-tag--${topic.boardTone}`} href={topic.boardSlug ? `#board/${topic.boardSlug}` : "#boards"}>
              {topic.board}
            </a>
            <time dateTime={topic.publishedAtIso}>{topic.publishedAt}</time>
            <span aria-hidden="true">·</span>
            <span>{topic.views} 浏览</span>
          </div>
        </div>
        {topic.tags.length > 0 && (
          <ul className="topic-detail__tags" aria-label="主题标签">
            {topic.tags.map((tag) => <li className="topic-tag" key={tag.slug}>#{tag.name}</li>)}
          </ul>
        )}
        {editing ? (
          <form className="topic-edit-form" onSubmit={(event) => { event.preventDefault(); void submitEdit() }} aria-busy={submitting}>
            <label>
              <span>标题（可选）</span>
              <input value={draftTitle} maxLength={160} onChange={(event) => setDraftTitle(event.target.value)} />
            </label>
            <div className="composer-field">
              <span className="composer-field__label">正文</span>
              <RichTextEditor
                value={draftRichContent}
                onChange={(document, plainText) => {
                  setDraftRichContent(document)
                  setDraftContent(plainText)
                }}
                ariaLabel="编辑主题正文"
                placeholder="补充主题正文"
                maxCharacters={1_000_000}
                onImageUpload={session
                  ? (file, onProgress, signal) => uploadDraftImage(file, session.csrfToken, onProgress, signal)
                  : undefined}
                disabled={submitting}
              />
            </div>
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
          <RichTextContent
            className="topic-detail__content"
            document={topic.richContent ?? plainTextDocument(topic.content)}
          />
        )}
        <div className="topic-interactions" aria-label="主题互动">
          <button
            className="secondary-button topic-interactions__like"
            type="button"
            aria-label={topic.liked ? "取消点赞主题" : "点赞主题"}
            aria-pressed={topic.liked === true}
            disabled={likePending}
            onClick={() => void toggleTopicLike()}
          >
            {likePending
              ? <LoaderCircle className="topic-loading__spinner" size={15} aria-hidden="true" />
              : <ThumbsUp size={15} fill={topic.liked ? "currentColor" : "none"} aria-hidden="true" />}
            {topic.liked ? "已点赞" : "点赞"} {topic.likes}
          </button>
          <button
            className="secondary-button"
            type="button"
            aria-label={topic.bookmarked ? "取消收藏主题" : "收藏主题"}
            aria-pressed={topic.bookmarked === true}
            disabled={bookmarkPending}
            onClick={() => void toggleBookmark()}
          >
            {bookmarkPending
              ? <LoaderCircle className="topic-loading__spinner" size={15} aria-hidden="true" />
              : <Bookmark size={15} fill={topic.bookmarked ? "currentColor" : "none"} aria-hidden="true" />}
            {topic.bookmarked ? "已收藏" : "收藏"}
          </button>
          <button className="secondary-button" type="button" aria-label="回复主题" onClick={openMobileReplyComposer}>
            <MessageCircle size={15} aria-hidden="true" />
            回复 {topic.replies}
          </button>
          <button className="secondary-button" type="button" aria-label="分享主题" onClick={() => void shareTopic()}>
            <Share2 size={15} aria-hidden="true" />
            分享
          </button>
          <button className="secondary-button" type="button" onClick={beginReport}>
            <Flag size={15} aria-hidden="true" />
            举报主题
          </button>
        </div>
        {shareMessage && <p className="interaction-alert" role="status">{shareMessage}</p>}
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
                <RichTextContent document={revision.richContent ?? plainTextDocument(revision.content)} />
              </article>
            ))}
          </div>
        )}
      </article>

      <section className="reply-section" aria-labelledby="reply-heading">
        <div className="reply-section__heading">
          <div className="reply-section__title">
            <MessageCircle size={18} aria-hidden="true" />
            <h2 id="reply-heading">评论</h2>
            <span>{topic.replies} 条</span>
          </div>
          <button
            className="secondary-button reply-section__compose"
            type="button"
            aria-controls={session ? "topic-reply-composer" : undefined}
            onClick={openMobileReplyComposer}
          >
            <MessageCircle size={14} aria-hidden="true" />
            写回复
          </button>
        </div>

        {replyStatus && <p className="reply-section__notice" role="status">{replyStatus}</p>}
        {replyListError && <p className="reply-section__notice reply-section__notice--error" role="alert">{replyListError}</p>}

        {replies.length === 0 ? (
          <div className="reply-empty" role="status">还没有回复</div>
        ) : (
          <ol className="reply-list">
            {replies.map((reply) => (
              <li key={reply.id} data-reply-level={reply.replyTo ? "1" : "0"}>
                <ReplyItem
                  reply={reply}
                  session={session}
                  onReplyTo={beginReplyTo}
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
          <form
            id="topic-reply-composer"
            ref={replyFormRef}
            className={`reply-form${mobileReplyOpen ? " reply-form--mobile-open" : ""}`}
            onSubmit={(event) => { event.preventDefault(); void submitReply() }}
            aria-busy={submitting}
            aria-label="评论编辑器"
          >
            <div className="reply-form__mobile-header">
              <strong>{replyTarget ? `回复 ${replyTarget.floorNumber} 楼` : "参与讨论"}</strong>
              <button className="icon-button" type="button" aria-label="收起评论输入框" title="收起评论输入框" onClick={closeMobileReplyComposer}>
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <span className="composer-field__label">参与讨论</span>
            {replyTarget && (
              <div className="reply-target" role="status">
                <div><span>回复 #{replyTarget.floorNumber} @{replyTarget.author.username}</span><p>{replyTarget.content.slice(0, 160)}</p></div>
                <button className="icon-button" type="button" aria-label="取消回复指定楼层" title="取消回复指定楼层" onClick={clearReplyTarget}><X size={15} aria-hidden="true" /></button>
              </div>
            )}
            <RichTextEditor
              value={richContent}
              ariaLabel="参与讨论"
              placeholder="写下你的回复"
              maxCharacters={100_000}
              onImageUpload={(file, onProgress, signal) => uploadDraftImage(file, session.csrfToken, onProgress, signal)}
              disabled={submitting}
              invalid={Boolean(fieldError)}
              errorMessageId={fieldError ? "reply-content-error" : undefined}
              onChange={(document, plainText) => {
                if (plainText !== content || JSON.stringify(document) !== JSON.stringify(richContent)) {
                  idempotencyKeyRef.current = null
                }
                setRichContent(document)
                setContent(plainText)
              }}
            />
            {fieldError && <p id="reply-content-error" className="composer-field-error">{fieldError}</p>}
            {formError && <p className="composer-form-error" role="alert">{formError}</p>}
            <div className="reply-form__actions">
              <span>请友善交流，聚焦主题</span>
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

      <div className="topic-mobile-comment-entry">
        <button
          ref={mobileReplyTriggerRef}
          type="button"
          aria-label="写评论"
          aria-controls={session ? "topic-reply-composer" : undefined}
          aria-expanded={session ? mobileReplyOpen : undefined}
          onClick={openMobileReplyComposer}
        >
          <MessageCircle size={17} aria-hidden="true" />
          <span>{session ? "写评论…" : "登录后参与讨论"}</span>
        </button>
      </div>
    </section>
  )
}

function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `reply-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
