import {
  canonicalHashForLegacy,
  formatRoute,
  parseHash,
  type CommunityRoute,
} from "./communityRoute"

export interface NavigateOptions {
  replace?: boolean
}

export function currentRoute(): CommunityRoute {
  return parseHash(window.location.hash)
}

export function navigate(route: CommunityRoute, options: NavigateOptions = {}): void {
  const nextHash = formatRoute(route)
  if (window.location.hash === nextHash) return

  if (options.replace) {
    replaceHash(nextHash)
    window.dispatchEvent(new HashChangeEvent("hashchange"))
    return
  }

  window.location.hash = nextHash.slice(1)
}

export function subscribeHashRoute(listener: (route: CommunityRoute) => void): () => void {
  const handleHashChange = () => listener(currentRoute())
  window.addEventListener("hashchange", handleHashChange)
  return () => window.removeEventListener("hashchange", handleHashChange)
}

export function normalizeLegacyHash(): boolean {
  const canonical = canonicalHashForLegacy(window.location.hash)
  if (!canonical || canonical === window.location.hash) return false
  replaceHash(canonical)
  return true
}

function replaceHash(hash: string): void {
  const url = `${window.location.pathname}${window.location.search}${hash}`
  window.history.replaceState(window.history.state, "", url)
}
