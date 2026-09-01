import { LayoutGrid, MessagesSquare, Network } from "lucide-react"

import { formatBoardMeasure } from "./boardCounts"

interface BoardDirectoryOverviewProps {
  boardCount: number
  topicCount: number
  childCount: number
}

export function BoardDirectoryOverview({ boardCount, topicCount, childCount }: BoardDirectoryOverviewProps) {
  return (
    <div className="board-directory-overview" role="group" aria-label="社区概览">
      <div>
        <LayoutGrid size={17} aria-hidden="true" />
        <strong>{formatBoardMeasure(boardCount, "公开社区")}</strong>
        <span>自由浏览</span>
      </div>
      <div>
        <MessagesSquare size={17} aria-hidden="true" />
        <strong>{formatBoardMeasure(topicCount, "讨论主题")}</strong>
        <span>持续沉淀</span>
      </div>
      <div>
        <Network size={17} aria-hidden="true" />
        <strong>{formatBoardMeasure(childCount, "子社区")}</strong>
        <span>按兴趣细分</span>
      </div>
    </div>
  )
}
