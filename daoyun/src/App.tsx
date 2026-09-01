import { useEffect, useState } from "react"
import { LoaderCircle, RefreshCw } from "lucide-react"

import { AppRoot } from "./app/AppRoot"
import { getInstallationStatus } from "./api/installation"
import { BrandMark } from "./components/BrandMark"
import { InstallationWizard } from "./components/InstallationWizard"

type InstallationGateState = "checking" | "error" | "required" | "initialized"

export function App() {
  const [installationState, setInstallationState] = useState<InstallationGateState>("checking")
  const [installationRequestVersion, setInstallationRequestVersion] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setInstallationState("checking")

    getInstallationStatus(controller.signal).then((status) => {
      if (!controller.signal.aborted) {
        setInstallationState(status.isInitialized ? "initialized" : "required")
      }
    }).catch(() => {
      if (!controller.signal.aborted) {
        setInstallationState("error")
      }
    })

    return () => controller.abort()
  }, [installationRequestVersion])

  async function confirmInstallation(): Promise<boolean> {
    const status = await getInstallationStatus()
    if (status.isInitialized) {
      setInstallationState("initialized")
    }
    return status.isInitialized
  }

  if (installationState === "checking") {
    return <InstallationGateStatus kind="checking" />
  }
  if (installationState === "error") {
    return (
      <InstallationGateStatus
        kind="error"
        onRetry={() => setInstallationRequestVersion((version) => version + 1)}
      />
    )
  }
  if (installationState === "required") {
    return <InstallationWizard onConfirmInstallation={confirmInstallation} />
  }

  return <AppRoot />
}

interface InstallationGateStatusProps {
  kind: "checking" | "error"
  onRetry?: () => void
}

function InstallationGateStatus({ kind, onRetry }: InstallationGateStatusProps) {
  return (
    <div className="installation-page">
      <header className="installation-header">
        <span className="installation-brand">
          <BrandMark />
          <strong>刀云</strong>
        </span>
        <span>实例初始化</span>
      </header>
      <main className="installation-gate-state">
        {kind === "checking" ? (
          <div role="status" aria-live="polite">
            <LoaderCircle className="installation-spinner" size={22} aria-hidden="true" />
            <p>正在检查安装状态</p>
          </div>
        ) : (
          <div role="alert">
            <h1>无法确认安装状态</h1>
            <p>请检查 API 与数据库连接后重试。</p>
            <button className="secondary-button" type="button" onClick={onRetry}>
              <RefreshCw size={15} aria-hidden="true" />
              重试检查
            </button>
          </div>
        )}
      </main>
    </div>
  )
}