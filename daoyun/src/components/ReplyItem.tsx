import {
  Flag,
  Edit3,
  LoaderCircle,
  RefreshCw,
  Reply as ReplyIcon,
  Save,
  ThumbsUp,
  Trash2,
  X,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"

import type { AuthSession } from "../api/auth"
import { formatRoute } from "../router/communityRoute"
import { uploadDraftImage } from "../api/attachments"
import { createReport, ReportApiError, type ReportReason } from "../api/reports"
import { RelationApiError, setPostLike } from "../api/relations"
import {
  deleteReply,
  TopicApiError,
  updateReply,
} from "../api/topics"
import type { TopicReply } from "../api/topics"
import { plainTextDocument, type RichTextDocument } from "../editor/richContent"
import { PublicMemberIdentity } from "./PublicMemberIdentity"
import { RichTextContent } from "./RichTextContent"
import { RichTextEditor } from "./RichTextEditor"
import { UserAvatar } from "./UserAvatar"

interface ReplyItemProps {
  reply: TopicReply
  session: AuthSession | null
  onReplyTo: (reply: TopicReply) => void
  onUpdated: (reply: TopicReply) => void
  onDeleted: (replyId: string) => void
  onRefresh: () => void
  onLogin: () => void
}

export function ReplyItem({
  reply,
  session,
  onReplyTo,
  onUpdated,
  onDeleted,
  onRefresh,
  onLogin,
}: ReplyItemProps) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(reply.content)
  const [draftRichContent, setDraftRichContent] = useState<RichTextDocument>(
    () => reply.richContent ?? plainTextDocument(reply.content),
  )
  const [busyAction, setBusyAction] = useState<"edit" | "delete" | "like" | null>(null)
  const [error, setError] = useState("")
  const [editNotice, setEditNotice] = useState("")
  const [conflict, setConflict] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [reportReason, setReportReason] = useState<ReportReason>("spam")
  const [reportDetails, setReportDetails] = useState("")
  const [reportPending, setReportPending] = useState(false)
  const [reportMessage, setReportMessage] = useState("")
  const canEdit = Boolean(session && session.user.id === reply.author.id)

  useEffect(() => {
    if (confirmingDelete) confirmButtonRef.current?.focus()
  }, [confirmingDelete])

  function beginEditing() {
    if (!canEdit) return
    setDraft(reply.content)
    setDraftRichContent(reply.richContent ?? plainTextDocument(reply.content))
    setError("")
    setEditNotice("")
    setConflict(false)
    setConfirmingDelete(false)
    setEditing(true)
  }

  function cancelEditing() {
    setDraft(reply.content)
    setDraftRichContent(reply.richContent ?? plainTextDocument(reply.content))
    setError("")
    setConflict(false)
    setEditing(false)
  }

  async function submitEdit() {
    if (!session || !canEdit || busyAction) return
    const content = draft.trim()
    if ([...content].length < 1 || [...content].length > 100_000) {
      setError("回复需为 1-100,000 个字符")
      return
    }
    setBusyAction("edit")
    setError("")
    try {
      const updated = await updateReply(reply.topicId, reply.id, {
        baseRevision: reply.revisionCount,
        content,
        richContent: draftRichContent,
      }, { csrfToken: session.csrfToken })
      if (updated.editDisposition === "pending_review") {
        setEditNotice("回复编辑已提交审核，审核通过前继续显示当前版本")
      } else {
        setEditNotice("")
        onUpdated(updated)
      }
      setDraft(updated.content)
      setDraftRichContent(updated.richContent ?? plainTextDocument(updated.content))
      setEditing(false)
      setConflict(false)
    } catch (caught) {
      if (caught instanceof TopicApiError && caught.status === 409) {
        setConflict(true)
        setError("回复已被其他操作更新，请刷新后重试")
      } else if (caught instanceof TopicApiError) {
        setError(caught.fields.content?.[0] ?? caught.fields.rich_content?.[0] ?? caught.fields.body?.[0] ?? caught.message)
      } else {
        setError("回复编辑服务暂时不可用，请稍后重试")
      }
    } finally {
      setBusyAction(null)
    }
  }

  async function confirmDelete() {
    if (!session || !canEdit || busyAction) return
    setBusyAction("delete")
    setError("")
    let deleted = false
    try {
      await deleteReply(reply.topicId, reply.id, { csrfToken: session.csrfToken })
      deleted = true
    } catch (caught) {
      setError(caught instanceof TopicApiError
        ? caught.message
        : "回复删除服务暂时不可用，请稍后重试")
    } finally {
      setBusyAction(null)
    }
    if (deleted) onDeleted(reply.id)
  }

  function refreshAfterConflict() {
    setEditing(false)
    setConflict(false)
    setError("")
    onRefresh()
  }

  async function toggleLike() {
    if (!session) {
      onLogin()
      return
    }
    if (busyAction) return
    setBusyAction("like")
    setError("")
    try {
      const state = await setPostLike(reply.id, reply.liked !== true, session.csrfToken)
      onUpdated({ ...reply, liked: state.liked, likeCount: state.likeCount })
    } catch (caught) {
      if (caught instanceof RelationApiError && caught.status === 401) onLogin()
      setError("点赞操作失败，请重试")
    } finally {
      setBusyAction(null)
    }
  }

  function beginReport() {
    if (!session) {
      onLogin()
      return
    }
    setReporting(true)
    setReportMessage("")
    setError("")
  }

  async function submitReport() {
    if (!session || reportPending) return
    const details = reportDetails.trim()
    if ([...details].length > 1000) {
      setError("补充说明不能超过 1,000 个字符")
      return
    }
    setReportPending(true)
    setError("")
    try {
      const receipt = await createReport("post", reply.id, reportReason, details || null, session.csrfToken)
      setReportMessage(receipt.created ? "举报已提交，管理员会尽快处理" : "你已经举报过该回复")
      setReporting(false)
      setReportDetails("")
    } catch (caught) {
      setError(caught instanceof ReportApiError && caught.status === 404
        ? "回复已不可访问，无法提交举报"
        : "举报服务暂时不可用，请稍后重试")
    } finally {
      setReportPending(false)
    }
  }

  return (
    <article className="reply-item" id={`reply-${reply.id}`} tabIndex={-1} aria-label={`第 ${reply.floorNumber} 楼回复`}>
      <a
        className="reply-item__avatar"
        href={`#user/${reply.author.username}`}
        aria-label={`查看 ${reply.author.displayName} 的主页`}
      >
        <UserAvatar
          username={reply.author.username}
          displayName={reply.author.displayName}
          avatarUrl={reply.author.avatarUrl}
          size="medium"
        />
      </a>
      <div className="reply-item__body">
        <header className="reply-item__header" aria-label={`第 ${reply.floorNumber} 楼作者信息`}>
          <div className="reply-item__identity">
            <a href={`#user/${reply.author.username}`}><strong>{reply.author.displayName}</strong></a>
            <span className="reply-item__username">@{reply.author.username}</span>
            <PublicMemberIdentity username={reply.author.username} />
          </div>
          <div className="reply-item__context">
            <time>{reply.createdAt}</time>
            {reply.revisionCount > 1 && <span>已编辑</span>}
            <a
              className="reply-floor"
              href={formatRoute({ kind: "topic", topicId: reply.topicId, replyId: reply.id })}
              aria-label={`定位到第 ${reply.floorNumber} 楼`}
            >
              #{reply.floorNumber}
            </a>
          </div>
        </header>

        {reply.replyTo && (
          <a
            className="reply-reference"
            href={formatRoute({ kind: "topic", topicId: reply.topicId, replyId: reply.replyTo.id })}
            aria-label={`引用第 ${reply.replyTo.floorNumber} 楼：${reply.replyTo.author.displayName}`}
          >
            <span className="reply-reference__label">引用 #{reply.replyTo.floorNumber}</span>
            <span className="reply-reference__author">
              <strong>{reply.replyTo.author.displayName}</strong>
              <span>@{reply.replyTo.author.username}</span>
            </span>
            <p>{reply.replyTo.isDeleted ? "该楼层已删除" : reply.replyTo.excerpt ?? "该楼层暂不可见"}</p>
          </a>
        )}

        {editing ? (
          <form className="reply-edit-form" onSubmit={(event) => { event.preventDefault(); void submitEdit() }} aria-busy={busyAction === "edit"}>
            <RichTextEditor
              value={draftRichContent}
              onChange={(document, plainText) => {
                setDraftRichContent(document)
                setDraft(plainText)
              }}
              ariaLabel="编辑回复内容"
              placeholder="修改回复内容"
              maxCharacters={100_000}
              onImageUpload={session
                ? (file, onProgress, signal) => uploadDraftImage(file, session.csrfToken, onProgress, signal)
                : undefined}
              disabled={busyAction !== null}
              invalid={Boolean(error)}
              errorMessageId={error ? `reply-edit-error-${reply.id}` : undefined}
            />
            {error && <p id={`reply-edit-error-${reply.id}`} className="composer-form-error" role="alert">{error}</p>}
            {conflict && (
              <button className="secondary-button" type="button" onClick={refreshAfterConflict}>
                <RefreshCw size={14} aria-hidden="true" />
                刷新回复列表
              </button>
            )}
            <div className="reply-edit-form__actions">
              <span>修改后会保留修订记录</span>
              <button className="secondary-button" type="button" onClick={cancelEditing} disabled={busyAction !== null}>
                <X size={14} aria-hidden="true" />
                取消
              </button>
              <button className="primary-button" type="submit" disabled={busyAction !== null}>
                {busyAction === "edit" ? <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}
                {busyAction === "edit" ? "正在保存" : "保存回复"}
              </button>
            </div>
          </form>
        ) : (
          <RichTextContent
            className="reply-content"
            document={reply.richContent ?? plainTextDocument(reply.content)}
          />
        )}
        {editNotice && <p className="interaction-alert" role="status">{editNotice}</p>}

        {!editing && (
          <div className="reply-item__toolbar" role="group" aria-label={`第 ${reply.floorNumber} 楼操作`}>
            <div className="reply-item__interactions">
              <button className="secondary-button" type="button" aria-label={`回复 ${reply.floorNumber} 楼`} onClick={() => onReplyTo(reply)}>
                <ReplyIcon size={14} aria-hidden="true" />
                回复
              </button>
              <button
                className="secondary-button reply-item__like"
                type="button"
                aria-label={reply.liked ? "取消点赞回复" : "点赞回复"}
                aria-pressed={reply.liked === true}
                disabled={busyAction !== null}
                onClick={() => void toggleLike()}
              >
                {busyAction === "like"
                  ? <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" />
                  : <ThumbsUp size={14} fill={reply.liked ? "currentColor" : "none"} aria-hidden="true" />}
                {reply.likeCount}
              </button>
              <button className="secondary-button" type="button" aria-label="举报回复" onClick={beginReport}>
                <Flag size={14} aria-hidden="true" />
                举报
              </button>
            </div>

            {canEdit && (
              <div className="reply-item__actions">
                <button className="secondary-button" type="button" aria-label="编辑回复" onClick={beginEditing}>
                  <Edit3 size={14} aria-hidden="true" />
                  编辑
                </button>
                <button
                  className="secondary-button reply-action--danger"
                  type="button"
                  aria-label="删除回复"
                  onClick={() => { setError(""); setConfirmingDelete(true) }}
                >
                  <Trash2 size={14} aria-hidden="true" />
                  删除
                </button>
              </div>
            )}
          </div>
        )}

        {reportMessage && <p className="interaction-alert" role="status">{reportMessage}</p>}
        {reporting && (
          <form className="report-form" aria-label="举报回复" onSubmit={(event) => { event.preventDefault(); void submitReport() }} aria-busy={reportPending}>
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
            <div className="report-form__actions">
              <button className="secondary-button" type="button" onClick={() => setReporting(false)} disabled={reportPending}><X size={14} aria-hidden="true" />取消</button>
              <button className="primary-button" type="submit" disabled={reportPending}>{reportPending ? <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" /> : <Flag size={14} aria-hidden="true" />}{reportPending ? "正在提交" : "提交举报"}</button>
            </div>
          </form>
        )}

        {confirmingDelete && (
          <div className="reply-delete-confirm" role="alertdialog" aria-label="确认删除回复" aria-describedby={`reply-delete-message-${reply.id}`}>
            <span id={`reply-delete-message-${reply.id}`}>确认删除这条回复？</span>
            <div>
              <button className="secondary-button" type="button" onClick={() => setConfirmingDelete(false)} disabled={busyAction !== null}>取消删除</button>
              <button ref={confirmButtonRef} className="primary-button reply-delete-confirm__submit" type="button" onClick={() => void confirmDelete()} disabled={busyAction !== null}>
                {busyAction === "delete" && <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" />}
                {busyAction === "delete" ? "正在删除" : "确认删除"}
              </button>
            </div>
          </div>
        )}
        {!editing && error && <p className="composer-form-error" role="alert">{error}</p>}

      </div>
    </article>
  )
}
