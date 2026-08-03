export type BrandThemePreset = "default" | "dark" | "compact" | "high_contrast"
export type BrandListDensity = "comfortable" | "compact"
export type BrandHomeMode = "latest" | "hot" | "featured"
export type AdminBoardVisibility = "public" | "hidden"
export type BoardTone = "green" | "blue" | "amber" | "rose"

export interface SiteBranding {
  siteName: string
  logoUrl: string | null
  faviconUrl: string | null
  primaryColor: string
  accentColor: string
  themePreset: BrandThemePreset
  listDensity: BrandListDensity
  homeMode: BrandHomeMode
}

export interface SiteBrandingInput extends SiteBranding {}

export interface AdminBoard {
  id: string
  slug: string
  name: string
  description: string
  icon: string
  tone: BoardTone
  position: number
  visibility: AdminBoardVisibility
  topicCount: number
}

export interface AdminBoardInput {
  slug: string
  name: string
  description: string
  icon: string
  tone: BoardTone
  position: number
  visibility: AdminBoardVisibility
}

interface Envelope<T> { data: T; meta: { request_id: string } }
interface ErrorDto { error: { code: string; message: string; fields?: Record<string, string[]> }; meta: { request_id: string } }

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const presets = new Set<BrandThemePreset>(["default", "dark", "compact", "high_contrast"])
const densities = new Set<BrandListDensity>(["comfortable", "compact"])
const homeModes = new Set<BrandHomeMode>(["latest", "hot", "featured"])
const visibilities = new Set<AdminBoardVisibility>(["public", "hidden"])
const tones = new Set<BoardTone>(["green", "blue", "amber", "rose"])

export class AdminApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fields: Record<string, string[]>

  constructor(status: number, code: string, message: string, fields: Record<string, string[]> = {}) {
    super(message)
    this.name = "AdminApiError"
    this.status = status
    this.code = code
    this.fields = fields
  }
}

export async function getAdminSiteBranding(signal?: AbortSignal): Promise<SiteBranding> {
  const response = await fetch("/api/v1/admin/site-branding", { headers: { Accept: "application/json" }, credentials: "include", signal })
  return parseResponse(response, isBranding)
}

export async function updateSiteBranding(input: SiteBrandingInput, csrfToken: string, signal?: AbortSignal): Promise<SiteBranding> {
  const response = await fetch("/api/v1/admin/site-branding", {
    method: "PATCH", headers: { Accept: "application/json", "Content-Type": "application/json", "x-csrf-token": csrfToken },
    credentials: "include", body: JSON.stringify(toBrandingDto(input)), signal,
  })
  return parseResponse(response, isBranding)
}

export async function listAdminBoards(signal?: AbortSignal): Promise<AdminBoard[]> {
  const response = await fetch("/api/v1/admin/boards", { headers: { Accept: "application/json" }, credentials: "include", signal })
  return parseResponse(response, (value): value is AdminBoardDto[] => Array.isArray(value) && value.every(isBoard))
}

export async function createAdminBoard(input: AdminBoardInput, csrfToken: string, signal?: AbortSignal): Promise<AdminBoard> {
  const response = await fetch("/api/v1/admin/boards", {
    method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", "x-csrf-token": csrfToken },
    credentials: "include", body: JSON.stringify(toBoardDto(input)), signal,
  })
  return parseResponse(response, isBoard)
}

export async function updateAdminBoard(boardId: string, input: AdminBoardInput, csrfToken: string, signal?: AbortSignal): Promise<AdminBoard> {
  const response = await fetch(`/api/v1/admin/boards/${boardId}`, {
    method: "PATCH", headers: { Accept: "application/json", "Content-Type": "application/json", "x-csrf-token": csrfToken },
    credentials: "include", body: JSON.stringify(toBoardDto(input)), signal,
  })
  return parseResponse(response, isBoard)
}

export async function deleteAdminBoard(boardId: string, csrfToken: string, signal?: AbortSignal): Promise<boolean> {
  const response = await fetch(`/api/v1/admin/boards/${boardId}`, {
    method: "DELETE", headers: { Accept: "application/json", "x-csrf-token": csrfToken }, credentials: "include", signal,
  })
  return parseResponse(response, (value): value is true => value === true)
}

