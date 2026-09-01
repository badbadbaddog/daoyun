import type { BoardSummary } from "../../api/boards"

export interface BoardTreeNode {
  board: BoardSummary
  children: BoardTreeNode[]
}

export function buildBoardTree(boards: BoardSummary[]): BoardTreeNode[] {
  const nodes = new Map(boards.map((board) => [board.id, { board, children: [] as BoardTreeNode[] }]))
  const roots: BoardTreeNode[] = []
  for (const node of nodes.values()) {
    const parent = node.board.parentId ? nodes.get(node.board.parentId) : undefined
    if (parent && parent !== node) parent.children.push(node)
    else roots.push(node)
  }
  const sortNodes = (items: BoardTreeNode[]) => {
    items.sort((left, right) => left.board.position - right.board.position || left.board.id.localeCompare(right.board.id))
    items.forEach((item) => sortNodes(item.children))
  }
  sortNodes(roots)
  return roots
}
