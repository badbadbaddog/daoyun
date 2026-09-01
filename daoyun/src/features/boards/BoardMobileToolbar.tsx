import { ChevronLeft, Ellipsis, Search } from "lucide-react"

import type { BoardDetail } from "../../api/boards"

export function BoardMobileToolbar({ board }: { board: BoardDetail }) {
  const parent = board.breadcrumb.length > 1 ? board.breadcrumb.at(-2) : null
  const backHref = parent ? `#board/${parent.slug}` : "#boards"

  const focusSearch = () => {
    const input = document.getElementById("board-search-input")
    if (!(input instanceof HTMLInputElement)) return
    input.focus()
    input.scrollIntoView({ block: "center" })
  }

  return (
    <nav className="board-mobile-toolbar" aria-label="版块快捷操作">
      <a className="board-mobile-toolbar__action" href={backHref} aria-label="返回社区版块" title="返回社区版块">
        <ChevronLeft size={20} aria-hidden="true" />
      </a>
      <strong>{board.name}</strong>
      <button className="board-mobile-toolbar__action" type="button" onClick={focusSearch} aria-label="搜索当前版块" title="搜索当前版块">
        <Search size={18} aria-hidden="true" />
      </button>
      <a className="board-mobile-toolbar__action" href="#boards" aria-label="浏览全部版块" title="浏览全部版块">
        <Ellipsis size={20} aria-hidden="true" />
      </a>
    </nav>
  )
}
