import type { BoardSummary } from "../../api/boards"

export function BoardSearchResults({ boards }: { boards: BoardSummary[] }) {
  return (
    <section className="search-result-section" aria-labelledby="board-search-title">
      <h2 id="board-search-title">版块</h2>
      {boards.length === 0 ? <p className="search-result-empty">没有匹配的版块</p> : (
        <ul>{boards.map((board) => <li key={board.id}><a href={`#board/${board.slug}`}><strong>{board.name}</strong><span>{board.description}</span></a></li>)}</ul>
      )}
    </section>
  )
}
