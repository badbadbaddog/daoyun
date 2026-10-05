import { useEffect, useState } from "react"

import { listUserMembershipSummary, type PublicMembershipSummary } from "../../api/membership"

interface CacheEntry {
  value: PublicMembershipSummary
  expiresAt: number
}
interface SummaryState {
  username: string
  summary: PublicMembershipSummary | null
  status: "loading" | "ready" | "error"
}

const CACHE_TTL_MS = 60_000
const cache = new Map<string, CacheEntry>()
const pending = new Map<string, Promise<PublicMembershipSummary>>()

export function usePublicMembershipSummary(username: string) {
  const [state, setState] = useState<SummaryState>(() => {
    const summary = cachedSummary(username)
    return { username, summary, status: summary ? "ready" : "loading" }
  })
  const [requestVersion, setRequestVersion] = useState(0)

  useEffect(() => {
    let active = true
    const summary = cachedSummary(username)
    setState({ username, summary, status: summary ? "ready" : "loading" })
    if (!summary) {
      loadSummary(username).then(value => {
        if (active) setState({ username, summary: value, status: "ready" })
      }).catch(() => {
        if (active) setState({ username, summary: null, status: "error" })
      })
    }
    return () => { active = false }
  }, [username, requestVersion])

  const current = state.username === username ? state : { summary: null, status: "loading" as const }
  return { summary: current.summary, status: current.status, retry: () => setRequestVersion(value => value + 1) }
}

function cachedSummary(username: string): PublicMembershipSummary | null {
  const entry = cache.get(username)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    cache.delete(username)
    return null
  }
  return entry.value
}

function loadSummary(username: string): Promise<PublicMembershipSummary> {
  const existing = pending.get(username)
  if (existing) return existing

  const request = listUserMembershipSummary(username).then((value) => {
    cache.set(username, { value, expiresAt: Date.now() + CACHE_TTL_MS })
    return value
  }).finally(() => {
    pending.delete(username)
  })
  pending.set(username, request)
  return request
}
