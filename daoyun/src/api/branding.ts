import type {
  BrandHomeMode,
  BrandListDensity,
  BrandThemePreset,
  SiteBranding,
} from "./admin"
import type { components } from "./generated"

type Envelope<T> = {
  data: T
  meta: components["schemas"]["ResponseMeta"]
}

type BrandingDto = Required<components["schemas"]["SiteBranding"]>
type ErrorDto = components["schemas"]["ErrorResponse"]

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const colorPattern = /^#[0-9a-f]{6}$/i
const presets = new Set<BrandThemePreset>(["default", "dark", "compact", "high_contrast"])
const densities = new Set<BrandListDensity>(["comfortable", "compact"])
const homeModes = new Set<BrandHomeMode>(["latest", "hot", "featured"])

export class BrandingApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = "BrandingApiError"
    this.status = status
    this.code = code
  }
}

export async function getPublicSiteBranding(signal?: AbortSignal): Promise<SiteBranding> {
  const response = await fetch("/api/v1/site-branding", {
    headers: { Accept: "application/json" },
    signal,
  })
  const payload = await readJson(response)

  if (!response.ok) {
    throw toApiError(response.status, payload)
  }
  if (!isEnvelope(payload) || !isBrandingDto(payload.data)) {
    throw new BrandingApiError(response.status, "response.invalid", "品牌配置响应格式无效")
  }
  return mapBranding(payload.data)
}

function mapBranding(value: BrandingDto): SiteBranding {
  return {
    siteName: value.site_name,
    logoUrl: value.logo_url,
    faviconUrl: value.favicon_url,
    defaultCoverUrl: value.default_cover_url,
    navigationLinks: value.navigation_links,
    footerText: value.footer_text,
    footerLinks: value.footer_links,
    primaryColor: value.primary_color,
    accentColor: value.accent_color,
    themePreset: value.theme_preset,
    listDensity: value.list_density,
    homeMode: value.home_mode,
  }
}

function isEnvelope(value: unknown): value is Envelope<unknown> {
  return isRecord(value) && "data" in value && isRecord(value.meta) && isUuid(value.meta.request_id)
}

function isBrandingDto(value: unknown): value is BrandingDto {
  return isRecord(value)
    && typeof value.site_name === "string"
    && value.site_name.trim().length > 0
    && value.site_name.length <= 80
    && isOptionalBrandAssetUrl(value.logo_url, "logo")
    && isOptionalBrandAssetUrl(value.favicon_url, "favicon")
    && isOptionalHttpsUrl(value.default_cover_url)
    && isBrandLinks(value.navigation_links)
    && (value.footer_text === null || (typeof value.footer_text === "string" && value.footer_text.length <= 200))
    && isBrandLinks(value.footer_links)
    && typeof value.primary_color === "string"
    && colorPattern.test(value.primary_color)
    && typeof value.accent_color === "string"
    && colorPattern.test(value.accent_color)
    && typeof value.theme_preset === "string"
    && presets.has(value.theme_preset as BrandThemePreset)
    && typeof value.list_density === "string"
    && densities.has(value.list_density as BrandListDensity)
    && typeof value.home_mode === "string"
    && homeModes.has(value.home_mode as BrandHomeMode)
}

function isOptionalHttpsUrl(value: unknown): value is string | null {
  if (value === null) return true
  if (typeof value !== "string") return false
  try {
    return new URL(value).protocol === "https:"
  } catch {
    return false
  }
}

function isOptionalBrandAssetUrl(value: unknown, kind: "logo" | "favicon"): value is string | null {
  return value === `/api/v1/site-branding/assets/${kind}` || isOptionalHttpsUrl(value)
}

function isBrandLinks(value: unknown): value is SiteBranding["navigationLinks"] {
  return Array.isArray(value)
    && value.length <= 8
    && value.every((link) => isRecord(link)
      && typeof link.label === "string"
      && link.label.trim().length > 0
      && link.label.length <= 40
      && typeof link.url === "string"
      && isSafeBrandLinkUrl(link.url))
}

function isSafeBrandLinkUrl(value: string): boolean {
  if (value.startsWith("https://")) return isOptionalHttpsUrl(value)
  return (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) || value.startsWith("#")
}

function isError(value: unknown): value is ErrorDto {
  return isRecord(value)
    && isRecord(value.error)
    && isRecord(value.meta)
    && isUuid(value.meta.request_id)
    && typeof value.error.code === "string"
    && typeof value.error.message === "string"
}

function toApiError(status: number, payload: unknown): BrandingApiError {
  return isError(payload)
    ? new BrandingApiError(status, payload.error.code, payload.error.message)
    : new BrandingApiError(status, "response.invalid", "品牌配置响应格式无效")
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value)
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown
  } catch {
    return undefined
  }
}
