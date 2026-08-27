export interface RichTextMark {
  type: string
  attrs?: Record<string, unknown>
}

export interface RichTextNode {
  type: string
  attrs?: Record<string, unknown>
  content?: RichTextNode[]
  text?: string
  marks?: RichTextMark[]
}

export interface RichTextDocument extends RichTextNode {
  type: "doc"
  content: RichTextNode[]
}

const attachmentIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MIN_IMAGE_DIMENSION = 40
const MAX_IMAGE_DIMENSION = 2_400

export function plainTextDocument(value: string): RichTextDocument {
  const normalized = value.replace(/\r\n?/g, "\n")
  const paragraphs = normalized.split(/\n{2,}/).map((paragraph) => {
    const lines = paragraph.split("\n")
    const content: RichTextNode[] = []
    lines.forEach((line, index) => {
      if (index > 0) content.push({ type: "hardBreak" })
      if (line) content.push({ type: "text", text: line })
    })
    return content.length > 0 ? { type: "paragraph", content } : { type: "paragraph" }
  })
  return { type: "doc", content: paragraphs }
}

export function sanitizeRichContent(value: unknown): RichTextDocument {
  const document = isRichTextDocument(value) ? value : plainTextDocument("")
  return sanitizeNode(document) as RichTextDocument
}

export function toPlainText(value: unknown): string {
  if (!isRichTextDocument(value)) return ""
  const parts: string[] = []
  projectNode(value, parts)
  return parts.join("").trim()
}

export function isRichTextDocument(value: unknown): value is RichTextDocument {
  return isRecord(value)
    && value.type === "doc"
    && Array.isArray(value.content)
    && value.content.every(isRichTextNode)
}

function isRichTextNode(value: unknown): value is RichTextNode {
  if (!isRecord(value) || typeof value.type !== "string") return false
  if (value.text !== undefined && typeof value.text !== "string") return false
  if (value.attrs !== undefined && !isRecord(value.attrs)) return false
  if (value.content !== undefined && (!Array.isArray(value.content) || !value.content.every(isRichTextNode))) {
    return false
  }
  if (value.marks !== undefined && (!Array.isArray(value.marks) || !value.marks.every(isRichTextMark))) {
    return false
  }
  return true
}

function isRichTextMark(value: unknown): value is RichTextMark {
  return isRecord(value)
    && typeof value.type === "string"
    && (value.attrs === undefined || isRecord(value.attrs))
}

function sanitizeNode(node: RichTextNode): RichTextNode {
  const sanitized: RichTextNode = { type: node.type }
  if (node.text !== undefined) sanitized.text = node.text
  if (node.type === "heading") {
    sanitized.attrs = { level: Number(node.attrs?.level) }
  } else if (node.type === "orderedList") {
    sanitized.attrs = { start: Number(node.attrs?.start ?? 1) }
  } else if (node.type === "codeBlock" && node.attrs?.language !== undefined) {
    sanitized.attrs = { language: node.attrs.language }
  } else if (node.type === "image") {
    const width = safeImageDimension(node.attrs?.width)
    const height = safeImageDimension(node.attrs?.height)
    sanitized.attrs = {
      attachmentId: typeof node.attrs?.attachmentId === "string" ? node.attrs.attachmentId : "",
      alt: typeof node.attrs?.alt === "string" ? node.attrs.alt.slice(0, 300) : "",
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
    }
  } else if (node.type === "replyGate" && node.attrs?.locked === true) {
    sanitized.attrs = { locked: true }
  }
  if (node.content !== undefined) sanitized.content = node.content.map(sanitizeNode)
  if (node.marks !== undefined) {
    sanitized.marks = node.marks.map((mark) => {
      if (mark.type !== "link") return { type: mark.type }
      return {
        type: "link",
        attrs: { href: typeof mark.attrs?.href === "string" ? mark.attrs.href : "" },
      }
    })
  }
  return sanitized
}

export function attachmentThumbnailUrl(value: unknown): string | null {
  return typeof value === "string" && attachmentIdPattern.test(value)
    ? `/api/v1/attachments/${value}/thumbnail`
    : null
}

export function safeImageDimension(value: unknown): number | undefined {
  return Number.isInteger(value)
    && Number(value) >= MIN_IMAGE_DIMENSION
    && Number(value) <= MAX_IMAGE_DIMENSION
    ? Number(value)
    : undefined
}

export function toEditorRichContent(value: RichTextDocument): RichTextDocument {
  return {
    ...value,
    content: value.content.map(addImagePreview),
  }
}

function addImagePreview(node: RichTextNode): RichTextNode {
  const content = node.content?.map(addImagePreview)
  if (node.type !== "image") return content ? { ...node, content } : { ...node }
  const src = attachmentThumbnailUrl(node.attrs?.attachmentId)
  return {
    type: "image",
    attrs: {
      attachmentId: node.attrs?.attachmentId,
      alt: typeof node.attrs?.alt === "string" ? node.attrs.alt : "",
      ...(safeImageDimension(node.attrs?.width) ? { width: node.attrs?.width } : {}),
      ...(safeImageDimension(node.attrs?.height) ? { height: node.attrs?.height } : {}),
      ...(src ? { src } : {}),
    },
  }
}

function projectNode(node: RichTextNode, parts: string[]) {
  if (node.type === "text") {
    parts.push(node.text ?? "")
    return
  }
  if (node.type === "hardBreak") {
    pushNewline(parts)
    return
  }
  if (node.type === "replyGate" && node.attrs?.locked === true) {
    parts.push("回复主题后可见")
    pushNewline(parts)
    return
  }
  node.content?.forEach((child) => projectNode(child, parts))
  if (["paragraph", "heading", "blockquote", "replyGate", "listItem", "codeBlock", "horizontalRule"].includes(node.type)) {
    pushNewline(parts)
  }
}

function pushNewline(parts: string[]) {
  if (!parts.at(-1)?.endsWith("\n")) parts.push("\n")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
