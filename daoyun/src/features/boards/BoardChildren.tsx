import { Aperture, ArrowRight, Code2, LayoutGrid, MessageSquareText } from "lucide-react"

import type { BoardSummary } from "../../api/boards"
import type { BoardIcon } from "../../types/community"
import { formatBoardMeasure } from "./boardCounts"

const boardIcons: Record<BoardIcon, typeof MessageSquareText> = {
  aperture: Aperture,
  code: Code2,
  layout: LayoutGrid,
  messages: MessageSquareText,
}

export function BoardChildren({ boards }: { boards: BoardSummary[] }) {
  if (boards.length === 0) return null
  return (
    <section className="board-children" aria-labelledby="board-children-title">
      <div className="board-children__heading">
        <h2 id="board-children-title">子版块</h2>
        <span>{boards.length} 个版块</span>
      </div>
      <ul aria-label="子版块列表">
        {boards.map((board) => {
          const Icon = boardIcons[board.icon] ?? MessageSquareText
          return (
            <li key={board.id}>
              <a href={`#board/${board.slug}`}>
                <span className={`board-children__icon board-directory-icon--${board.tone}`} aria-hidden="true">
                  <Icon size={20} />
                </span>
                <span className="board-children__copy">
                  <strong>{board.name}</strong>
                  {board.description && <small>{board.description}</small>}
                  <span>{formatBoardMeasure(board.topicCount, "主题")}</span>
                </span>
                <ArrowRight className="board-children__arrow" size={16} aria-hidden="true" />
              </a>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
