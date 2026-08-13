const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"])

export const DEFAULT_LOCAL_API_URL = "http://127.0.0.1:3000"
export const DEFAULT_LOCAL_DATABASE_URL = "postgresql://daoyun@127.0.0.1:55433/daoyun_dev"
export const DEFAULT_LOCAL_BIND_ADDRESS = "127.0.0.1:3000"

// These credentials are intentionally limited to the loopback-only development scripts.
export const LOCAL_TEST_ACCOUNTS = Object.freeze([
  Object.freeze({
    username: "demo_admin",
    email: "demo_admin@local.daoyun.test",
    displayName: "本地测试管理员",
    password: "DaoYunLocalOnly!2026",
    role: "super_admin",
  }),
  Object.freeze({
    username: "demo_member",
    email: "demo_member@local.daoyun.test",
    displayName: "本地测试成员",
    password: "DaoYunLocalOnly!2026",
    role: "member",
  }),
])

export function assertLoopbackUrl(value, allowedSchemes, label) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${label} must be an absolute URL.`)
  }

  const scheme = url.protocol.slice(0, -1).toLowerCase()
  if (!allowedSchemes.includes(scheme)) {
    throw new Error(`${label} must use one of: ${allowedSchemes.join(", ")}.`)
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase()
  if (!LOOPBACK_HOSTS.has(hostname)) {
    throw new Error(`${label} must use a loopback host.`)
  }

  return url
}

export function assertLoopbackBindAddress(value) {
  let url
  try {
    url = new URL(`http://${value}`)
  } catch {
    throw new Error("Bind address must be a host and port.")
  }

  if (url.pathname !== "/" || url.search || url.hash || !url.port) {
    throw new Error("Bind address must be a host and port.")
  }

  assertLoopbackUrl(url.href, ["http"], "Bind address")
  return value
}

export function normalizeLocalApiUrl(value) {
  const url = assertLoopbackUrl(value, ["http", "https"], "API URL")
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("API URL must not include a path, query, or fragment.")
  }
  return url.origin
}
