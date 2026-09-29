import { Aperture, Code2, Layers3, LayoutGrid, MessageSquareText, PenLine } from "lucide-react"

import type { BoardDetail } from "../../api/boards"
import type { BoardIcon } from "../../types/community"
import { formatBoardCount } from "./boardCounts"

interface BoardHeaderProps {
  board: BoardDetail
  onCreateTopic?: (boardId: string) => void
}

const boardIcons: Record<BoardIcon, typeof MessageSquareText> = {
  aperture: Aperture,
  code: Code2,
  layout: LayoutGrid,
  messages: MessageSquareText,
}

export function BoardHeader({ board, onCreateTopic }: BoardHeaderProps) {
  const parentBoard = board.breadcrumb.length > 1 ? board.breadcrumb.at(-2) : null
  const Icon = boardIcons[board.icon] ?? MessageSquareText

  return (
    <header className="board-header" aria-label={`${board.name}社区概览`}>
      <div className="board-header__main">
        <div className="board-header__identity">
          <span className={`board-header__icon board-directory-icon--${board.tone}`} aria-hidden="true">
            <Icon size={34} />
          </span>
          <div className="board-header__copy">
            <p className="board-header__eyebrow">社区版块</p>
            <h1>{board.name}</h1>
            {board.description && <p className="board-header__description">{board.description}</p>}
            <div className="board-header__meta" aria-label="版块参与信息">
              {parentBoard && <span>上级：<a href={`#board/${parentBoard.slug}`}>{parentBoard.name}</a></span>}
              <span>{board.viewer.canReply ? "欢迎参与讨论" : "当前仅开放浏览"}</span>
              <span>{board.viewer.canUploadAttachment ? "支持附件" : "仅限文本与链接"}</span>
            </div>
          </div>
        </div>
        {board.viewer.canCreateTopic && onCreateTopic && (
          <button className="primary-button" type="button" onClick={() => onCreateTopic(board.id)}>
            <PenLine size={16} aria-hidden="true" />
            发主题
          </button>
        )}
      </div>
      <div className="board-header__stats" role="region" aria-label="版块数据">
        <span><strong>{formatBoardCount(board.topicCount)}</strong><small><MessageSquareText size={13} aria-hidden="true" />主题</small></span>
        <span><strong>{formatBoardCount(board.children.length)}</strong><small><Layers3 size={13} aria-hidden="true" />子版块</small></span>
      </div>
    </header>
  )
}
