import { useEffect, useState } from "react"
import { RefreshCw } from "lucide-react"
import { getCommunityAnalytics, type CommunityAnalytics } from "../api/analytics"

export function CommunityAnalyticsPanel() {
  const [windowDays, setWindowDays] = useState<7 | 30 | 90>(30)
  const [version, setVersion] = useState(0)
  const [report, setReport] = useState<CommunityAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setReport(null)
    setError("")
    getCommunityAnalytics(windowDays, controller.signal)
      .then(value => { if (!controller.signal.aborted) setReport(value) })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "报表读取失败") })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [windowDays, version])
  return <section className="community-analytics" aria-label="社区运营报表" aria-busy={loading}>
    <div className="analytics-toolbar">
      <label>统计范围<select value={windowDays} onChange={event => setWindowDays(Number(event.target.value) as 7 | 30 | 90)}>
        {[7,30,90].map(days => <option key={days} value={days}>最近 {days} 天</option>)}
      </select></label>
      <button className="secondary-button" disabled={loading} onClick={() => setVersion(value => value + 1)}><RefreshCw size={15} aria-hidden="true"/>刷新数据</button>
    </div>
    <p>UTC 自然日统计，包含今天尚未结束的部分。</p>
    {error && <p role="alert" className="form-alert">{error}</p>}
    {loading && <p role="status">正在读取运营数据</p>}
    {report && <>
      <p>{report.from} 至 {report.through} · 活跃与发布采集起点：{new Date(report.started_at).toISOString().replace("T"," ").slice(0,19)} UTC</p>
      {!report.activity_complete && <p role="status">活动数据不完整：仅展示已采集活动，缺失日期不能视为零活跃。</p>}
      {!report.content_complete && <p role="status">发布数据不完整：仅包含采集开始后的首次发布和回复事实。</p>}
      <dl className="analytics-metrics">
        {[["新增用户",report.new_users],["活跃用户（去重）",report.active_users],["首次发布主题",report.topics],["新增回复",report.replies],["积分发放",report.points_issued],["积分消耗",report.points_spent]].map(([label,value]) =>
          <div key={label}><dt>{label}</dt><dd>{Number(value).toLocaleString()}</dd></div>)}
      </dl>
      <section className="analytics-retention" aria-label="七日留存">
        <h2>七日留存</h2>
        <strong>{report.retention_eligible ? (report.retention_returned / report.retention_eligible * 100).toFixed(1) + "%" : "数据不足"}</strong>
        <p>完整观察样本 {report.retention_eligible} 人 · 第 7 日返回 {report.retention_returned} 人</p>
        <p>按注册后的第 7 个 UTC 自然日是否活跃计算；排除采集开始前及有采集缺口的观察区间。</p>
      </section>
      <div className="analytics-table-scroll" tabIndex={0} role="region" aria-label="每日趋势">
        <table><caption>每日趋势（— 表示采集不完整）</caption><thead><tr>{["日期","新增用户","活跃用户","主题","回复","积分发放","积分消耗"].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{report.days.map(day => <tr key={day.day}><th scope="row">{day.day}</th><td>{day.new_users}</td><td>{day.activity_complete ? day.active_users : "—"}</td><td>{day.content_complete ? day.topics : "—"}</td><td>{day.content_complete ? day.replies : "—"}</td><td>{day.points_issued}</td><td>{day.points_spent}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="analytics-table-scroll" tabIndex={0} role="region" aria-label="版块活跃排名">
        <table><caption>版块活跃排名（最多 20 个）</caption><thead><tr><th scope="col">版块</th><th scope="col">主题</th><th scope="col">回复</th><th scope="col">参与人数</th></tr></thead>
          <tbody>{report.boards.map(board => <tr key={board.board_id}><th scope="row">{board.name}</th><td>{board.topics}</td><td>{board.replies}</td><td>{board.participants}</td></tr>)}</tbody>
        </table>
        {!report.boards.length && <p>当前范围没有已采集的版块参与记录。</p>}
      </div>
    </>}
  </section>
}
