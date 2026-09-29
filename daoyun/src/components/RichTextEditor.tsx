import CharacterCount from "@tiptap/extension-character-count"
import { Extension, Node } from "@tiptap/core"
import Image from "@tiptap/extension-image"
import Placeholder from "@tiptap/extension-placeholder"
import { EditorContent, useEditor, useEditorState } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"
import {
  Bold,
  Code,
  Code2,
  Heading2,
  Heading3,
  Italic,
  ImagePlus,
  EyeOff,
  Link2,
  List,
  ListOrdered,
  LoaderCircle,
  Minus,
  Quote,
  Redo2,
  Strikethrough,
  Undo2,
  Unlink,
} from "lucide-react"
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react"

import {
  sanitizeRichContent,
  toEditorRichContent,
  toPlainText,
  type RichTextDocument,
} from "../editor/richContent"
import { findTopicHashtags } from "../utils/tags"

interface RichTextEditorProps {
  value: RichTextDocument
  onChange: (document: RichTextDocument, plainText: string) => void
  ariaLabel: string
  placeholder: string
  maxCharacters: number
  autoFocus?: boolean
  disabled?: boolean
  invalid?: boolean
  errorMessageId?: string
  showImageUpload?: boolean
  onImageUpload?: (
    file: File,
    onProgress: (percent: number) => void,
    signal: AbortSignal,
  ) => Promise<{ id: string }>
}

interface ToolbarButtonProps {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}

