import { useEffect, useState } from "react"

import { listUserMembershipSummary, type PublicMembershipSummary } from "../../api/membership"

interface CacheEntry {
  value: PublicMembershipSummary
  expiresAt: number
}

const CACHE_TTL_MS = 60_000
const cache = new Map<string, CacheEntry>()
const pending = new Map<string, Promise<PublicMembershipSummary>>()

export function usePublicMembershipSummary(username: string): PublicMembershipSummary | null {
  const [summary, setSummary] = useState<PublicMembershipSummary | null>(() => cachedSummary(username))

  useEffect(() => {
    let active = true
    const cached = cachedSummary(username)
    if (cached) {
      setSummary(cached)
      return () => { active = false }
    }

    setSummary(null)
    loadSummary(username).then((value) => {
      if (active) setSummary(value)
    }).catch(() => {
      if (active) setSummary(null)
    })

    return () => { active = false }
  }, [username])

  return summary
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
