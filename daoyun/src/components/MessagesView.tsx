import { FormEvent, useEffect, useRef, useState } from "react"
import {
  Archive,
  ArrowLeft,
  FileSearch,
  LoaderCircle,
  MessageCircle,
  RefreshCw,
  Send,
} from "lucide-react"

import type { AuthSession } from "../api/auth"
import {
  archiveConversation,
  listConversations,
  listMessages,
  markConversationRead,
  sendMessage,
} from "../api/messages"
import type { ConversationSummary, DirectMessage } from "../api/messages"
import { UserAvatar } from "./UserAvatar"

interface MessagesViewProps {
  session: AuthSession | null
  conversationId: string | null
  initialConversation?: ConversationSummary | null
  onSelectConversation: (conversationId: string | null) => void
  onBack: () => void
  onLogin: () => void
}

type LoadStatus = "loading" | "ready" | "error"

interface RetryMessage {
  content: string
  key: string
}

export function MessagesView({
  session,
  conversationId,
  initialConversation = null,
  onSelectConversation,
  onBack,
  onLogin,
}: MessagesViewProps) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [conversationCursor, setConversationCursor] = useState<string | null>(null)
  const [conversationStatus, setConversationStatus] = useState<LoadStatus>(
    session ? "loading" : "ready",
  )
  const [conversationRequestVersion, setConversationRequestVersion] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(conversationId)
  const selectedIdRef = useRef<string | null>(conversationId)
  const [messages, setMessages] = useState<DirectMessage[]>([])
  const [messageCursor, setMessageCursor] = useState<string | null>(null)
  const [messageStatus, setMessageStatus] = useState<LoadStatus>("ready")
  const [messageRequestVersion, setMessageRequestVersion] = useState(0)
  const [loadingMoreConversations, setLoadingMoreConversations] = useState(false)
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false)
  const [draft, setDraft] = useState("")
  const [sendPending, setSendPending] = useState(false)
  const [sendError, setSendError] = useState("")
  const [retryMessage, setRetryMessage] = useState<RetryMessage | null>(null)
  const [archivePending, setArchivePending] = useState(false)
  const [interactionError, setInteractionError] = useState("")

  useEffect(() => {
    selectedIdRef.current = conversationId
    setSelectedId(conversationId)
  }, [conversationId])

  useEffect(() => {
    if (!session) {
      setConversations([])
      setConversationCursor(null)
      setConversationStatus("ready")
      selectedIdRef.current = null
      setSelectedId(null)
      return
    }
    const controller = new AbortController()
    setConversationStatus("loading")
    listConversations({ signal: controller.signal }).then((page) => {
      if (controller.signal.aborted) return
      const seed = initialConversation?.id === conversationId ? initialConversation : null
      const nextConversations = seed && !page.conversations.some((item) => item.id === seed.id)
        ? [seed, ...page.conversations]
        : page.conversations
      setConversations(nextConversations)
      setConversationCursor(page.nextCursor)
      setConversationStatus("ready")
      setSelectedId((current) => {
        const next = conversationId ?? current
        selectedIdRef.current = next
        return next
      })
    }).catch(() => {
      if (!controller.signal.aborted) setConversationStatus("error")
    })
    return () => controller.abort()
  }, [conversationId, conversationRequestVersion, initialConversation, session])

  useEffect(() => {
    if (!session || !selectedId) {
      setMessages([])
      setMessageCursor(null)
      setMessageStatus("ready")
      return
    }
    const controller = new AbortController()
    setMessageStatus("loading")
    setSendError("")
    listMessages(selectedId, { signal: controller.signal }).then((page) => {
      if (controller.signal.aborted) return
      setMessages(page.messages)
      setMessageCursor(page.nextCursor)
      setMessageStatus("ready")
      const latest = page.messages[0]
      if (latest && latest.sender.id !== session.user.id) {
        void markConversationRead(selectedId, latest.id, session.csrfToken).then((state) => {
          setConversations((current) => current.map((conversation) => (
            conversation.id === state.conversationId
              ? { ...conversation, unreadCount: state.unreadCount }
              : conversation
          )))
        }).catch(() => undefined)
      }
    }).catch(() => {
      if (!controller.signal.aborted) setMessageStatus("error")
    })
    return () => controller.abort()
  }, [messageRequestVersion, selectedId, session])

  const selectedConversation = conversations.find((conversation) => conversation.id === selectedId)
    ?? null

  function selectConversation(id: string) {
    selectedIdRef.current = id
    setSelectedId(id)
    setDraft("")
    setRetryMessage(null)
    setSendError("")
    onSelectConversation(id)
  }

  async function handleLoadMoreConversations() {
    if (!conversationCursor || loadingMoreConversations) return
    setLoadingMoreConversations(true)
    setInteractionError("")
    try {
      const page = await listConversations({ cursor: conversationCursor })
      setConversations((current) => [
        ...current,
        ...page.conversations.filter((item) => !current.some((existing) => existing.id === item.id)),
      ])
      setConversationCursor(page.nextCursor)
    } catch {
      setInteractionError("更多会话暂时无法加载。")
    } finally {
      setLoadingMoreConversations(false)
    }
  }

  async function handleLoadOlderMessages() {
    if (!selectedId || !messageCursor || loadingOlderMessages) return
    const requestConversationId = selectedId
    setLoadingOlderMessages(true)
    setInteractionError("")
    try {
      const page = await listMessages(requestConversationId, { cursor: messageCursor })
      if (selectedIdRef.current !== requestConversationId) return
      setMessages((current) => [
        ...current,
        ...page.messages.filter((item) => !current.some((existing) => existing.id === item.id)),
      ])
      setMessageCursor(page.nextCursor)
    } catch {
      if (selectedIdRef.current === requestConversationId) {
        setInteractionError("更早的消息暂时无法加载。")
      }
    } finally {
      setLoadingOlderMessages(false)
    }
  }

  async function handleSend(event?: FormEvent) {
    event?.preventDefault()
    if (!session || !selectedId || sendPending) return
    const content = draft.trim()
    if (!content) {
      setSendError("请输入消息正文。")
      return
    }
    if ([...content].length > 10_000) {
      setSendError("消息正文不能超过 10000 个字符。")
      return
    }
    const retry = retryMessage?.content === content ? retryMessage : {
      content,
      key: createMessageKey(),
    }
    setRetryMessage(retry)
    setSendPending(true)
    setSendError("")
    const requestConversationId = selectedId
    try {
      const message = await sendMessage(
        requestConversationId,
        content,
        session.csrfToken,
        retry.key,
      )
      if (selectedIdRef.current === requestConversationId) {
        setMessages((current) => [message, ...current.filter((item) => item.id !== message.id)])
      }
      setConversations((current) => {
        const selected = current.find((item) => item.id === requestConversationId)
        if (!selected) return current
        const updated: ConversationSummary = {
          ...selected,
          lastMessage: {
            id: message.id,
            senderId: message.sender.id,
            content: message.content,
            createdAt: message.createdAt,
          },
          unreadCount: 0,
          updatedAt: message.createdAt,
        }
        return [updated, ...current.filter((item) => item.id !== requestConversationId)]
      })
      if (selectedIdRef.current === requestConversationId) {
        setDraft("")
        setRetryMessage(null)
      }
    } catch {
      if (selectedIdRef.current === requestConversationId) {
        setSendError("消息暂时无法发送。")
      }
    } finally {
      setSendPending(false)
    }
  }

  async function handleArchive() {
    if (!session || !selectedConversation || archivePending) return
    const requestConversationId = selectedConversation.id
    setArchivePending(true)
    setInteractionError("")
    try {
      await archiveConversation(requestConversationId, session.csrfToken)
      setConversations((current) => current.filter((item) => item.id !== requestConversationId))
      if (selectedIdRef.current === requestConversationId) {
        selectedIdRef.current = null
        setSelectedId(null)
        setMessages([])
        onSelectConversation(null)
      }
    } catch {
      if (selectedIdRef.current === requestConversationId) {
        setInteractionError("会话暂时无法归档。")
      }
    } finally {
      setArchivePending(false)
    }
  }

  return (
    <section className="messages-view" aria-labelledby="messages-heading">
      <button className="detail-back" type="button" onClick={onBack}>
        <ArrowLeft size={16} aria-hidden="true" />
        返回社区
      </button>
      <header className="messages-view__header">
        <div>
          <p>一对一交流</p>
          <h1 id="messages-heading">私信</h1>
        </div>
        <MessageCircle size={21} aria-hidden="true" />
      </header>

      {!session ? (
        <div className="empty-state messages-view__guest" role="status">
          <MessageCircle size={28} aria-hidden="true" />
          <h2>登录后查看私信</h2>
          <p>与社区成员的会话会集中显示在这里。</p>
          <button className="primary-button empty-state__action" type="button" onClick={onLogin}>
            登录查看私信
          </button>
        </div>
      ) : conversationStatus === "loading" ? (
        <LoadingMessage label="正在加载会话" />
      ) : conversationStatus === "error" ? (
        <div className="empty-state" role="alert">
          <FileSearch size={28} aria-hidden="true" />
          <h2>会话暂时无法加载</h2>
          <p>请检查网络连接后重试。</p>
          <button className="secondary-button empty-state__action" type="button" onClick={() => setConversationRequestVersion((version) => version + 1)}>
            <RefreshCw size={15} aria-hidden="true" />
            重试加载会话
          </button>
        </div>
      ) : conversations.length === 0 ? (
        <div className="empty-state" role="status">
          <MessageCircle size={28} aria-hidden="true" />
          <h2>还没有私信会话</h2>
          <p>从其他成员的个人主页发起私信。</p>
        </div>
      ) : (
        <div className={selectedConversation ? "messages-workspace messages-workspace--selected" : "messages-workspace"}>
          <aside className="conversation-pane" aria-label="私信会话列表">
            <div className="conversation-list">
              {conversations.map((conversation) => (
                <button
                  className={conversation.id === selectedId ? "conversation-item conversation-item--active" : "conversation-item"}
                  type="button"
                  key={conversation.id}
                  onClick={() => selectConversation(conversation.id)}
                  aria-current={conversation.id === selectedId ? "page" : undefined}
                >
                  <UserAvatar
                    username={conversation.otherUser.username}
                    displayName={conversation.otherUser.displayName}
                    avatarUrl={conversation.otherUser.avatarUrl}
                  />
                  <span className="conversation-item__body">
                    <span className="conversation-item__heading">
                      <strong>{conversation.otherUser.displayName}</strong>
                      <time dateTime={conversation.updatedAt}>{formatMessageTime(conversation.updatedAt)}</time>
                    </span>
                    <span className="conversation-item__preview">
                      <span>{conversation.lastMessage?.content ?? "新会话"}</span>
                      {conversation.unreadCount > 0 && (
                        <b aria-label={`${conversation.unreadCount} 条未读消息`}>{conversation.unreadCount}</b>
                      )}
                    </span>
                  </span>
                </button>
              ))}
            </div>
            {conversationCursor && (
              <button className="conversation-pane__more" type="button" onClick={handleLoadMoreConversations} disabled={loadingMoreConversations}>
                {loadingMoreConversations ? "正在加载" : "加载更多会话"}
              </button>
            )}
          </aside>

          <section className="message-pane" aria-label="当前私信会话">
            {!selectedConversation ? (
              <div className="empty-state message-pane__state" role="status">
                <MessageCircle size={24} aria-hidden="true" />
                <p>请选择一个会话</p>
              </div>
            ) : (
              <>
              <header className="message-pane__header">
                <button
                  className="icon-button message-pane__mobile-back"
                  type="button"
                  onClick={() => {
                    selectedIdRef.current = null
                    setSelectedId(null)
                    onSelectConversation(null)
                  }}
                  aria-label="返回会话列表"
                >
                  <ArrowLeft size={17} />
                </button>
                <a href={`#user/${selectedConversation.otherUser.username}`}>
                  <UserAvatar
                    username={selectedConversation.otherUser.username}
                    displayName={selectedConversation.otherUser.displayName}
                    avatarUrl={selectedConversation.otherUser.avatarUrl}
                    size="small"
                  />
                  <span>
                    <strong>{selectedConversation.otherUser.displayName}</strong>
                    <small>@{selectedConversation.otherUser.username}</small>
                  </span>
                </a>
                <button
                  className="icon-button"
                  type="button"
                  onClick={handleArchive}
                  disabled={archivePending}
                  aria-label={`归档与${selectedConversation.otherUser.displayName}的会话`}
                  title="归档会话"
                >
                  {archivePending
                    ? <LoaderCircle className="topic-loading__spinner" size={17} />
                    : <Archive size={17} />}
                </button>
              </header>

              {messageStatus === "loading" ? (
              <LoadingMessage label="正在加载消息" />
              ) : messageStatus === "error" ? (
              <div className="empty-state message-pane__state" role="alert">
                <FileSearch size={24} aria-hidden="true" />
                <p>消息暂时无法加载</p>
                <button className="secondary-button" type="button" onClick={() => setMessageRequestVersion((version) => version + 1)}>
                  <RefreshCw size={15} aria-hidden="true" />
                  重试加载消息
                </button>
              </div>
            ) : (
              <div className="message-history" aria-live="polite">
                {messageCursor && (
                  <button className="message-history__more" type="button" onClick={handleLoadOlderMessages} disabled={loadingOlderMessages}>
                    {loadingOlderMessages ? "正在加载" : "加载更早消息"}
                  </button>
                )}
                {messages.length === 0 ? (
                  <p className="message-history__empty">发送第一条消息</p>
                ) : [...messages].reverse().map((message) => (
                  <article
                    className={message.sender.id === session.user.id ? "message-bubble message-bubble--own" : "message-bubble"}
                    key={message.id}
                  >
                    <p>{message.content}</p>
                    <time dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
                  </article>
                ))}
              </div>
              )}

              <form className="message-composer" onSubmit={handleSend}>
              {interactionError && <p className="interaction-alert" role="alert">{interactionError}</p>}
              {sendError && (
                <div className="message-composer__error" role="alert">
                  <span>{sendError}</span>
                  <button type="button" onClick={() => void handleSend()} disabled={sendPending}>
                    重新发送
                  </button>
                </div>
              )}
              <div>
                <textarea
                  aria-label="消息正文"
                  placeholder="输入消息"
                  value={draft}
                  rows={2}
                  onChange={(event) => {
                    setDraft(event.target.value)
                    setSendError("")
                    if (retryMessage && retryMessage.content !== event.target.value.trim()) {
                      setRetryMessage(null)
                    }
                  }}
                />
                <button className="primary-button" type="submit" disabled={sendPending || !draft.trim()} aria-label="发送消息">
                  {sendPending
                    ? <LoaderCircle className="topic-loading__spinner" size={17} aria-hidden="true" />
                    : <Send size={17} aria-hidden="true" />}
                </button>
              </div>
              </form>
              </>
            )}
          </section>
        </div>
      )}
    </section>
  )
}

function LoadingMessage({ label }: { label: string }) {
  return (
    <div className="topic-loading" role="status">
      <LoaderCircle className="topic-loading__spinner" size={22} aria-hidden="true" />
      {label}
    </div>
  )
}

function createMessageKey(): string {
  return `message-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function formatMessageTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}
