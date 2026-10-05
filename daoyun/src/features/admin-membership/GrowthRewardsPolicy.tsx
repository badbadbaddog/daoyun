import { useEffect, useState } from "react"
import { listPlugins, type Plugin } from "../../api/plugins"

export function GrowthRewardsPolicy({ canReadPlugins }: { canReadPlugins: boolean }) {
  const [plugin, setPlugin] = useState<Plugin | null>(null)
  const [loading, setLoading] = useState(canReadPlugins)
  const [error, setError] = useState("")
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!canReadPlugins) { setPlugin(null); setLoading(false); setError(""); return }
    const controller = new AbortController()
    setPlugin(null); setLoading(true); setError("")
    listPlugins(controller.signal).then(items => {
      if (!controller.signal.aborted) setPlugin(items.find(item => item.key === "official_growth_rewards") ?? null)
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "奖励安装状态暂时无法读取。")
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [canReadPlugins, attempt])

  return <section className="membership-growth-rewards" aria-label="成长奖励规则">
    <h3>官方成长奖励 · V1 规则</h3>
    <p>EXP 用于成长展示，不是可消费积分，也不赋予管理权限。</p>
    <dl>
      <div><dt>奖励来源</dt><dd>每日首次发布主题：10 EXP；每日首次回复：3 EXP。</dd></div>
      <div><dt>业务日与上限</dt><dd>按原始事件发生时间的 UTC 自然日计算，每人每规则每天最多一次；两项合计最多 13 EXP。</dd></div>
      <div><dt>重放与停用</dt><dd>重试沿用原业务日与幂等标识；停用停止新的奖励执行，已有经验账本保留。</dd></div>
      <div><dt>执行边界</dt><dd>当前仅支持 Wasm 奖励执行器；未开放内置执行器切换，须先确认历史水位与唯一写入者。</dd></div>
    </dl>
    {!canReadPlugins ? <p role="status">无插件状态读取权限</p> : loading ? <p role="status">正在读取奖励安装状态</p> : error ? <div><p role="alert">{error}</p><button type="button" className="secondary-button" onClick={() => setAttempt(value => value + 1)}>重新读取奖励安装状态</button></div> : <p role="status">安装状态：{plugin ? plugin.status === "enabled" ? "已启用" : "已停用" : "未安装"}</p>}
    <small>以上为官方 V1 规则说明。安装状态为目录快照，不代表运行环境健康；自定义组件以实际实现为准。</small>
    {canReadPlugins && <a href="#admin/plugins">查看奖励来源与插件配置</a>}
  </section>
}
