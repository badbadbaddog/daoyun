import { Activity, AlertCircle, AlertTriangle, CheckCircle2, Clock3, Database, LoaderCircle, RefreshCw, Save } from "lucide-react"
import { useEffect, useState } from "react"

import {
  acknowledgeOperationsAlert,
  AdminApiError,
  getOperationsSummary,
  listOperationsAlertRules,
  listOperationsAlerts,
  updateOperationsAlertRule,
} from "../api/admin"
import type { OperationsAlert, OperationsAlertRule, OperationsSummary } from "../api/admin"

interface OperationsAdminPanelProps {
  csrfToken: string
  canWrite?: boolean
}

interface RuleDraft {
  name: string
  threshold: string
  windowSeconds: string
  enabled: boolean
  revision: number
}

type LoadStatus = "loading" | "ready" | "forbidden" | "error"

export function OperationsAdminPanel({ csrfToken, canWrite = true }: OperationsAdminPanelProps) {
  const [status, setStatus] = useState<LoadStatus>("loading")
  const [summary, setSummary] = useState<OperationsSummary | null>(null)
  const [rules, setRules] = useState<OperationsAlertRule[]>([])
  const [drafts, setDrafts] = useState<Record<string, RuleDraft>>({})
  const [alerts, setAlerts] = useState<OperationsAlert[]>([])
  const [reload, setReload] = useState(0)
  const [pendingRuleId, setPendingRuleId] = useState<string | null>(null)
  const [pendingAlertId, setPendingAlertId] = useState<string | null>(null)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    const controller = new AbortController()
    setStatus("loading")
    setError("")
    setMessage("")
    Promise.all([
      getOperationsSummary(controller.signal),
      listOperationsAlertRules(controller.signal),
      listOperationsAlerts({ status: "open", limit: 50, signal: controller.signal }),
    ]).then(([loadedSummary, loadedRules, loadedAlerts]) => {
      if (controller.signal.aborted) return
      setSummary(loadedSummary)
      replaceRules(loadedRules)
      setAlerts(loadedAlerts.alerts)
      setStatus("ready")
    }).catch((reason: unknown) => {
      if (controller.signal.aborted) return
      if (reason instanceof AdminApiError && reason.status === 403) {
        setSummary(null)
        setRules([])
        setAlerts([])
        setStatus("forbidden")
        return
      }
      setSummary(null)
      setStatus("error")
      setError("运营状态暂时无法加载，请稍后重试。")
    })
    return () => controller.abort()
  }, [reload])

  function replaceRules(nextRules: OperationsAlertRule[]) {
    setRules(nextRules)
    setDrafts(Object.fromEntries(nextRules.map((rule) => [rule.id, draftFromRule(rule)])))
  }

  function changeDraft(ruleId: string, change: Partial<RuleDraft>) {
    setDrafts((current) => ({ ...current, [ruleId]: { ...current[ruleId], ...change } }))
    setMessage("")
    setError("")
  }

  async function saveRule(rule: OperationsAlertRule) {
    if (!canWrite) return
    const draft = drafts[rule.id]
    if (!draft) return
    const threshold = Number(draft.threshold)
    const windowSeconds = Number(draft.windowSeconds)
    if (!draft.name.trim() || !Number.isSafeInteger(threshold) || threshold < 0 || threshold > 1_000_000_000 || !Number.isSafeInteger(windowSeconds) || windowSeconds < 30 || windowSeconds > 86_400) {
      setError("请检查规则名称、阈值和窗口；窗口必须为 30 到 86400 秒。")
      return
    }
    setPendingRuleId(rule.id)
    setMessage("")
    setError("")
    try {
      const saved = await updateOperationsAlertRule(rule.id, {
        name: draft.name.trim(),
        threshold,
        windowSeconds,
        enabled: draft.enabled,
        expectedRevision: draft.revision,
      }, csrfToken)
      setRules((current) => current.map((item) => item.id === saved.id ? saved : item))
      setDrafts((current) => ({ ...current, [saved.id]: draftFromRule(saved) }))
      setMessage(`${saved.name}规则已保存`)
    } catch (reason) {
      if (reason instanceof AdminApiError && reason.code === "operations.rule_conflict") {
        try {
          replaceRules(await listOperationsAlertRules())
          setMessage("规则已被其他管理员修改，已刷新最新数据。")
        } catch {
          setError("规则版本已变化，但最新规则暂时无法加载。")
        }
      } else if (reason instanceof AdminApiError && reason.status === 403) {
        setError("当前账号没有修改运营告警规则的权限。")
      } else {
        setError(reason instanceof AdminApiError ? reason.message : "规则保存失败，请稍后重试。")
      }
    } finally {
      setPendingRuleId(null)
    }
  }

  async function acknowledge(alert: OperationsAlert) {
    setPendingAlertId(alert.id)
    setMessage("")
    setError("")
    try {
      await acknowledgeOperationsAlert(alert.id, csrfToken)
      setAlerts((current) => current.filter((item) => item.id !== alert.id))
      setSummary((current) => current ? {
        ...current,
        alerts: {
          open: Math.max(0, current.alerts.open - 1),
          acknowledged: current.alerts.acknowledged + 1,
        },
      } : current)
      setMessage(`${alert.rule.name}告警已确认`)
    } catch (reason) {
      if (reason instanceof AdminApiError && reason.code === "operations.alert_conflict") {
        setAlerts((current) => current.filter((item) => item.id !== alert.id))
        setMessage("告警状态已变化，已从待确认列表移除。")
      } else if (reason instanceof AdminApiError && reason.status === 403) {
        setError("当前账号没有确认运营告警的权限。")
      } else {
        setError(reason instanceof AdminApiError ? reason.message : "告警确认失败，请稍后重试。")
      }
    } finally {
      setPendingAlertId(null)
    }
  }

  if (status === "loading") return <div className="admin-state" role="status"><LoaderCircle className="topic-loading__spinner" size={22} aria-hidden="true" /><span>正在读取运营状态</span></div>
  if (status === "forbidden") return <div className="admin-state" role="alert"><AlertCircle size={24} aria-hidden="true" /><h2>当前账号没有查看运营监控的权限</h2><p>需要 operations.read capability。</p></div>
  if (status === "error" || !summary) return <div className="admin-state" role="alert"><AlertCircle size={24} aria-hidden="true" /><h2>运营监控加载失败</h2><p>{error}</p><button className="secondary-button" type="button" onClick={() => setReload((value) => value + 1)}><RefreshCw size={15} aria-hidden="true" />重试</button></div>

  return (
    <div className="operations-admin">
      <div className="operations-admin__heading">
        <div><h2>运营概览</h2><p>观测时间：{formatDate(summary.observedAt)} · 运行 {formatDuration(summary.uptimeSeconds)}</p>{!canWrite && <span className="admin-badge">只读权限</span>}</div>
        <button className="secondary-button" type="button" onClick={() => setReload((value) => value + 1)}><RefreshCw size={15} aria-hidden="true" />刷新状态</button>
      </div>

      <div className="operations-summary" aria-label="运营指标概览">
        <SummaryItem icon={<Activity size={18} aria-hidden="true" />} label="HTTP 请求" value={summary.http.totalRequests.toLocaleString()} detail={`进行中 ${summary.http.inFlightRequests} · 5 分钟 5xx ${summary.http.errors5m}`} />
        <SummaryItem icon={<Clock3 size={18} aria-hidden="true" />} label="API P95" value={`${summary.http.p95Ms5m} ms`} detail="最近 5 分钟" />
        <SummaryItem icon={<Database size={18} aria-hidden="true" />} label={summary.database.ready ? "数据库正常" : "数据库异常"} value={`${summary.database.connections} 个连接`} detail={`空闲 ${summary.database.idleConnections}`} tone={summary.database.ready ? "normal" : "danger"} />
        <SummaryItem icon={<AlertTriangle size={18} aria-hidden="true" />} label="Outbox" value={`${summary.outbox.pending} 待处理`} detail={`处理中 ${summary.outbox.processing} · 死信 ${summary.outbox.dead}`} tone={summary.outbox.dead > 0 ? "danger" : "normal"} />
        <SummaryItem icon={<AlertTriangle size={18} aria-hidden="true" />} label="风险告警" value={`${summary.riskAlertsOpen} 条`} detail="当前未处理" tone={summary.riskAlertsOpen > 0 ? "warning" : "normal"} />
        <SummaryItem icon={<CheckCircle2 size={18} aria-hidden="true" />} label="运营告警" value={`${summary.alerts.open} 待确认`} detail={`已确认 ${summary.alerts.acknowledged}`} tone={summary.alerts.open > 0 ? "warning" : "normal"} />
      </div>

      {(message || error) && <p className={error ? "form-alert" : "form-success"} role={error ? "alert" : "status"}>{error || message}</p>}

      <section className="operations-section" aria-labelledby="operations-alerts-heading">
        <div className="operations-section__heading"><div><h2 id="operations-alerts-heading">待确认告警</h2><p>恢复由后台评估器自动处理。</p></div><span className="operations-count">{alerts.length}</span></div>
        {alerts.length === 0 ? <p className="operations-empty">当前没有待确认的运营告警</p> : (
          <div className="operations-alert-list">
            {alerts.map((alert) => <article className="operations-alert" key={alert.id}>
              <div><h3>{alert.rule.name}</h3><p>{ruleKindLabel(alert.rule.kind)} · 当前值 {alert.observedValue} · 阈值 {alert.threshold}</p><small>最近触发：{formatDate(alert.lastTriggeredAt)}</small></div>
              {canWrite && <button className="secondary-button" type="button" disabled={pendingAlertId === alert.id} onClick={() => void acknowledge(alert)} aria-label={`确认 ${alert.rule.name}告警`}>
                {pendingAlertId === alert.id ? <LoaderCircle className="topic-loading__spinner" size={15} aria-hidden="true" /> : <CheckCircle2 size={15} aria-hidden="true" />}确认
              </button>}
            </article>)}
          </div>
        )}
      </section>

      <section className="operations-section" aria-labelledby="operations-rules-heading">
        <div className="operations-section__heading"><div><h2 id="operations-rules-heading">告警规则</h2><p>固定信号类型，支持阈值、窗口与启用状态调整。</p></div></div>
        <div className="operations-rule-list">
          {rules.map((rule) => {
            const draft = drafts[rule.id]
            if (!draft) return null
            return <form className="operations-rule" key={rule.id} onSubmit={(event) => { event.preventDefault(); void saveRule(rule) }}>
              <div className="operations-rule__title"><div><h3>{rule.name}</h3><p>{ruleKindLabel(rule.kind)} · revision {draft.revision}</p></div><label className="admin-switch"><input type="checkbox" checked={draft.enabled} disabled={!canWrite} onChange={(event) => changeDraft(rule.id, { enabled: event.target.checked })} /><span>启用</span></label></div>
              <div className="operations-rule__fields">
                <label><span>规则名称</span><input aria-label={`${rule.name}名称`} value={draft.name} maxLength={80} disabled={!canWrite} onChange={(event) => changeDraft(rule.id, { name: event.target.value })} /></label>
                <label><span>阈值</span><input aria-label={`${rule.name}阈值`} type="number" min="0" max="1000000000" step="1" value={draft.threshold} disabled={!canWrite} onChange={(event) => changeDraft(rule.id, { threshold: event.target.value })} /></label>
                <label><span>窗口（秒）</span><input aria-label={`${rule.name}窗口`} type="number" min="30" max="86400" step="1" value={draft.windowSeconds} disabled={!canWrite} onChange={(event) => changeDraft(rule.id, { windowSeconds: event.target.value })} /></label>
              </div>
              {canWrite && <div className="admin-form__actions"><button className="secondary-button" type="submit" disabled={pendingRuleId === rule.id} aria-label={`保存 ${rule.name}规则`}>{pendingRuleId === rule.id ? <LoaderCircle className="topic-loading__spinner" size={15} aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}保存规则</button></div>}
            </form>
          })}
        </div>
      </section>
    </div>
  )
}

function SummaryItem({ icon, label, value, detail, tone = "normal" }: { icon: React.ReactNode; label: string; value: string; detail: string; tone?: "normal" | "warning" | "danger" }) {
  return <article className={`operations-summary__item operations-summary__item--${tone}`}>{icon}<div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></article>
}

function draftFromRule(rule: OperationsAlertRule): RuleDraft {
  return { name: rule.name, threshold: String(rule.threshold), windowSeconds: String(rule.windowSeconds), enabled: rule.enabled, revision: rule.revision }
}

function ruleKindLabel(kind: OperationsAlertRule["kind"]): string {
  return ({ http_5xx_count: "HTTP 5xx 数", http_p95_ms: "HTTP P95 毫秒", outbox_dead_count: "Outbox 死信数", risk_alert_open_count: "未处理风险告警数" } as const)[kind]
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "medium", hour12: false }).format(new Date(value))
}

function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  return [days ? `${days} 天` : "", hours ? `${hours} 小时` : "", `${minutes} 分钟`].filter(Boolean).join(" ")
}
