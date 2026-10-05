import { lazy, Suspense, useEffect } from "react"

import { useHashRoute } from "../router/useHashRoute"
import { CommunityApp } from "./CommunityApp"

const AdminApp = lazy(() => import("./AdminApp").then((module) => ({ default: module.AdminApp })))

export function AppRoot() {
  const { route, navigate } = useHashRoute()

  useEffect(() => {
    const viewport = window.visualViewport
    const root = document.documentElement
    const update = () => {
      const height = viewport?.height ?? window.innerHeight
      const offset = viewport?.offsetTop ?? 0
      root.style.setProperty("--app-visible-height", `${height}px`)
      root.style.setProperty("--app-visible-offset", `${offset}px`)
      root.style.setProperty("--app-keyboard-inset", `${Math.max(0, window.innerHeight - height - offset)}px`)
    }
    update()
    viewport?.addEventListener("resize", update)
    viewport?.addEventListener("scroll", update)
    window.addEventListener("resize", update)
    return () => {
      viewport?.removeEventListener("resize", update)
      viewport?.removeEventListener("scroll", update)
      window.removeEventListener("resize", update)
      for (const key of ["--app-visible-height", "--app-visible-offset", "--app-keyboard-inset"]) root.style.removeProperty(key)
    }
  }, [])

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
