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
      saveScrollPosition(previousKey)
      if (!activeKey && window.scrollY > 0) window.scrollTo({ top: 0, behavior: "auto" })
    }
    if (previousKey !== activeKey) restoredKeyRef.current = null
    previousKeyRef.current = activeKey
  }, [activeKey])

  useEffect(() => {
    if (activeKey && ready && restoredKeyRef.current !== activeKey) {
      restoredKeyRef.current = activeKey
      let storedPosition: string | null = null
      try { storedPosition = sessionStorage.getItem(activeKey) } catch { /* Browsing remains available without saved positions. */ }
      const savedPosition = storedPosition === null ? 0 : Number(storedPosition)
      const targetPosition = Number.isFinite(savedPosition) && savedPosition >= 0 ? savedPosition : 0
      if (window.scrollY !== targetPosition) window.scrollTo({ top: targetPosition, behavior: "auto" })
    }
  }, [activeKey, ready])

  useEffect(() => {
    return () => {
      const currentKey = previousKeyRef.current
      if (currentKey) saveScrollPosition(currentKey)
    }
  }, [])
}

function saveScrollPosition(key: string) {
  try { sessionStorage.setItem(key, String(Math.max(0, window.scrollY))) } catch { /* Scroll persistence is optional. */ }
}
