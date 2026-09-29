import { ChartNoAxesCombined, RefreshCw } from "lucide-react"
import { useEffect, useId, useState } from "react"
import { getCommunityAnalytics, type CommunityAnalytics } from "../api/analytics"

const metrics = [
  { key: "topics", label: "主题发布", unit: "个主题" },
  { key: "replies", label: "新增回复", unit: "条回复" },
  { key: "new_users", label: "新增用户", unit: "人" },
] as const

export function AdminDashboardTrend() {
  const fillId = useId()
  const [metric, setMetric] = useState<(typeof metrics)[number]>(metrics[0])
  const [report, setReport] = useState<CommunityAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(false)
    setReport(null)
    getCommunityAnalytics(7, controller.signal)
      .then((value) => { if (!controller.signal.aborted) setReport(value) })
      .catch(() => { if (!controller.signal.aborted) setError(true) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [reload])

  // 新增用户来自注册记录；采集完整性仅约束活动与发布事件。
  const complete = (day: CommunityAnalytics["days"][number]) => metric.key === "new_users" || day.content_complete
  const days = report?.days ?? []
  const maximum = Math.max(1, ...days.filter(complete).map((day) => day[metric.key]))
  const yMax = Math.max(4, Math.ceil(maximum / 4) * 4)
  const points = days.map((day, index) => ({
    day,
    x: 4 + index * 592 / Math.max(1, days.length - 1),
    y: 156 - day[metric.key] / yMax * 152,
  }))
  const totalComplete = metric.key === "new_users" || report?.content_complete

  return <section className="admin-dashboard__trend" aria-label="近7天数据趋势" aria-busy={loading}>
    <header><div><h3>近7天数据趋势</h3><p>UTC 自然日 · 包含今天</p></div>
      <div className="admin-dashboard__trend-tabs" role="group" aria-label="趋势指标">
        {metrics.map((item) => <button key={item.key} type="button" aria-pressed={metric.key === item.key} onClick={() => setMetric(item)}>{item.label}</button>)}
      </div>
    </header>
    {loading && <div className="admin-dashboard__trend-state" role="status"><ChartNoAxesCombined size={26} aria-hidden="true" />正在读取趋势数据</div>}
    {error && <div className="admin-dashboard__trend-state" role="alert"><p>趋势数据暂时无法加载</p><button className="secondary-button" type="button" onClick={() => setReload((value) => value + 1)}><RefreshCw size={15} aria-hidden="true" />重试趋势数据</button></div>}
    {report && <>
      <div className="admin-dashboard__trend-total"><strong>{report[metric.key].toLocaleString("zh-CN")}</strong><span>{metric.unit} · {totalComplete ? "近7天" : "已采集"}</span><small>{report.from} — {report.through}</small></div>
      {days.length === 0 ? <p className="admin-dashboard__trend-state">当前范围暂无可展示的每日数据</p> : <>
        <div className="admin-dashboard__chart-frame">
          <div className="admin-dashboard__chart-scale" aria-hidden="true">
            {[4, 3, 2, 1, 0].map((step) => <span key={step}>{(yMax * step / 4).toLocaleString("zh-CN", { notation: "compact", maximumFractionDigits: 1 })}</span>)}
          </div>
          <svg className="admin-dashboard__chart" viewBox="0 0 600 160" preserveAspectRatio="none" role="img" aria-label={`近7天${metric.label}趋势`}>
            <desc>每日{metric.label}，单位：{metric.unit}。精确数值见下方每日数据表；采集不完整的日期留空。</desc>
            <defs><linearGradient id={fillId} gradientUnits="userSpaceOnUse" x1="0" y1="4" x2="0" y2="156"><stop offset="0%" stopColor="var(--brand-strong)" stopOpacity=".18" /><stop offset="100%" stopColor="var(--brand-strong)" stopOpacity=".02" /></linearGradient></defs>
            {points.map(({ day, x, y }, index) => {
              const previous = points[index - 1]
              return previous && complete(previous.day) && complete(day) && Date.parse(day.day) - Date.parse(previous.day.day) === 86400000
                ? <polygon key={day.day} data-trend-area points={[previous.x + ",156", previous.x + "," + previous.y, x + "," + y, x + ",156"].join(" ")} fill={"url(#" + fillId + ")"} />
                : null
            })}
            {[0, 1, 2, 3, 4].map((step) => <line key={step} className="admin-dashboard__chart-grid" x1="4" x2="596" y1={156 - step * 38} y2={156 - step * 38} />)}
            {points.map(({ day, x, y }, index) => {
              const previous = points[index - 1]
              const adjacent = previous && Date.parse(day.day) - Date.parse(previous.day.day) === 86400000
              return complete(day) ? <g key={day.day}>
                {adjacent && complete(previous.day) && <line data-trend-segment x1={previous.x} y1={previous.y} x2={x} y2={y} className="admin-dashboard__chart-line" />}
                <circle cx={x} cy={y} r="1" className="admin-dashboard__chart-point"><title>{day.day}：{day[metric.key]} {metric.unit}</title></circle>
              </g> : null
            })}
          </svg>
          <div className="admin-dashboard__chart-dates" aria-hidden="true">
            {points.map(({ day, x }) => <span key={day.day} style={{ left: `${x / 600 * 100}%` }}>{Number(day.day.slice(5, 7))}/{Number(day.day.slice(8))}</span>)}
          </div>
        </div>
        {(!totalComplete || days.some((day) => !complete(day))) && <p className="admin-dashboard__trend-note">发布采集不完整，缺失日期留空，不计为零。</p>}
        <details className="admin-dashboard__trend-data"><summary>查看每日数据</summary>
          <table><caption>{metric.label}（{metric.unit}）</caption><thead><tr><th scope="col">日期（UTC）</th><th scope="col">数量</th></tr></thead>
            <tbody>{days.map((day) => <tr key={day.day}><th scope="row">{day.day}</th><td>{complete(day) ? day[metric.key] : "—（采集不完整）"}</td></tr>)}</tbody>
          </table>
        </details>
      </>}
    </>}
  </section>
}
