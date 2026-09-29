import { useState, type FormEvent } from "react"
import { parseTopicTags } from "../../utils/tags"
import type { TopicTag } from "../../types/community"
import type { BoardSummary } from "../../api/boards"
import { normalizeSearchFilters, type SearchContentFilters } from "../../router/communityRoute"

export function SearchFilters({filters,boards,tags = [],onChange}:{
  filters:SearchContentFilters
  boards:BoardSummary[]
  tags?:TopicTag[]
  onChange:(filters:SearchContentFilters)=>void
}) {
  const [draft,setDraft]=useState(filters)
  function apply(event:FormEvent) {
    event.preventDefault()
    const tag = draft.tag?.trim().replace(/^#/, "")
    onChange(normalizeSearchFilters({...draft, tag: tag ? parseTopicTags(tag, tags)[0]?.slug : undefined}))
  }
  return <form className="search-filters" aria-label="内容筛选" onSubmit={apply}>
    <p>以下条件仅筛选内容；日期按 UTC 计算，包含开始和结束当天。</p>
    <div className="search-filter-fields">
      <label>版块<select value={draft.board??""} onChange={event=>setDraft({...draft,board:event.target.value})}>
        <option value="">全部版块</option>
        {draft.board&&!boards.some(board=>board.slug===draft.board)&&<option value={draft.board}>{draft.board}</option>}
        {boards.map(board=><option key={board.id} value={board.slug}>{board.name}</option>)}
      </select></label>
      <label>作者用户名<input maxLength={32} pattern="[a-z][a-z0-9_]{2,31}" placeholder="例如 author" value={draft.author??""} onChange={event=>setDraft({...draft,author:event.target.value})}/></label>
      <label>标签<input maxLength={40} placeholder="标签名称，例如 Rust" value={tags.find(tag => tag.slug === draft.tag)?.name ?? draft.tag ?? ""} onChange={event=>setDraft({...draft,tag:event.target.value})}/></label>
      <label>开始日期<input type="date" max={draft.through||undefined} value={draft.from??""} onChange={event=>setDraft({...draft,from:event.target.value})}/></label>
      <label>结束日期<input type="date" min={draft.from||undefined} value={draft.through??""} onChange={event=>setDraft({...draft,through:event.target.value})}/></label>
      <label>排序<select value={draft.sort??"latest"} onChange={event=>setDraft({...draft,sort:event.target.value as SearchContentFilters["sort"]})}>
        <option value="latest">最新发布</option><option value="popular">热门内容</option><option value="active">最近活跃</option>
      </select></label>
    </div>
    <div className="search-filter-actions">
      <button className="primary-button" type="submit">应用筛选</button>
      <button className="secondary-button" type="button" onClick={()=>{setDraft({});onChange({})}}>清除筛选</button>
    </div>
  </form>
}