type BrandingDto = { site_name: string; logo_url: string | null; favicon_url: string | null; primary_color: string; accent_color: string; theme_preset: BrandThemePreset; list_density: BrandListDensity; home_mode: BrandHomeMode }
type AdminBoardDto = { id: string; slug: string; name: string; description: string; icon: string; tone: BoardTone; position: number; visibility: AdminBoardVisibility; topic_count: number }

async function parseResponse<T>(response: Response, guard: (value: unknown) => value is T): Promise<T> {
  const payload = await readJson(response)
  if (!response.ok) throw toApiError(response.status, payload)
  if (!isEnvelope(payload) || !guard(payload.data)) throw new AdminApiError(response.status, "response.invalid", "管理服务响应格式无效")
  return mapValue(payload.data)
}

function mapValue<T>(value: T): T {
  if (isBrandingDto(value)) return { siteName: value.site_name, logoUrl: value.logo_url, faviconUrl: value.favicon_url, primaryColor: value.primary_color, accentColor: value.accent_color, themePreset: value.theme_preset, listDensity: value.list_density, homeMode: value.home_mode } as T
  if (isBoardDto(value)) return { id: value.id, slug: value.slug, name: value.name, description: value.description, icon: value.icon, tone: value.tone, position: value.position, visibility: value.visibility, topicCount: value.topic_count } as T
  if (Array.isArray(value)) return value.map((item) => mapValue(item)) as T
  return value
}

function toBrandingDto(value: SiteBrandingInput): BrandingDto { return { site_name: value.siteName, logo_url: value.logoUrl, favicon_url: value.faviconUrl, primary_color: value.primaryColor, accent_color: value.accentColor, theme_preset: value.themePreset, list_density: value.listDensity, home_mode: value.homeMode } }
function toBoardDto(value: AdminBoardInput) { return { slug: value.slug, name: value.name, description: value.description, icon: value.icon, tone: value.tone, position: value.position, visibility: value.visibility } }

function isEnvelope(value: unknown): value is Envelope<unknown> { return isRecord(value) && "data" in value && isRecord(value.meta) && isUuid(value.meta.request_id) }
function isBranding(value: unknown): value is SiteBranding { return isBrandingDto(value) }
function isBrandingDto(value: unknown): value is BrandingDto { return isRecord(value) && typeof value.site_name === "string" && (value.logo_url === null || typeof value.logo_url === "string") && (value.favicon_url === null || typeof value.favicon_url === "string") && typeof value.primary_color === "string" && typeof value.accent_color === "string" && typeof value.theme_preset === "string" && presets.has(value.theme_preset as BrandThemePreset) && typeof value.list_density === "string" && densities.has(value.list_density as BrandListDensity) && typeof value.home_mode === "string" && homeModes.has(value.home_mode as BrandHomeMode) }
function isBoard(value: unknown): value is AdminBoardDto { return isBoardDto(value) }
function isBoardDto(value: unknown): value is AdminBoardDto { return isRecord(value) && isUuid(value.id) && typeof value.slug === "string" && typeof value.name === "string" && typeof value.description === "string" && typeof value.icon === "string" && typeof value.tone === "string" && tones.has(value.tone as BoardTone) && Number.isSafeInteger(value.position) && value.position >= 0 && typeof value.visibility === "string" && visibilities.has(value.visibility as AdminBoardVisibility) && Number.isSafeInteger(value.topic_count) && value.topic_count >= 0 }
function isRecord(value: unknown): value is Record<string, any> { return typeof value === "object" && value !== null && !Array.isArray(value) }
function isUuid(value: unknown): value is string { return typeof value === "string" && uuidPattern.test(value) }
function isError(value: unknown): value is ErrorDto { return isRecord(value) && isRecord(value.error) && isRecord(value.meta) && isUuid(value.meta.request_id) && typeof value.error.code === "string" && typeof value.error.message === "string" && (value.error.fields === undefined || isRecord(value.error.fields)) }
function toApiError(status: number, payload: unknown): AdminApiError { return isError(payload) ? new AdminApiError(status, payload.error.code, payload.error.message, payload.error.fields ?? {}) : new AdminApiError(status, "response.invalid", "管理服务响应格式无效") }
async function readJson(response: Response): Promise<unknown> { try { return await response.json() as unknown } catch { return undefined } }
