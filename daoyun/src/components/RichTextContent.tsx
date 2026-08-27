import type { ReactNode } from "react"

import {
  attachmentThumbnailUrl,
  safeImageDimension,
  type RichTextDocument,
  type RichTextMark,
  type RichTextNode,
} from "../editor/richContent"

interface RichTextContentProps {
  document: RichTextDocument
  className?: string
}

export function RichTextContent({ document, className = "" }: RichTextContentProps) {
  return (
    <div className={`rich-text-content ${className}`.trim()}>
      {document.content.map((node, index) => renderNode(node, `root-${index}`))}
    </div>
  )
}

function renderNode(node: RichTextNode, key: string): ReactNode {
  const children = node.content?.map((child, index) => renderNode(child, `${key}-${index}`))
  switch (node.type) {
    case "text":
      return <span key={key}>{applyMarks(node.text ?? "", node.marks ?? [], key)}</span>
    case "paragraph":
      return <p key={key}>{children}</p>
    case "heading": {
      const level = Number(node.attrs?.level)
      if (level === 2) return <h2 key={key}>{children}</h2>
      if (level === 3) return <h3 key={key}>{children}</h3>
      return <h4 key={key}>{children}</h4>
    }
    case "blockquote":
      return <blockquote key={key}>{children}</blockquote>
    case "replyGate":
      return node.attrs?.locked === true
        ? <aside key={key} className="reply-gate reply-gate--locked" role="note">回复主题后可见</aside>
        : <aside key={key} className="reply-gate"><strong>回复可见内容</strong>{children}</aside>
    case "bulletList":
      return <ul key={key}>{children}</ul>
    case "orderedList":
      return <ol key={key} start={safeListStart(node.attrs?.start)}>{children}</ol>
    case "listItem":
      return <li key={key}>{children}</li>
    case "codeBlock":
      return <pre key={key}><code>{plainNodeText(node)}</code></pre>
    case "horizontalRule":
      return <hr key={key} />
    case "hardBreak":
      return <br key={key} />
    case "image": {
      const src = attachmentThumbnailUrl(node.attrs?.attachmentId)
      if (!src) return null
      const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : ""
      const width = safeImageDimension(node.attrs?.width)
      const height = safeImageDimension(node.attrs?.height)
      return (
        <img
          key={key}
          src={src}
          alt={alt}
          width={width}
          height={height}
          style={width ? { width, height: "auto" } : undefined}
          loading="lazy"
          decoding="async"
        />
      )
    }
    default:
      return null
  }
}

function applyMarks(text: string, marks: RichTextMark[], key: string): ReactNode {
  const canHighlightMentions = !marks.some((mark) => mark.type === "link" || mark.type === "code")
  return marks.reduce<ReactNode>((content, mark, index) => {
    const markKey = `${key}-mark-${index}`
    switch (mark.type) {
      case "bold":
        return <strong key={markKey}>{content}</strong>
      case "italic":
        return <em key={markKey}>{content}</em>
      case "strike":
        return <s key={markKey}>{content}</s>
      case "code":
        return <code key={markKey}>{content}</code>
      case "link": {
        const href = safeHref(mark.attrs?.href)
        return href
          ? <a key={markKey} href={href} target="_blank" rel="noopener noreferrer">{content}</a>
          : content
      }
      default:
        return content
    }
  }, canHighlightMentions ? highlightMentions(text, key) : text)
}

function highlightMentions(text: string, key: string): ReactNode {
  const parts: ReactNode[] = []
  const mentionPattern = /(^|[^a-z0-9_])@([a-z][a-z0-9_]{2,31})(?![a-z0-9_])/gi
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = mentionPattern.exec(text)) !== null) {
    const prefixEnd = match.index + match[1].length
    if (prefixEnd > cursor) parts.push(text.slice(cursor, prefixEnd))
    const username = match[2].toLowerCase()
    parts.push(<a className="rich-text-mention" href={`#user/${username}`} key={`${key}-mention-${prefixEnd}`}>@{match[2]}</a>)
    cursor = prefixEnd + match[2].length + 1
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return parts.length > 0 ? parts : text
}

function safeHref(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 1 || value.length > 2_048) return null
  if (value.startsWith("/") && !value.startsWith("//")) return value
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:" ? value : null
  } catch {
    return null
  }
}

function safeListStart(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 10_000
    ? Number(value)
    : undefined
}

function plainNodeText(node: RichTextNode): string {
  if (node.type === "text") return node.text ?? ""
  return node.content?.map(plainNodeText).join("") ?? ""
}
