import type { CommunityRoute, SearchScope, SearchContentFilters } from "../../router/communityRoute"
import type { NavigateOptions } from "../../router/hashRouter"

type Navigate = (route: CommunityRoute, options?: NavigateOptions) => void

export function useSearchParams(route: CommunityRoute, navigate: Navigate) {
  const query = route.kind === "search" ? route.query : ""
  const scope = route.kind === "search" ? route.scope : "all"
  const filters = route.kind === "search" ? route.filters : undefined
  return {
    filters,
    query,
    scope,
    submit: (nextQuery: string) => navigate({ kind: "search", query: nextQuery.trim(), scope: "all", ...(filters ? {filters} : {}) }),
    setFilters: (filters: SearchContentFilters) => navigate({kind:"search",query,scope, ...(Object.keys(filters).length ? {filters} : {})}),
    setScope: (nextScope: SearchScope) => navigate({ kind: "search", query, scope: nextScope, ...(filters ? {filters} : {}) }),
  }
}
