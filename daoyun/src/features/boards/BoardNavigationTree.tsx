import { Aperture, ChevronDown, ChevronRight, Code2, LayoutGrid, MessageSquareText } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import type { BoardIcon } from "../../types/community"
import { formatBoardMeasure } from "./boardCounts"
import type { BoardTreeNode } from "./boardTree"

interface BoardNavigationTreeProps {
  nodes: BoardTreeNode[]
  label?: string
  expandAll?: boolean
}

const boardIcons: Record<BoardIcon, typeof MessageSquareText> = {
  aperture: Aperture,
  code: Code2,
  layout: LayoutGrid,
  messages: MessageSquareText,
}

export function BoardNavigationTree({ nodes, label, expandAll = false }: BoardNavigationTreeProps) {
  const expandableIds = useMemo(() => collectExpandableIds(nodes), [nodes])
  const defaultExpandedIds = useMemo(() => {
    if (expandAll) return expandableIds
    const firstExpandable = nodes.find((node) => node.children.length > 0)
    return firstExpandable ? collectExpandableIds([firstExpandable]) : []
  }, [expandAll, expandableIds, nodes])
  const [expandedIds, setExpandedIds] = useState(() => {
    return new Set(defaultExpandedIds)
  })

  useEffect(() => {
    setExpandedIds((current) => {
      const availableIds = new Set(expandableIds)
      const next = new Set([...current].filter((id) => availableIds.has(id)))
      if (expandAll) expandableIds.forEach((id) => next.add(id))
      else if (next.size === 0) defaultExpandedIds.forEach((id) => next.add(id))
      return setsEqual(current, next) ? current : next
    })
  }, [defaultExpandedIds, expandAll, expandableIds])

  function toggleGroup(boardId: string) {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(boardId)) next.delete(boardId)
      else next.add(boardId)
      return next
    })
  }

  return (
    <ul className="board-navigation-tree board-navigation-tree--root" aria-label={label}>
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0
        const expanded = hasChildren && expandedIds.has(node.board.id)
        const regionId = `board-group-${node.board.id}`

        return (
          <li className="board-directory-group" key={node.board.id}>
            <div className="board-directory-group__header">
              <BoardDirectoryLink node={node} depth={0} group />
              {hasChildren ? (
                <button
                  className="board-directory-group__toggle"
                  type="button"
                  aria-label={`${expanded ? "收起" : "展开"}${node.board.name}`}
                  aria-expanded={expanded}
                  aria-controls={regionId}
                  title={`${expanded ? "收起" : "展开"}${node.board.name}`}
                  onClick={() => toggleGroup(node.board.id)}
                >
                  <ChevronDown size={16} aria-hidden="true" />
                </button>
              ) : <ChevronRight className="board-directory-group__link-arrow" size={16} aria-hidden="true" />}
            </div>
            {expanded && (
              <ul id={regionId} className="board-navigation-tree board-navigation-tree--nested">
                {node.children.map((child) => (
                  <BoardTreeItem
                    key={child.board.id}
                    node={child}
                    depth={1}
                    expandedIds={expandedIds}
                    onToggle={toggleGroup}
                  />
                ))}
              </ul>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function BoardTreeItem({
  node,
  depth,
  expandedIds,
  onToggle,
}: {
  node: BoardTreeNode
  depth: number
  expandedIds: Set<string>
  onToggle: (boardId: string) => void
}) {
  const hasChildren = node.children.length > 0
  const expanded = hasChildren && expandedIds.has(node.board.id)
  const regionId = `board-group-${node.board.id}`

  return (
    <li>
      <div className={hasChildren ? "board-directory-nested-group__header" : undefined}>
        <BoardDirectoryLink node={node} depth={depth} showArrow={!hasChildren} />
        {hasChildren && (
          <button
            className="board-directory-group__toggle"
            type="button"
            aria-label={`${expanded ? "收起" : "展开"}${node.board.name}`}
            aria-expanded={expanded}
            aria-controls={regionId}
            title={`${expanded ? "收起" : "展开"}${node.board.name}`}
            onClick={() => onToggle(node.board.id)}
          >
            <ChevronDown size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      {expanded && (
        <ul id={regionId} className="board-navigation-tree board-navigation-tree--branch">
          {node.children.map((child) => (
            <BoardTreeItem
              key={child.board.id}
              node={child}
              depth={depth + 1}
              expandedIds={expandedIds}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

function collectExpandableIds(nodes: BoardTreeNode[]): string[] {
  return nodes.flatMap((node) => node.children.length > 0
    ? [node.board.id, ...collectExpandableIds(node.children)]
    : [])
}

function setsEqual(left: Set<string>, right: Set<string>) {
  return left.size === right.size && [...left].every((value) => right.has(value))
}

function BoardDirectoryLink({
  node,
  depth,
  group = false,
  showArrow = true,
}: {
  node: BoardTreeNode
  depth: number
  group?: boolean
  showArrow?: boolean
}) {
  const Icon = boardIcons[node.board.icon] ?? MessageSquareText

  return (
    <a className={`board-directory-link${group ? " board-directory-link--group" : ""}`} href={`#board/${node.board.slug}`} data-depth={depth}>
      <span className={`board-directory-icon board-directory-icon--${node.board.tone}`} aria-hidden="true">
        <Icon size={depth === 0 ? 20 : 17} />
      </span>
      <span className="board-directory-copy">
        <strong>{node.board.name}</strong>
        {node.board.description && <small>{node.board.description}</small>}
      </span>
      <span className="board-directory-meta">
        {node.board.childCount > 0 && <span>{formatBoardMeasure(node.board.childCount, "子版块")}</span>}
        <span className="board-topic-count">{formatBoardMeasure(node.board.topicCount, "主题")}</span>
      </span>
      {!group && showArrow && <ChevronRight className="board-directory-link__arrow" size={16} aria-hidden="true" />}
    </a>
  )
}
