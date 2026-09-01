import { useEffect, useRef } from "react"

import type { CommunityRoute } from "../../router/communityRoute"

const STORAGE_PREFIX = "daoyun:feed-scroll:"

export function useFeedScrollRestoration(route: CommunityRoute, ready = true) {
  const activeKey = route.kind === "feed" ? `${STORAGE_PREFIX}${route.feed}` : null
  const previousKeyRef = useRef<string | null>(null)
  const restoredKeyRef = useRef<string | null>(null)

  useEffect(() => {
    const previousKey = previousKeyRef.current
    if (previousKey && previousKey !== activeKey) {
      sessionStorage.setItem(previousKey, String(Math.max(0, window.scrollY)))
    }
    if (previousKey !== activeKey) restoredKeyRef.current = null
    previousKeyRef.current = activeKey
  }, [activeKey])

  useEffect(() => {
    if (activeKey && ready && restoredKeyRef.current !== activeKey) {
      restoredKeyRef.current = activeKey
      const savedPosition = Number(sessionStorage.getItem(activeKey))
      if (Number.isFinite(savedPosition) && savedPosition > 0) {
        window.scrollTo({ top: savedPosition, behavior: "auto" })
      }
    }
  }, [activeKey, ready])

  useEffect(() => {
    return () => {
      const currentKey = previousKeyRef.current
      if (currentKey) sessionStorage.setItem(currentKey, String(Math.max(0, window.scrollY)))
    }
  }, [])
}
