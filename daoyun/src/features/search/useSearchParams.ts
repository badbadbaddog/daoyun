import type { CommunityRoute, SearchScope } from "../../router/communityRoute"
import type { NavigateOptions } from "../../router/hashRouter"

type Navigate = (route: CommunityRoute, options?: NavigateOptions) => void

export function useSearchParams(route: CommunityRoute, navigate: Navigate) {
  const query = route.kind === "search" ? route.query : ""
  const scope = route.kind === "search" ? route.scope : "all"
  return {
    query,
    scope,
    submit: (nextQuery: string) => navigate({ kind: "search", query: nextQuery.trim(), scope: "all" }),
    setScope: (nextScope: SearchScope) => navigate({ kind: "search", query, scope: nextScope }),
  }
}
