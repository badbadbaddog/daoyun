import { CheckCircle2, FileSearch, LoaderCircle, RefreshCw, Search, ShieldCheck, X } from "lucide-react"
import { useMemo, useState } from "react"

import type { BoardSummary } from "../../api/boards"
import { BoardNavigationTree } from "./BoardNavigationTree"
import { buildBoardTree, type BoardTreeNode } from "./boardTree"

interface BoardDirectoryPageProps {
  boards: BoardSummary[]
  status: "loading" | "ready" | "error"
  error: string | null
  onRetry: () => void
}

export function BoardDirectoryPage({ boards, status, error, onRetry }: BoardDirectoryPageProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase()
  const boardTree = useMemo(() => buildBoardTree(boards), [boards])
  const matchingBoardIds = useMemo(() => new Set(boards
    .filter((board) => boardMatchesQuery(board, normalizedQuery))
    .map((board) => board.id)), [boards, normalizedQuery])
  const visibleTree = useMemo(
    () => normalizedQuery ? filterBoardTree(boardTree, matchingBoardIds) : boardTree,
    [boardTree, matchingBoardIds, normalizedQuery],
  )
  return (
    <section className="board-directory-page" aria-labelledby="board-directory-title">
      <header className="board-page-title">
        <h1 id="board-directory-title">社区版块</h1>
        <p>发现感兴趣的社区版块，参与讨论，分享交流。</p>
      </header>
      {status === "loading" ? (
        <div className="topic-loading" role="status">
          <LoaderCircle className="topic-loading__spinner" size={22} aria-hidden="true" />
          <span>正在加载社区</span>
        </div>
      ) : status === "error" ? (
        <div className="empty-state" role="alert">
          <FileSearch size={28} aria-hidden="true" />
          <h2>社区暂时无法加载</h2>
          <p>{error ?? "请检查网络连接后重试。"}</p>
          <button className="secondary-button" type="button" onClick={onRetry}>
            <RefreshCw size={15} aria-hidden="true" />
            重试加载社区
          </button>
        </div>
      ) : boards.length === 0 ? (
        <div className="empty-state" role="status">
          <FileSearch size={28} aria-hidden="true" />
          <h2>还没有公开社区</h2>
          <p>公开社区创建后会显示在这里。</p>
        </div>
      ) : (
        <>
          <div className="board-directory-tools">
            <nav className="board-directory-tabs" aria-label="版块视图">
              <a href="#boards" aria-current="page">全部版块</a>
            </nav>
            <label className="board-directory-search">
              <Search size={16} aria-hidden="true" />
              <span className="sr-only">搜索社区</span>
              <input
                type="search"
                aria-label="搜索社区"
                value={searchQuery}
                placeholder="搜索社区名称或介绍"
                onChange={(event) => setSearchQuery(event.target.value)}
              />
              {searchQuery && (
                <button type="button" aria-label="清除社区搜索" title="清除社区搜索" onClick={() => setSearchQuery("")}>
                  <X size={15} aria-hidden="true" />
                </button>
              )}
            </label>
          </div>
          <section className="board-directory-section" aria-label="版块目录">
            <div className="board-directory-section__heading">
              <span aria-live="polite">
                {normalizedQuery ? `${matchingBoardIds.size} 个匹配版块` : `${boards.length} 个公开版块`}
              </span>
            </div>
            {visibleTree.length > 0 ? (
              <BoardNavigationTree
                key={normalizedQuery || "all"}
                nodes={visibleTree}
                label={normalizedQuery ? "版块搜索结果" : "全部版块列表"}
                expandAll={Boolean(normalizedQuery)}
              />
            ) : (
              <div className="board-directory-empty" role="status">
                <FileSearch size={24} aria-hidden="true" />
                <div>
                  <strong>没有找到相关社区</strong>
                  <span>试试社区名称、介绍或英文标识。</span>
                </div>
                <button className="secondary-button" type="button" onClick={() => setSearchQuery("")}>清除搜索</button>
              </div>
            )}
          </section>
          <aside className="board-directory-mobile-guide" aria-labelledby="mobile-board-guide-title">
            <div className="board-directory-mobile-guide__heading">
              <ShieldCheck size={17} aria-hidden="true" />
              <h2 id="mobile-board-guide-title">版块指南</h2>
            </div>
            <ul>
              <li><CheckCircle2 size={15} aria-hidden="true" /><span>选择合适的版块参与讨论</span></li>
              <li><CheckCircle2 size={15} aria-hidden="true" /><span>尊重他人，保持友善交流</span></li>
              <li><CheckCircle2 size={15} aria-hidden="true" /><span>发布前先阅读版块说明</span></li>
            </ul>
          </aside>
        </>
      )}
    </section>
  )
}

function boardMatchesQuery(board: BoardSummary, query: string) {
  if (!query) return true
  return [board.name, board.description, board.slug]
    .some((value) => value.toLocaleLowerCase().includes(query))
}

function filterBoardTree(nodes: BoardTreeNode[], matchingBoardIds: Set<string>): BoardTreeNode[] {
  return nodes.flatMap((node) => {
    const children = filterBoardTree(node.children, matchingBoardIds)
    return matchingBoardIds.has(node.board.id) || children.length > 0
      ? [{ board: node.board, children }]
      : []
  })
}
