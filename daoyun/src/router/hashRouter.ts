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
  return parseHash(window.location.hash || publicHash())
}

export function navigate(route: CommunityRoute, options: NavigateOptions = {}): void {
  const url = routeUrl(route)
  if (`${window.location.pathname}${window.location.search}${window.location.hash}` === url) return
  window.history[options.replace ? "replaceState" : "pushState"](window.history.state, "", url)
  window.dispatchEvent(new HashChangeEvent("hashchange"))
}

export function subscribeHashRoute(listener: (route: CommunityRoute) => void): () => void {
  const handleHashChange = () => listener(currentRoute())
  window.addEventListener("hashchange", handleHashChange)
  window.addEventListener("popstate", handleHashChange)
  return () => {
    window.removeEventListener("hashchange", handleHashChange)
    window.removeEventListener("popstate", handleHashChange)
  }
}

export function normalizeLegacyHash(): boolean {
  if (!window.location.hash && publicHash()) return false
  const route = currentRoute()
  if (route.kind === "topic" || route.kind === "board" || route.kind === "user") {
    const url = routeUrl(route)
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` === url) return false
    window.history.replaceState(window.history.state, "", url)
    return true
  }
  if (window.location.hash && publicHash()) {
    window.history.replaceState(window.history.state, "", `/${window.location.hash}`)
    return true
  }
  const canonical = canonicalHashForLegacy(window.location.hash)
  if (!canonical || canonical === window.location.hash) return false
  replaceHash(canonical)
  return true
}

function replaceHash(hash: string): void {
  const url = `${window.location.pathname}${window.location.search}${hash}`
  window.history.replaceState(window.history.state, "", url)
}

function publicHash(): string {
  const match = window.location.pathname.match(/^\/(t|b|u)\/([^/]+)$/)
  if (!match) return ""
  const kind = { t: "topic", b: "board", u: "user" }[match[1]]
  return `#${kind}/${match[2]}${window.location.search}`
}

function routeUrl(route: CommunityRoute): string {
  const hash = formatRoute(route)
  if (route.kind === "topic" && hash.startsWith("#topic/")) return hash.replace("#topic/", "/t/")
  if (route.kind === "board" && hash.startsWith("#board/")) return hash.replace("#board/", "/b/")
  if (route.kind === "user" && hash.startsWith("#user/")) return hash.replace("#user/", "/u/")
  return `/${hash}`
}
