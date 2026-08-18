import { LoaderCircle, Play } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import {
  PluginApiError,
  executePluginUiSurfaceAction,
  listPluginUiSurfaceContributions,
  type PluginUiSlot,
  type PluginUiSurfaceContribution,
} from "../api/plugins"
import { PluginPanelFrame } from "./PluginAdminPanel"

interface PluginUiSurfaceProps {
  slot: Exclude<PluginUiSlot, "admin_plugin">
  subjectId: string
  csrfToken?: string
}

export function PluginUiSurface({ slot, subjectId, csrfToken }: PluginUiSurfaceProps) {
  const [contributions, setContributions] = useState<PluginUiSurfaceContribution[]>([])
  const [loading, setLoading] = useState(true)
  const [busyAction, setBusyAction] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const load = useCallback(async (signal?: AbortSignal) => {
    const loaded = await listPluginUiSurfaceContributions(slot, subjectId, signal)
    setContributions(loaded.filter((item) => item.slot === slot))
  }, [slot, subjectId])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError("")
    load(controller.signal)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof PluginApiError ? reason.message : "扩展内容暂时无法加载")
        }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [load])

  async function runAction(contribution: PluginUiSurfaceContribution, actionKey: string) {
    if (!csrfToken) return
    const actionId = `${contribution.pluginId}:${actionKey}`
    setBusyAction(actionId)
    setError("")
    setNotice("")
    try {
      await executePluginUiSurfaceAction(
        contribution.pluginId,
        slot,
        subjectId,
        actionKey,
        crypto.randomUUID(),
        csrfToken,
      )
      setNotice("扩展动作已完成")
      await load()
    } catch (reason) {
      setError(reason instanceof PluginApiError ? reason.message : "扩展动作暂时无法执行")
    } finally {
      setBusyAction("")
    }
  }

  if (loading) {
    return <div className="plugin-surface-state" role="status"><LoaderCircle className="topic-loading__spinner" size={16} aria-hidden="true" />正在加载扩展内容</div>
  }
  if (contributions.length === 0 && !error) return null

  return <div className={`plugin-surface plugin-surface--${slot}`}>
    {error ? <p className="plugin-contribution-error">{error}</p> : null}
    {notice ? <p className="admin-success">{notice}</p> : null}
    {contributions.map((contribution) => (
      <section
        className="plugin-contribution"
        key={`${contribution.pluginId}:${contribution.schema.title}`}
        aria-label={`插件扩展：${contribution.schema.title}`}
      >
        <PluginPanelFrame schema={contribution.schema} />
        {csrfToken ? <div className="plugin-row__actions">
          {contribution.schema.blocks.filter((block) => block.kind === "action").map((block) => {
            const actionId = `${contribution.pluginId}:${block.action_key}`
            return <button
              className="secondary-button"
              type="button"
              key={block.action_key}
              disabled={busyAction === actionId}
              onClick={() => void runAction(contribution, block.action_key)}
            >
              {busyAction === actionId
                ? <LoaderCircle className="topic-loading__spinner" size={14} aria-hidden="true" />
                : <Play size={14} aria-hidden="true" />}
              {block.label}
            </button>
          })}
        </div> : null}
      </section>
    ))}
  </div>
}
