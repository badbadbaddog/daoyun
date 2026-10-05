import { Database, LoaderCircle, RefreshCw } from "lucide-react"
import { useEffect, useState } from "react"
import { getAttachmentStorageConfiguration, type AttachmentStorageConfiguration } from "../api/storage"
export function StorageAdminPanel() {
  const [data, setData] = useState<AttachmentStorageConfiguration | null>(null)
  const [error, setError] = useState(false)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setData(null); setError(false)
    getAttachmentStorageConfiguration(controller.signal).then(value => { if (!controller.signal.aborted) setData(value) }).catch(() => { if (!controller.signal.aborted) setError(true) })
    return () => controller.abort()
  }, [reload])
  if (error) return <div className="admin-state" role="alert"><p>存储配置暂时无法加载</p><button className="secondary-button" type="button" onClick={() => setReload(value => value + 1)}>重试</button></div>
  if (!data) return <div className="admin-state" role="status"><LoaderCircle className="topic-loading__spinner" size={22} aria-hidden="true" /><span>正在读取存储配置</span></div>
  const configured = (provider: "local" | "s3") => provider === "local" ? data.local_configured : data.s3_configured
  return <section className="operations-admin storage-admin" aria-label="存储配置">
    <div className="operations-admin__heading"><h2>附件存储</h2><button className="secondary-button" type="button" onClick={() => setReload(value => value + 1)}><RefreshCw size={15} aria-hidden="true" />刷新配置</button></div>
    <div className="operations-summary">{([ ["新附件写入",data.write_provider], ["未标记历史记录",data.legacy_provider] ] as const).map(([label,provider]) => <article className="operations-summary__item" key={label}><Database size={18} aria-hidden="true" /><div><span>{label}</span><strong>{provider === "local" ? "本地目录" : "S3 对象存储"}</strong><small>{configured(provider) ? "已配置" : "未配置"}</small></div></article>)}</div>
    <p>已标记的附件按各自存储位置读取；切换新写入位置不会移动历史附件。</p>
    <p>{data.s3_supported ? "本构建支持 S3" : "本构建不支持 S3"} · 配置状态不代表远端服务健康。</p>
    {(!configured(data.write_provider) || !configured(data.legacy_provider)) && <p className="form-alert" role="alert">所选存储尚未配置，相关附件暂时无法读写。</p>}
    <p>完整备份需包含数据库、实际附件、解密材料与部署配置；恢复前应在隔离环境核验。</p>
  </section>
}
