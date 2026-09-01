import { useCallback, useEffect, useState } from "react"

import type { CommunityRoute } from "./communityRoute"
import {
  currentRoute,
  navigate as navigateHashRoute,
  normalizeLegacyHash,
  subscribeHashRoute,
  type NavigateOptions,
} from "./hashRouter"

export function useHashRoute() {
  const [route, setRoute] = useState<CommunityRoute>(currentRoute)

  useEffect(() => {
    const syncRoute = (nextRoute: CommunityRoute) => {
      if (normalizeLegacyHash()) setRoute(currentRoute())
      else setRoute(nextRoute)
    }
    const unsubscribe = subscribeHashRoute(syncRoute)
    if (normalizeLegacyHash()) setRoute(currentRoute())
    return unsubscribe
  }, [])

  const navigate = useCallback((nextRoute: CommunityRoute, options?: NavigateOptions) => {
    navigateHashRoute(nextRoute, options)
  }, [])

  return { route, navigate }
}
