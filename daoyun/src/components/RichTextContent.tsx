import { useState, type CSSProperties, type ReactNode } from "react"

import {
  attachmentThumbnailUrl,
  safeImageDimension,
  type RichTextDocument,
  type RichTextMark,
  type RichTextNode,
} from "../editor/richContent"
import { findTopicHashtags } from "../utils/tags"
import { ImagePreviewDialog, type ImagePreviewSelection } from "./ImagePreviewDialog"

type OpenImagePreview = (selection: ImagePreviewSelection) => void

interface RichTextContentProps {
  document: RichTextDocument
  className?: string
  imageLayout?: "inline" | "strip"
}

export function RichTextContent({ document, className = "", imageLayout = "inline" }: RichTextContentProps) {
  const [preview, setPreview] = useState<ImagePreviewSelection | null>(null)
  const images = visibleDocumentImages(document.content)
  const openPreview: OpenImagePreview = selection => {
    const index = images.findIndex(image => image.src === selection.images[selection.index]?.src)
    if (index >= 0) setPreview({ ...selection, images, index })
  }
  return (
    <>
      <div className={`rich-text-content ${className}`.trim()}>
        {renderContentNodes(document.content, imageLayout, openPreview)}
      </div>
      {preview && <ImagePreviewDialog selection={preview} onClose={() => setPreview(null)} />}
    </>
  )
}

function visibleDocumentImages(nodes: RichTextNode[]): Array<{ src: string; alt: string }> {
  const images: Array<{ src: string; alt: string }> = []
  function collect(node: RichTextNode) {
    if (node.type === "replyGate" && node.attrs?.locked === true) return
    if (node.type === "image") {
      const src = attachmentThumbnailUrl(node.attrs?.attachmentId)
      if (src && !images.some(image => image.src === src)) images.push(previewImage(node, src))
    }
    node.content?.forEach(collect)
  }
  nodes.forEach(collect)
  return images
}

function renderContentNodes(nodes: RichTextNode[], imageLayout: "inline" | "strip", onPreview: OpenImagePreview): ReactNode[] {
  if (imageLayout === "inline") {
    return nodes.map((node, index) => renderNode(node, `root-${index}`, onPreview))
  }

  const images = nodes.filter((node) => node.type === "image")
  return [
    ...nodes.flatMap((node, index) => node.type === "image" ? [] : [renderNode(node, `root-${index}`, onPreview)]),
    renderImageStrip(images, "root-images", onPreview),
  ]
}

function renderImageStrip(nodes: RichTextNode[], key: string, onPreview: OpenImagePreview): ReactNode {
  const images = nodes.flatMap((node, index) => {
    const src = attachmentThumbnailUrl(node.attrs?.attachmentId)
    return src ? [{ node, src, key: `${key}-${index}` }] : []
  })
  if (images.length === 0) return null

  const visibleImages = images.slice(0, 5)
  const remainingCount = images.length - visibleImages.length

  return (
    <div
      aria-label={`帖子图片，共 ${images.length} 张`}
      className="rich-text-image-strip"
      data-visible-count={visibleImages.length}
      key={key}
      role="group"
      style={{ "--image-strip-columns": visibleImages.length } as CSSProperties}
    >
      {visibleImages.map(({ node, src, key: imageKey }, index) => (
        <button
          aria-label={imageLabel(node)}
          className="rich-text-image-trigger rich-text-image-strip__item"
          key={imageKey}
          onClick={(event) => onPreview({
            images: images.map(({ node: imageNode, src: imageSrc }) => previewImage(imageNode, imageSrc)),
            index,
            trigger: event.currentTarget,
          })}
          title={imageLabel(node)}
          type="button"
        >
          {renderImageNode(node, imageKey, src, true)}
          {index === visibleImages.length - 1 && remainingCount > 0
            ? <span aria-hidden="true" className="rich-text-image-strip__more">+{remainingCount}</span>
            : null}
        </button>
      ))}
    </div>
  )
}

function renderNode(node: RichTextNode, key: string, onPreview: OpenImagePreview): ReactNode {
  const children = node.content?.map((child, index) => renderNode(child, `${key}-${index}`, onPreview))
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
      return <button
        aria-label={imageLabel(node)}
        className="rich-text-image-trigger"
        key={key}
        onClick={(event) => onPreview({ images: [previewImage(node, src)], index: 0, trigger: event.currentTarget })}
        title={imageLabel(node)}
        type="button"
      >{renderImageNode(node, key, src)}</button>
    }
    default:
      return null
  }
}

function imageLabel(node: RichTextNode): string {
  return typeof node.attrs?.alt === "string" && node.attrs.alt ? `预览图片：${node.attrs.alt}` : "预览图片"
}

function previewImage(node: RichTextNode, thumbnail: string) {
  return { src: thumbnail, alt: typeof node.attrs?.alt === "string" ? node.attrs.alt : "" }
}

function renderImageNode(node: RichTextNode, key: string, src: string, compact = false): ReactNode {
  const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : ""
  const width = safeImageDimension(node.attrs?.width)
  const height = safeImageDimension(node.attrs?.height)
  return (
    <img
      alt={alt}
      className={compact ? "rich-text-image-strip__image" : undefined}
      decoding="async"
      height={height}
      key={key}
      loading="lazy"
      src={src}
      style={!compact && width ? { width, height: "auto" } : undefined}
      width={width}
    />
  )
}

function applyMarks(text: string, marks: RichTextMark[], key: string): ReactNode {
  const canHighlightReferences = !marks.some((mark) => mark.type === "link" || mark.type === "code")
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
  }, canHighlightReferences ? highlightReferences(text, key) : text)
}

function highlightReferences(text: string, key: string): ReactNode {
  const references: Array<{ start: number; end: number; type: "hashtag" | "mention"; value: string }> =
    findTopicHashtags(text).map((match) => ({ ...match, type: "hashtag", value: match.name }))
  const mentionPattern = /(^|[^a-z0-9_])@([a-z][a-z0-9_]{2,31})(?![a-z0-9_])/gi
  let mention: RegExpExecArray | null
  while ((mention = mentionPattern.exec(text)) !== null) {
    const start = mention.index + mention[1].length
    references.push({ start, end: start + mention[2].length + 1, type: "mention", value: mention[2] })
  }
  references.sort((left, right) => left.start - right.start)

  const parts: ReactNode[] = []
  let cursor = 0
  references.forEach((reference) => {
    if (reference.start < cursor) return
    if (reference.start > cursor) parts.push(text.slice(cursor, reference.start))
    parts.push(reference.type === "mention"
      ? <a className="rich-text-mention" href={`#user/${reference.value.toLowerCase()}`} key={`${key}-mention-${reference.start}`}>@{reference.value}</a>
      : <span className="rich-text-hashtag" key={`${key}-hashtag-${reference.start}`}>#{reference.value}</span>)
    cursor = reference.end
  })
  if (cursor < text.length) {
    parts.push(text.slice(cursor))
  }
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
