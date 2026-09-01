import { RefreshCw } from "lucide-react"

export function RevisionConflictNotice({ onRefresh }: { onRefresh: () => void }) {
  return <div className="revision-conflict" role="alert"><strong>数据已被其他管理员更新</strong><p>旧 revision 已失效，请刷新后重新确认本次操作。</p><button className="secondary-button" type="button" onClick={onRefresh}><RefreshCw size={15} aria-hidden="true" />刷新最新数据</button></div>
}
