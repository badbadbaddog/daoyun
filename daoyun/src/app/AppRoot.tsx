import { lazy, Suspense } from "react"

import { useHashRoute } from "../router/useHashRoute"
import { CommunityApp } from "./CommunityApp"

const AdminApp = lazy(() => import("./AdminApp").then((module) => ({ default: module.AdminApp })))

export function AppRoot() {
  const { route, navigate } = useHashRoute()

  if (route.kind === "admin") {
    return (
      <Suspense fallback={<RouteLoading label="正在加载站点管理…" />}>
        <AdminApp route={route} navigate={navigate} />
      </Suspense>
    )
  }

  return <CommunityApp route={route} navigate={navigate} />
}

function RouteLoading({ label }: { label: string }) {
  return <main className="route-loading" role="status" aria-live="polite">{label}</main>
}