export function RichTextEditor({
  value,
  onChange,
  ariaLabel,
  placeholder,
  maxCharacters,
  autoFocus = false,
  disabled = false,
  invalid = false,
  errorMessageId,
  showImageUpload = true,
  onImageUpload,
}: RichTextEditorProps) {
  const [linkPanelOpen, setLinkPanelOpen] = useState(false)
  const [linkHref, setLinkHref] = useState("")
  const [imageUpload, setImageUpload] = useState<{ progress: number | null; error: string } | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const previewUrlsRef = useRef<string[]>([])
  const uploadAbortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)
  const linkErrorId = useId()
  const normalizedLinkHref = normalizeLink(linkHref)
  const linkHrefValid = Boolean(normalizedLinkHref && isAllowedLink(normalizedLinkHref, undefined))
  const linkHrefInvalid = linkHref.trim().length > 0 && !linkHrefValid
  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    content: toEditorRichContent(value),
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        underline: false,
        link: {
          openOnClick: false,
          autolink: false,
          linkOnPaste: true,
          defaultProtocol: "https",
          isAllowedUri: isAllowedLink,
        },
      }),
      Placeholder.configure({ placeholder }),
      CharacterCount.configure({ limit: maxCharacters }),
      HashtagHighlight,
      ReplyGate,
      PrivateAttachmentImage.configure({
        allowBase64: false,
        resize: {
          enabled: true,
          directions: ["top-left", "top-right", "bottom-left", "bottom-right"],
          minWidth: 80,
          minHeight: 80,
          alwaysPreserveAspectRatio: true,
        },
      }),
    ],
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": ariaLabel,
        "aria-multiline": "true",
        ...(invalid ? { "aria-invalid": "true" } : {}),
        ...(errorMessageId ? { "aria-describedby": errorMessageId } : {}),
        class: "rich-text-editor__content",
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      const document = sanitizeRichContent(currentEditor.getJSON())
      onChange(document, toPlainText(document))
    },
  })

  useEffect(() => {
    if (!editor) return
    editor.setEditable(!disabled)
  }, [disabled, editor])

  useEffect(() => {
    if (!editor || !autoFocus || disabled) return
    if (document.querySelector("[role='alertdialog'][aria-modal='true']")) return
    editor.commands.focus("start")
  }, [autoFocus, disabled, editor])

  useEffect(() => {
    if (!editor) return
    if (invalid) editor.view.dom.setAttribute("aria-invalid", "true")
    else editor.view.dom.removeAttribute("aria-invalid")
    if (errorMessageId) editor.view.dom.setAttribute("aria-describedby", errorMessageId)
    else editor.view.dom.removeAttribute("aria-describedby")
  }, [editor, errorMessageId, invalid])

  useLayoutEffect(() => {
    if (!editor) return
    const current = sanitizeRichContent(editor.getJSON())
    const next = sanitizeRichContent(value)
    if (JSON.stringify(current) !== JSON.stringify(next)) {
      editor.commands.setContent(toEditorRichContent(next), { emitUpdate: false })
    }
  }, [editor, value])

  useEffect(() => () => {
    mountedRef.current = false
    uploadAbortRef.current?.abort()
    previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
  }, [])

  const state = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => ({
      bold: currentEditor?.isActive("bold") ?? false,
      italic: currentEditor?.isActive("italic") ?? false,
      strike: currentEditor?.isActive("strike") ?? false,
      code: currentEditor?.isActive("code") ?? false,
      heading2: currentEditor?.isActive("heading", { level: 2 }) ?? false,
      heading3: currentEditor?.isActive("heading", { level: 3 }) ?? false,
      blockquote: currentEditor?.isActive("blockquote") ?? false,
      replyGate: currentEditor?.isActive("replyGate") ?? false,
      bulletList: currentEditor?.isActive("bulletList") ?? false,
      orderedList: currentEditor?.isActive("orderedList") ?? false,
      codeBlock: currentEditor?.isActive("codeBlock") ?? false,
      link: currentEditor?.isActive("link") ?? false,
      canUndo: currentEditor?.can().chain().focus().undo().run() ?? false,
      canRedo: currentEditor?.can().chain().focus().redo().run() ?? false,
      characters: currentEditor?.storage.characterCount.characters() ?? 0,
    }),
  })

  function openLinkPanel() {
    if (!editor) return
    setLinkHref(editor.getAttributes("link").href ?? "")
    setLinkPanelOpen(true)
  }

  function applyLink() {
    if (!editor) return
    if (!linkHrefValid) return
    editor.chain().focus().extendMarkRange("link").setLink({ href: normalizedLinkHref }).run()
    setLinkPanelOpen(false)
  }

  async function uploadImage(file: File) {
    if (!editor || !onImageUpload) return
    let imageCount = 0
    editor.state.doc.descendants((node) => {
      if (node.type.name === "image") imageCount += 1
    })
    if (imageCount >= 20) {
      setImageUpload({ progress: null, error: "每篇内容最多插入 20 张图片" })
      return
    }
    setImageUpload({ progress: null, error: "" })
    const controller = new AbortController()
    uploadAbortRef.current = controller
    try {
      const attachment = await onImageUpload(
        file,
        (progress) => {
          if (mountedRef.current) setImageUpload({ progress, error: "" })
        },
        controller.signal,
      )
      if (!mountedRef.current || controller.signal.aborted) return
      const previewUrl = URL.createObjectURL(file)
      previewUrlsRef.current.push(previewUrl)
      editor.chain().focus().insertContent({
        type: "image",
        attrs: {
          src: previewUrl,
          attachmentId: attachment.id,
          alt: file.name.slice(0, 300),
        },
      }).run()
      setImageUpload(null)
    } catch (error) {
      if (!mountedRef.current || controller.signal.aborted) return
      setImageUpload({
        progress: null,
        error: error instanceof Error ? error.message : "图片上传失败，请重试",
      })
    } finally {
      if (uploadAbortRef.current === controller) uploadAbortRef.current = null
    }
  }

  return (
    <div className={`rich-text-editor${invalid ? " rich-text-editor--invalid" : ""}${disabled ? " rich-text-editor--disabled" : ""}`}>
      <div className="rich-text-editor__toolbar" role="toolbar" aria-label={`${ariaLabel}格式工具`}>
        <ToolbarButton label="加粗" active={state?.bold} disabled={disabled} onClick={() => editor?.chain().focus().toggleBold().run()}><Bold size={17} /></ToolbarButton>
        <ToolbarButton label="斜体" active={state?.italic} disabled={disabled} onClick={() => editor?.chain().focus().toggleItalic().run()}><Italic size={17} /></ToolbarButton>
        <ToolbarButton label="删除线" active={state?.strike} disabled={disabled} onClick={() => editor?.chain().focus().toggleStrike().run()}><Strikethrough size={17} /></ToolbarButton>
        <ToolbarButton label="行内代码" active={state?.code} disabled={disabled} onClick={() => editor?.chain().focus().toggleCode().run()}><Code size={17} /></ToolbarButton>
        {showImageUpload && <ToolbarButton
          label="上传图片"
          disabled={disabled || !onImageUpload || Boolean(imageUpload && !imageUpload.error)}
          onClick={() => imageInputRef.current?.click()}
        >
          {imageUpload && !imageUpload.error
            ? <LoaderCircle className="topic-loading__spinner" size={17} />
            : <ImagePlus size={17} />}
        </ToolbarButton>}
        <span className="rich-text-editor__separator" aria-hidden="true" />
        <ToolbarButton label="二级标题" active={state?.heading2} disabled={disabled} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={17} /></ToolbarButton>
        <ToolbarButton label="三级标题" active={state?.heading3} disabled={disabled} onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 size={17} /></ToolbarButton>
        <ToolbarButton label="引用" active={state?.blockquote} disabled={disabled} onClick={() => editor?.chain().focus().toggleBlockquote().run()}><Quote size={17} /></ToolbarButton>
        <ToolbarButton label="回复可见" active={state?.replyGate} disabled={disabled} onClick={() => editor?.chain().focus().toggleWrap("replyGate").run()}><EyeOff size={17} /></ToolbarButton>
        <ToolbarButton label="无序列表" active={state?.bulletList} disabled={disabled} onClick={() => editor?.chain().focus().toggleBulletList().run()}><List size={17} /></ToolbarButton>
        <ToolbarButton label="有序列表" active={state?.orderedList} disabled={disabled} onClick={() => editor?.chain().focus().toggleOrderedList().run()}><ListOrdered size={17} /></ToolbarButton>
        <ToolbarButton label="代码块" active={state?.codeBlock} disabled={disabled} onClick={() => editor?.chain().focus().toggleCodeBlock().run()}><Code2 size={17} /></ToolbarButton>
        <ToolbarButton label="分隔线" disabled={disabled} onClick={() => editor?.chain().focus().setHorizontalRule().run()}><Minus size={17} /></ToolbarButton>
        <span className="rich-text-editor__separator" aria-hidden="true" />
        <ToolbarButton label="添加或编辑链接" active={state?.link} disabled={disabled} onClick={openLinkPanel}><Link2 size={17} /></ToolbarButton>
        {state?.link && <ToolbarButton label="移除链接" disabled={disabled} onClick={() => editor?.chain().focus().unsetLink().run()}><Unlink size={17} /></ToolbarButton>}
        <span className="rich-text-editor__toolbar-spacer" />
        <ToolbarButton label="撤销" disabled={disabled || !state?.canUndo} onClick={() => editor?.chain().focus().undo().run()}><Undo2 size={17} /></ToolbarButton>
        <ToolbarButton label="重做" disabled={disabled || !state?.canRedo} onClick={() => editor?.chain().focus().redo().run()}><Redo2 size={17} /></ToolbarButton>
      </div>
      {showImageUpload && <input
        ref={imageInputRef}
        className="rich-text-editor__file-input"
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        aria-label="选择正文图片"
        disabled={disabled || !onImageUpload}
        onChange={(event) => {
          const input = event.currentTarget
          const file = input.files?.[0]
          if (file) {
            void uploadImage(file).finally(() => {
              input.value = ""
            })
          }
        }}
      />}
      {showImageUpload && imageUpload && (
        <div
          className={`rich-text-editor__upload${imageUpload.error ? " rich-text-editor__upload--error" : ""}`}
          role={imageUpload.error ? "alert" : "status"}
          aria-live="polite"
        >
          {describeImageUpload(imageUpload)}
        </div>
      )}
      {linkPanelOpen && (
        <div className="rich-text-editor__link-panel">
          <label>
            <span>链接地址</span>
            <input
              autoFocus
              type="url"
              value={linkHref}
              placeholder="https://example.com"
              aria-invalid={linkHrefInvalid || undefined}
              aria-describedby={linkHrefInvalid ? linkErrorId : undefined}
              onChange={(event) => setLinkHref(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  applyLink()
                }
                if (event.key === "Escape") {
                  event.stopPropagation()
                  setLinkPanelOpen(false)
                }
              }}
            />
            {linkHrefInvalid && <span id={linkErrorId} className="rich-text-editor__link-error">仅支持 http、https 或站内链接</span>}
          </label>
          <button type="button" className="secondary-button" onClick={() => setLinkPanelOpen(false)}>取消</button>
          <button type="button" className="primary-button" disabled={!linkHrefValid} onClick={applyLink}>应用</button>
        </div>
      )}
      <EditorContent editor={editor} />
      <div className="rich-text-editor__footer">
        <span>支持图片、标题、列表、引用、回复可见、代码和链接</span>
        <span className={(state?.characters ?? 0) >= maxCharacters * 0.9 ? "rich-text-editor__count--warning" : undefined}>
          {state?.characters ?? 0} / {maxCharacters.toLocaleString("zh-CN")}
        </span>
      </div>
    </div>
  )
}

