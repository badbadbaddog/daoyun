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
            <div className="board-header__meta" aria-label="版块属性">
              {parentBoard && <span>父版块：<a href={`#board/${parentBoard.slug}`}>{parentBoard.name}</a></span>}
              <span>类型：社区版块</span>
              <span>讨论：{board.viewer.canReply ? "开放" : "只读"}</span>
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
        <span><strong>{board.viewer.canReply ? "开放" : "只读"}</strong><small>讨论状态</small></span>
        <span><strong>{board.viewer.canUploadAttachment ? "支持" : "关闭"}</strong><small>附件上传</small></span>
      </div>
    </header>
  )
}
