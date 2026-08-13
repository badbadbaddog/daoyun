import {
  ArrowDown,
  ArrowLeftFromLine,
  ArrowRightToLine,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react"

import type { AdminBoard } from "../api/admin"

export interface BoardTreeNode {
  board: AdminBoard
  children: BoardTreeNode[]
  depth: number
}

interface BoardTreeProps {
  nodes: BoardTreeNode[]
  expandedIds: Set<string>
  forceExpanded: boolean
  reorderDisabled: boolean
  canWrite: boolean
  pendingId: string | null
  feedback: { boardId: string; message: string; kind: "success" | "error" } | null
  onToggle: (boardId: string) => void
  onAddChild: (board: AdminBoard) => void
  onEdit: (board: AdminBoard) => void
  onMove: (board: AdminBoard, direction: "up" | "down" | "in" | "out") => void
  onVisibility: (board: AdminBoard) => void
  onDelete: (board: AdminBoard) => void
}

export function BoardTree({ nodes, ...props }: BoardTreeProps) {
  return (
    <ul className="admin-board-tree" role="tree" aria-label="版块层级">
      {nodes.map((node, index) => (
        <BoardTreeItem
          key={node.board.id}
          node={node}
          siblingIndex={index}
          siblingCount={nodes.length}
          {...props}
        />
      ))}
    </ul>
  )
}

interface BoardTreeItemProps extends Omit<BoardTreeProps, "nodes"> {
  node: BoardTreeNode
  siblingIndex: number
  siblingCount: number
}

function BoardTreeItem({ node, siblingIndex, siblingCount, ...props }: BoardTreeItemProps) {
  const { board, children, depth } = node
  const hasChildren = children.length > 0
  const expanded = props.forceExpanded || props.expandedIds.has(board.id)
  const pending = props.pendingId === board.id
  const feedback = props.feedback?.boardId === board.id ? props.feedback : null

  return (
    <li role="treeitem" aria-expanded={hasChildren ? expanded : undefined}>
      <div className="admin-board-tree__row" data-depth={depth}>
        <div className="admin-board-tree__identity">
          {hasChildren ? (
            <button
              className="icon-button admin-board-tree__toggle"
              type="button"
              onClick={() => props.onToggle(board.id)}
              aria-label={`${expanded ? "收起" : "展开"}版块：${board.name}`}
              title={expanded ? "收起" : "展开"}
            >
              {expanded ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
            </button>
          ) : <span className="admin-board-tree__toggle-spacer" aria-hidden="true" />}
          <div>
            <strong>{board.name}</strong>
            <span>{board.slug} · {board.topicCount} 个主题</span>
          </div>
        </div>
        <span className={`admin-board-visibility admin-board-visibility--${board.visibility}`}>
          {board.visibility === "public" ? <Eye size={13} aria-hidden="true" /> : <EyeOff size={13} aria-hidden="true" />}
          {board.visibility === "public" ? "公开" : "隐藏"}
        </span>
        {props.canWrite && (
          <div className="admin-board-tree__actions">
            {depth < 2 && <ActionButton label={`新增子版块：${board.name}`} title="新增子版块" onClick={() => props.onAddChild(board)}><Plus size={14} /></ActionButton>}
            <ActionButton label={`编辑版块：${board.name}`} title="编辑" onClick={() => props.onEdit(board)}><Pencil size={14} /></ActionButton>
            <ActionButton label={`${board.visibility === "public" ? "设为隐藏" : "设为公开"}：${board.name}`} title="切换可见性" onClick={() => props.onVisibility(board)} disabled={pending}>{board.visibility === "public" ? <EyeOff size={14} /> : <Eye size={14} />}</ActionButton>
            <ActionButton label={`上移版块：${board.name}`} title={props.reorderDisabled ? "清除搜索后可调整顺序" : "上移"} onClick={() => props.onMove(board, "up")} disabled={pending || props.reorderDisabled || siblingIndex === 0}><ArrowUp size={14} /></ActionButton>
            <ActionButton label={`下移版块：${board.name}`} title={props.reorderDisabled ? "清除搜索后可调整顺序" : "下移"} onClick={() => props.onMove(board, "down")} disabled={pending || props.reorderDisabled || siblingIndex === siblingCount - 1}><ArrowDown size={14} /></ActionButton>
            <ActionButton label={`移入版块：${board.name}`} title={props.reorderDisabled ? "清除搜索后可调整层级" : "移入上一个同级版块"} onClick={() => props.onMove(board, "in")} disabled={pending || props.reorderDisabled || siblingIndex === 0 || depth >= 2}><ArrowRightToLine size={14} /></ActionButton>
            <ActionButton label={`移出版块：${board.name}`} title={props.reorderDisabled ? "清除搜索后可调整层级" : "移到父版块外"} onClick={() => props.onMove(board, "out")} disabled={pending || props.reorderDisabled || board.parentId === null}><ArrowLeftFromLine size={14} /></ActionButton>
            <ActionButton label={`删除版块：${board.name}`} title="删除" onClick={() => props.onDelete(board)} disabled={pending}><Trash2 size={14} /></ActionButton>
          </div>
        )}
        {pending && <small className="admin-board-tree__feedback" role="status">保存中</small>}
        {feedback && <small className={`admin-board-tree__feedback admin-board-tree__feedback--${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"}>{feedback.message}</small>}
      </div>
      {hasChildren && expanded && (
        <ul role="group">
          {children.map((child, index) => (
            <BoardTreeItem
              key={child.board.id}
              node={child}
              siblingIndex={index}
              siblingCount={children.length}
              {...props}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

function ActionButton({ label, title, onClick, disabled, children }: { label: string; title: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return <button className="icon-button" type="button" aria-label={label} title={title} onClick={onClick} disabled={disabled}>{children}</button>
}

export function buildBoardTree(boards: AdminBoard[]): BoardTreeNode[] {
  const children = new Map<string | null, AdminBoard[]>()
  for (const board of boards) {
    const parentId = boards.some((candidate) => candidate.id === board.parentId) ? board.parentId : null
    children.set(parentId, [...(children.get(parentId) ?? []), board])
  }
  const build = (parentId: string | null, depth: number): BoardTreeNode[] => (children.get(parentId) ?? [])
    .sort(compareBoards)
    .map((board) => ({ board, depth, children: build(board.id, depth + 1) }))
  return build(null, 0)
}

export function filterBoardTree(nodes: BoardTreeNode[], query: string): BoardTreeNode[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return nodes
  return nodes.flatMap((node) => {
    const children = filterBoardTree(node.children, normalized)
    const matches = `${node.board.name} ${node.board.slug} ${node.board.description}`.toLocaleLowerCase().includes(normalized)
    return matches || children.length > 0 ? [{ ...node, children }] : []
  })
}

export function compareBoards(left: AdminBoard, right: AdminBoard) {
  return left.position - right.position || left.id.localeCompare(right.id)
}
