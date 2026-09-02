import { FolderOpen, Layers3, MessageSquareText, PenLine } from "lucide-react"

import type { BoardDetail } from "../../api/boards"
import { formatBoardCount } from "./boardCounts"

interface BoardHeaderProps {
  board: BoardDetail
  onCreateTopic?: (boardId: string) => void
}

export function BoardHeader({ board, onCreateTopic }: BoardHeaderProps) {
  const parentBoard = board.breadcrumb.length > 1 ? board.breadcrumb.at(-2) : null

  return (
    <header className="board-header" aria-label={`${board.name}社区概览`}>
      <div className="board-header__main">
        <div className="board-header__identity">
          <span className={`board-header__icon board-directory-icon--${board.tone}`} aria-hidden="true">
            <FolderOpen size={29} />
          </span>
          <div className="board-header__copy">
            <p className="board-header__eyebrow">社区版块</p>
            <h1>{board.name}</h1>
            {board.description && <p className="board-header__description">{board.description}</p>}
            <div className="board-header__meta" aria-label="版块参与信息">
              {parentBoard && <span>上级：<a href={`#board/${parentBoard.slug}`}>{parentBoard.name}</a></span>}
              <span>{board.viewer.canReply ? "欢迎参与讨论" : "当前仅开放浏览"}</span>
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
        <span><strong>{board.viewer.canReply ? "可参与" : "仅浏览"}</strong><small>讨论</small></span>
        <span><strong>{board.viewer.canCreateTopic ? "可发布" : "不可发布"}</strong><small>发主题</small></span>
      </div>
    </header>
  )
}
