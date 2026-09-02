import { useEffect, useState } from "react"

import { getCurrentSession } from "../api/auth"
import type { AuthSession } from "../api/auth"
import { AdminView } from "../components/AdminView"
import type { CommunityRoute } from "../router/communityRoute"
import { currentRoute, type NavigateOptions } from "../router/hashRouter"

type AdminRoute = Extract<CommunityRoute, { kind: "admin" }>
type Navigate = (route: CommunityRoute, options?: NavigateOptions) => void

interface AdminAppProps {
  route: AdminRoute
  navigate: Navigate
}

export function AdminApp({ route, navigate }: AdminAppProps) {
  const [session, setSession] = useState<AuthSession | null | undefined>(undefined)

  useEffect(() => {
    const controller = new AbortController()
    getCurrentSession(controller.signal)
      .then((current) => { if (!controller.signal.aborted) setSession(current) })
      .catch(() => { if (!controller.signal.aborted) setSession(null) })
    return () => controller.abort()
  }, [])

  return (
    <div className="system-admin-app">
      <AdminView
        session={session}
        requestedTab={route.tab}
        requestedQuery={route.query}
        onTabChange={(tab) => navigate({ kind: "admin", tab, query: "" })}
        onQueryChange={(query) => {
          const current = currentRoute()
          navigate({
            kind: "admin",
            tab: current.kind === "admin" ? (current.tab ?? "dashboard") : (route.tab ?? "dashboard"),
            query,
          })
        }}
        onBack={() => navigate({ kind: "feed", feed: "hot" })}
      />
    </div>
  )
}
