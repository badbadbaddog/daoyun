import type { BoardBreadcrumbItem } from "../../api/boards"

export function BoardBreadcrumb({ items }: { items: BoardBreadcrumbItem[] }) {
  return (
    <nav className="board-breadcrumb" aria-label="社区路径">
      <a href="#hot">首页</a>
      <span aria-hidden="true">/</span>
      <a href="#boards">社区</a>
      {items.map((item, index) => (
        <span key={item.id}>
          <span aria-hidden="true">/</span>
          {index === items.length - 1 ? <span aria-current="page">{item.name}</span> : (
            <a href={`#board/${item.slug}`}>{item.name}</a>
          )}
        </span>
      ))}
    </nav>
  )
}