function describeImageUpload(upload: { progress: number | null; error: string }): string {
  if (upload.error) return upload.error
  if (upload.progress === null || upload.progress <= 0) return "正在上传图片，请稍候"
  if (upload.progress >= 99) return "图片已上传，正在处理"
  return `图片上传中 ${upload.progress}%`
}

const PrivateAttachmentImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      attachmentId: {
        default: null,
        rendered: false,
      },
    }
  },
})

const ReplyGate = Node.create({
  name: "replyGate",
  group: "block",
  content: "block+",
  defining: true,
  parseHTML() {
    return [{ tag: "section[data-reply-gate]" }]
  },
  renderHTML() {
    return ["section", { "data-reply-gate": "true" }, 0]
  },
})

const HashtagHighlight = Extension.create({
  name: "hashtagHighlight",
  addProseMirrorPlugins() {
    return [new Plugin<DecorationSet>({
      key: new PluginKey("hashtagHighlight"),
      state: {
        init: (_, state) => createHashtagDecorations(state.doc),
        apply: (transaction, current) => transaction.docChanged
          ? createHashtagDecorations(transaction.doc)
          : current,
      },
      props: {
        decorations(state) {
          return this.getState(state)
        },
      },
    })]
  },
})

function createHashtagDecorations(document: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = []
  document.descendants((node, position) => {
    if (!node.isText || !node.text) return
    if (document.resolve(position).parent.type.name === "codeBlock") return
    if (node.marks.some((mark) => mark.type.name === "link" || mark.type.name === "code")) return
    findTopicHashtags(node.text).forEach((match) => {
      decorations.push(Decoration.inline(position + match.start, position + match.end, { class: "rich-text-hashtag" }))
    })
  })
  return DecorationSet.create(document, decorations)
}

function ToolbarButton({ label, active = false, disabled = false, onClick, children }: ToolbarButtonProps) {
  return (
    <button
      className={`rich-text-editor__tool${active ? " is-active" : ""}`}
      type="button"
      aria-label={label}
      aria-pressed={active || undefined}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function normalizeLink(value: string): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed.startsWith("/")) return trimmed
  return /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
}

function isAllowedLink(value: string, _context: unknown): boolean {
  if (value.startsWith("/") && !value.startsWith("//")) return true
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}
