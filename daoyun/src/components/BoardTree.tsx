import { ChevronDown, ChevronRight, Eye, EyeOff, Plus } from "lucide-react"

import type { AdminBoard } from "../api/admin"
import { ActionMenu, type ActionMenuItem } from "./ui/ActionMenu"

export interface BoardTreeNode { board: AdminBoard; children: BoardTreeNode[]; depth: number }
interface BoardTreeProps {
  nodes: BoardTreeNode[]; expandedIds: Set<string>; forceExpanded: boolean; reorderDisabled: boolean; canWrite: boolean; pendingId: string | null
  feedback: { boardId: string; message: string; kind: "success" | "error" } | null
  onToggle: (boardId: string) => void; onAddChild: (board: AdminBoard) => void; onEdit: (board: AdminBoard) => void
  onMove: (board: AdminBoard, direction: "up" | "down" | "in" | "out") => void; onVisibility: (board: AdminBoard) => void
  onAccessPolicy: (board: AdminBoard) => void; onGovernance: (board: AdminBoard) => void; onMerge: (board: AdminBoard) => void; onDelete: (board: AdminBoard) => void
}

export function BoardTree({ nodes, ...props }: BoardTreeProps) { return <ul className="admin-board-tree" role="tree" aria-label="版块层级">{nodes.map((node, index) => <BoardTreeItem key={node.board.id} node={node} siblingIndex={index} siblingCount={nodes.length} {...props} />)}</ul> }

interface BoardTreeItemProps extends Omit<BoardTreeProps, "nodes"> { node: BoardTreeNode; siblingIndex: number; siblingCount: number }
function BoardTreeItem({ node, siblingIndex, siblingCount, ...props }: BoardTreeItemProps) {
  const { board, children, depth } = node; const hasChildren = children.length > 0; const expanded = props.forceExpanded || props.expandedIds.has(board.id)
  const pending = props.pendingId === board.id; const feedback = props.feedback?.boardId === board.id ? props.feedback : null; const locked = props.pendingId !== null
  const reorderTitle = props.reorderDisabled ? "（搜索时不可调整）" : ""
  const items: ActionMenuItem[] = [
    { label: "编辑设置", onSelect: () => props.onEdit(board) },
    { label: board.visibility === "public" ? "设为隐藏" : "设为公开", onSelect: () => props.onVisibility(board) },
    { label: `上移${reorderTitle}`, onSelect: () => props.onMove(board, "up"), disabled: props.reorderDisabled || siblingIndex === 0 },
    { label: `下移${reorderTitle}`, onSelect: () => props.onMove(board, "down"), disabled: props.reorderDisabled || siblingIndex === siblingCount - 1 },
    { label: `移入上一个同级版块${reorderTitle}`, onSelect: () => props.onMove(board, "in"), disabled: props.reorderDisabled || siblingIndex === 0 || depth >= 2 },
    { label: `移到父版块外${reorderTitle}`, onSelect: () => props.onMove(board, "out"), disabled: props.reorderDisabled || board.parentId === null },
    { label: "访问策略", onSelect: () => props.onAccessPolicy(board) },
    { label: "治理人员", onSelect: () => props.onGovernance(board) },
    { label: "合并版块", onSelect: () => props.onMerge(board) },
    { label: "删除版块", onSelect: () => props.onDelete(board), danger: true },
  ]
  return <li role="treeitem" aria-expanded={hasChildren ? expanded : undefined}><div className="admin-board-tree__row" data-depth={depth}>
    <div className="admin-board-tree__identity">{hasChildren ? <button className="icon-button admin-board-tree__toggle" type="button" onClick={() => props.onToggle(board.id)} aria-label={`${expanded ? "收起" : "展开"}版块：${board.name}`} title={expanded ? "收起" : "展开"}>{expanded ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}</button> : <span className="admin-board-tree__toggle-spacer" aria-hidden="true" />}<div><strong>{board.name}</strong><span>{board.slug} · {board.description || "无摘要"}</span></div></div>
    <span className={`admin-board-visibility admin-board-visibility--${board.visibility}`}>{board.visibility === "public" ? <Eye size={13} aria-hidden="true" /> : <EyeOff size={13} aria-hidden="true" />}{board.visibility === "public" ? "公开" : "隐藏"}</span>
    <span className="admin-board-tree__topics">{board.topicCount} 个主题</span>
    {props.canWrite && <div className="admin-board-tree__actions">{depth < 2 && <button className="icon-button" type="button" aria-label={`新增子版块：${board.name}`} title="新增子版块" disabled={locked} onClick={() => props.onAddChild(board)}><Plus size={14} aria-hidden="true" /></button>}<ActionMenu label={`更多操作：${board.name}`} items={items} disabled={locked} /></div>}
    {pending && <small className="admin-board-tree__feedback" role="status">保存中</small>}{feedback && <small className={`admin-board-tree__feedback admin-board-tree__feedback--${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"}>{feedback.message}</small>}
  </div>{hasChildren && expanded && <ul role="group">{children.map((child, index) => <BoardTreeItem key={child.board.id} node={child} siblingIndex={index} siblingCount={children.length} {...props} />)}</ul>}</li>
}

export function buildBoardTree(boards: AdminBoard[]): BoardTreeNode[] { const children = new Map<string | null, AdminBoard[]>(); for (const board of boards) { const parentId = boards.some((candidate) => candidate.id === board.parentId) ? board.parentId : null; children.set(parentId, [...(children.get(parentId) ?? []), board]) } const build = (parentId: string | null, depth: number): BoardTreeNode[] => (children.get(parentId) ?? []).sort(compareBoards).map((board) => ({ board, depth, children: build(board.id, depth + 1) })); return build(null, 0) }
export function filterBoardTree(nodes: BoardTreeNode[], query: string): BoardTreeNode[] { const normalized = query.trim().toLocaleLowerCase(); if (!normalized) return nodes; return nodes.flatMap((node) => { const children = filterBoardTree(node.children, normalized); const matches = `${node.board.name} ${node.board.slug} ${node.board.description}`.toLocaleLowerCase().includes(normalized); return matches || children.length > 0 ? [{ ...node, children }] : [] }) }
export function compareBoards(left: AdminBoard, right: AdminBoard) { return left.position - right.position || left.id.localeCompare(right.id) }
