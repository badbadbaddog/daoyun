import type { BoardSummary } from "../../api/boards"

export function BoardChildren({ boards }: { boards: BoardSummary[] }) {
  if (boards.length === 0) return null
  return (
    <section className="board-children" aria-labelledby="board-children-title">
      <div className="board-children__heading">
        <h2 id="board-children-title">子版块导航</h2>
      </div>
      <ul aria-label="子版块列表">
        {boards.map((board) => (
          <li key={board.id}>
            <a href={`#board/${board.slug}`} title={board.description || undefined}>{board.name}</a>
          </li>
        ))}
      </ul>
    </section>
  )
}
