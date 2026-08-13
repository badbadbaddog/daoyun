const OIDC_SETTINGS_RETURN_KEY = "daoyun-oidc-settings-return"
const OIDC_SETTINGS_RETURN_TTL_MS = 10 * 60 * 1_000
const usernamePattern = /^[a-z][a-z0-9_]{2,31}$/

interface OidcSettingsReturnState {
  username: string
  createdAt: number
}

export function rememberOidcSettingsReturn(username: string, now = Date.now()): void {
  if (!usernamePattern.test(username) || !Number.isFinite(now)) {
    removeReturnState()
    return
  }
  const state: OidcSettingsReturnState = { username, createdAt: now }
  try {
    sessionStorage.setItem(OIDC_SETTINGS_RETURN_KEY, JSON.stringify(state))
  } catch {
    // Storage can be disabled; the authorization flow remains usable without return restoration.
  }
}

export function consumeOidcSettingsReturn(now = Date.now()): string | null {
  let raw: string | null = null
  try {
    raw = sessionStorage.getItem(OIDC_SETTINGS_RETURN_KEY)
    sessionStorage.removeItem(OIDC_SETTINGS_RETURN_KEY)
  } catch {
    return null
  }
  if (!raw || !Number.isFinite(now)) return null
  try {
    const value = JSON.parse(raw) as unknown
    if (!isReturnState(value)) return null
    if (value.createdAt > now || now - value.createdAt > OIDC_SETTINGS_RETURN_TTL_MS) return null
    return value.username
  } catch {
    return null
  }
}

function isReturnState(value: unknown): value is OidcSettingsReturnState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const state = value as Record<string, unknown>
  return typeof state.username === "string"
    && usernamePattern.test(state.username)
    && typeof state.createdAt === "number"
    && Number.isFinite(state.createdAt)
}

function removeReturnState(): void {
  try {
    sessionStorage.removeItem(OIDC_SETTINGS_RETURN_KEY)
  } catch {
    // Ignore unavailable storage.
  }
}
