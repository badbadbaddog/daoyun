const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function adminObjectId(query: string, key: string): string | null {
  const value = new URLSearchParams(query).get(key)
  return value && uuidPattern.test(value) ? value : null
}

export function adminScroll(value: string | null): number | null {
  return value !== null && /^\d{1,7}$/.test(value) && Number(value) <= 1_000_000 ? Number(value) : null
}

export function adminObjectQuery(query: string, key: string, id: string | null): string {
  const params = new URLSearchParams(query)
  if (id) {
    params.set(key, id)
    if (!params.has("list_scroll") && window.scrollY > 0) params.set("list_scroll", String(Math.round(window.scrollY)))
  } else {
    params.delete(key)
    params.delete("list_scroll")
  }
  return params.toString()
}

export function restoreAdminScroll(query: string, key = "list_scroll") {
  const top = adminScroll(new URLSearchParams(query).get(key))
  if (top !== null) requestAnimationFrame(() => window.scrollTo({ top, behavior: "instant" }))
}
