import type { components } from "./generated"

export type PluginCapability = "content.transform" | "ui.panel"
export type PluginStatus = "disabled" | "enabled"
export type PluginOperation = "content_transform" | "ui_render"
export type PluginUiTone = "neutral" | "success" | "warning" | "danger"

export type PluginUiBlock =
  | { kind: "text"; text: string }
  | { kind: "metric"; label: string; value: string }
  | { kind: "status"; tone: PluginUiTone; text: string }

export interface PluginUiSchema {
  schemaVersion: 1
  title: string
  blocks: PluginUiBlock[]
}

export interface Plugin {
  id: string
  key: string
  name: string
  version: string
  description: string
  capabilities: PluginCapability[]
  componentSha256: string
  componentSize: number
  status: PluginStatus
  revision: number
  installedBy: string
  createdAt: string
  updatedAt: string
}

export interface PluginManifestInput {
  schemaVersion: 1
  key: string
  name: string
  version: string
  description: string
  capabilities: PluginCapability[]
}

export interface InstallPluginInput {
  manifest: PluginManifestInput
  componentBase64: string
}

export interface PluginInvocation {
  operation: PluginOperation
  payload: string
  uiSchema: PluginUiSchema | null
}

export class PluginApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId: string | null = null,
    public readonly fields: Record<string, string[]> = {},
  ) {
    super(message)
    this.name = "PluginApiError"
  }
}

export async function listPlugins(signal?: AbortSignal): Promise<Plugin[]> {
  const response = await fetch("/api/v1/admin/plugins", {
    headers: { Accept: "application/json" },
    credentials: "include",
    signal,
  })
  return parseData(response, isPluginDtoList, (items) => items.map(mapPlugin))
}

export async function installPlugin(input: InstallPluginInput, csrfToken: string, signal?: AbortSignal): Promise<Plugin> {
  const response = await fetch("/api/v1/admin/plugins", {
    method: "POST",
    headers: jsonHeaders(csrfToken),
    credentials: "include",
    body: JSON.stringify({
      manifest: {
        schema_version: input.manifest.schemaVersion,
        key: input.manifest.key,
        name: input.manifest.name,
        version: input.manifest.version,
        description: input.manifest.description,
        capabilities: input.manifest.capabilities,
      },
      component_base64: input.componentBase64,
    }),
    signal,
  })
  return parseData(response, isPluginDto, mapPlugin)
}

export async function updatePluginStatus(
  pluginId: string,
  status: PluginStatus,
  expectedRevision: number,
  csrfToken: string,
  signal?: AbortSignal,
): Promise<Plugin> {
  const response = await fetch(`/api/v1/admin/plugins/${encodeURIComponent(pluginId)}`, {
    method: "PATCH",
    headers: jsonHeaders(csrfToken),
    credentials: "include",
    body: JSON.stringify({ status, expected_revision: expectedRevision }),
    signal,
  })
  return parseData(response, isPluginDto, mapPlugin)
}

export async function deletePlugin(pluginId: string, csrfToken: string, signal?: AbortSignal): Promise<boolean> {
  const response = await fetch(`/api/v1/admin/plugins/${encodeURIComponent(pluginId)}`, {
    method: "DELETE",
    headers: jsonHeaders(csrfToken),
    credentials: "include",
    signal,
  })
  return parseData(response, (value): value is boolean => value === true, (value) => value)
}

export async function invokePlugin(
  pluginId: string,
  operation: PluginOperation,
  payload: string,
  csrfToken: string,
  signal?: AbortSignal,
): Promise<PluginInvocation> {
  const response = await fetch(`/api/v1/admin/plugins/${encodeURIComponent(pluginId)}/invoke`, {
    method: "POST",
    headers: jsonHeaders(csrfToken),
    credentials: "include",
    body: JSON.stringify({ operation, payload }),
    signal,
  })
  const invocation = await parseData(response, isPluginInvocationDto, mapInvocation)
  if (invocation.operation !== operation) {
    throw invalidResponse(response.status)
  }
  return invocation
}

export function isPluginUiSchema(value: unknown): value is PluginUiSchema {
  if (!isRecord(value) || !hasExactKeys(value, ["schemaVersion", "title", "blocks"])) return false
  return value.schemaVersion === 1
    && isBoundedText(value.title, 1, 80)
    && Array.isArray(value.blocks)
    && value.blocks.length >= 1
    && value.blocks.length <= 32
    && value.blocks.every(isPluginUiBlock)
}

type PluginDto = components["schemas"]["Plugin"]
type PluginUiSchemaDto = components["schemas"]["PluginUiSchema"]
type PluginInvocationDto = components["schemas"]["PluginInvocation"]

async function parseData<T, R>(
  response: Response,
  validate: (value: unknown) => value is T,
  map: (value: T) => R,
): Promise<R> {
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) throw parseError(response.status, payload)
  if (!isRecord(payload)
    || !hasExactKeys(payload, ["data", "meta"])
    || !isRecord(payload.meta)
    || !hasExactKeys(payload.meta, ["request_id"])
    || !isUuid(payload.meta.request_id)
    || !validate(payload.data)) {
    throw invalidResponse(response.status)
  }
  return map(payload.data)
}

function parseError(status: number, payload: unknown): PluginApiError {
  if (!isRecord(payload) || !isRecord(payload.error) || !isRecord(payload.meta)) {
    return new PluginApiError(status, "response.invalid", "插件服务响应格式无效")
  }
  const code = typeof payload.error.code === "string" ? payload.error.code : "response.invalid"
  const message = typeof payload.error.message === "string" ? payload.error.message : "插件请求失败"
  const requestId = isUuid(payload.meta.request_id) ? payload.meta.request_id : null
  const fields = isFieldErrors(payload.error.fields) ? payload.error.fields : {}
  return new PluginApiError(status, code, message, requestId, fields)
}

function invalidResponse(status: number): PluginApiError {
  return new PluginApiError(status, "response.invalid", "插件服务响应格式无效")
}

function jsonHeaders(csrfToken: string): Record<string, string> {
  return { Accept: "application/json", "Content-Type": "application/json", "x-csrf-token": csrfToken }
}

function mapPlugin(value: PluginDto): Plugin {
  return {
    id: value.id,
    key: value.key,
    name: value.name,
    version: value.version,
    description: value.description,
    capabilities: value.capabilities,
    componentSha256: value.component_sha256,
    componentSize: value.component_size,
    status: value.status,
    revision: value.revision,
    installedBy: value.installed_by,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
  }
}

function mapInvocation(value: PluginInvocationDto): PluginInvocation {
  return {
    operation: value.operation,
    payload: value.payload,
    uiSchema: value.ui_schema ? mapUiSchema(value.ui_schema) : null,
  }
}

function mapUiSchema(value: PluginUiSchemaDto): PluginUiSchema {
  return { schemaVersion: 1, title: value.title, blocks: value.blocks }
}

function isPluginDtoList(value: unknown): value is PluginDto[] {
  return Array.isArray(value) && value.every(isPluginDto)
}

function isPluginDto(value: unknown): value is PluginDto {
  if (!isRecord(value) || !hasExactKeys(value, [
    "id", "key", "name", "version", "description", "capabilities", "component_sha256",
    "component_size", "status", "revision", "installed_by", "created_at", "updated_at",
  ])) return false
  return isUuid(value.id)
    && typeof value.key === "string"
    && /^[a-z][a-z0-9_]{2,63}$/.test(value.key)
    && isBoundedText(value.name, 1, 80)
    && typeof value.version === "string"
    && /^(0|[1-9][0-9]{0,9})\.(0|[1-9][0-9]{0,9})\.(0|[1-9][0-9]{0,9})$/.test(value.version)
    && isBoundedText(value.description, 0, 500)
    && Array.isArray(value.capabilities)
    && value.capabilities.length >= 1
    && value.capabilities.every(isPluginCapability)
    && new Set(value.capabilities).size === value.capabilities.length
    && typeof value.component_sha256 === "string"
    && /^[0-9a-f]{64}$/.test(value.component_sha256)
    && isSafeCount(value.component_size)
    && value.component_size >= 1
    && value.component_size <= 8 * 1024 * 1024
    && isPluginStatus(value.status)
    && isPositiveCount(value.revision)
    && isUuid(value.installed_by)
    && isTimestamp(value.created_at)
    && isTimestamp(value.updated_at)
}

function isPluginInvocationDto(value: unknown): value is PluginInvocationDto {
  if (!isRecord(value) || !hasOnlyKeys(value, ["operation", "payload", "ui_schema"])) return false
  if (!isPluginOperation(value.operation) || typeof value.payload !== "string") return false
  if (value.operation === "content_transform") return value.ui_schema === undefined
  return isPluginUiSchemaDto(value.ui_schema)
}

function isPluginUiSchemaDto(value: unknown): value is PluginUiSchemaDto {
  if (!isRecord(value) || !hasExactKeys(value, ["schema_version", "title", "blocks"])) return false
  return value.schema_version === 1
    && isBoundedText(value.title, 1, 80)
    && Array.isArray(value.blocks)
    && value.blocks.length >= 1
    && value.blocks.length <= 32
    && value.blocks.every(isPluginUiBlock)
}

function isPluginUiBlock(value: unknown): value is PluginUiBlock {
  if (!isRecord(value) || typeof value.kind !== "string") return false
  if (value.kind === "text") {
    return hasExactKeys(value, ["kind", "text"]) && isBoundedText(value.text, 1, 2_000)
  }
  if (value.kind === "metric") {
    return hasExactKeys(value, ["kind", "label", "value"])
      && isBoundedText(value.label, 1, 80)
      && isBoundedText(value.value, 1, 200)
  }
  if (value.kind === "status") {
    return hasExactKeys(value, ["kind", "tone", "text"])
      && isPluginUiTone(value.tone)
      && isBoundedText(value.text, 1, 200)
  }
  return false
}

function isPluginCapability(value: unknown): value is PluginCapability {
  return value === "content.transform" || value === "ui.panel"
}

function isPluginStatus(value: unknown): value is PluginStatus {
  return value === "disabled" || value === "enabled"
}

function isPluginOperation(value: unknown): value is PluginOperation {
  return value === "content_transform" || value === "ui_render"
}

function isPluginUiTone(value: unknown): value is PluginUiTone {
  return value === "neutral" || value === "success" || value === "warning" || value === "danger"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
}

function isBoundedText(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === "string"
    && [...value].length >= minimum
    && [...value].length <= maximum
    && !/[\u0000-\u001f\u007f]/u.test(value)
}

function isSafeCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function isPositiveCount(value: unknown): value is number {
  return isSafeCount(value) && value >= 1
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
}

function isFieldErrors(value: unknown): value is Record<string, string[]> {
  return isRecord(value) && Object.values(value).every((messages) => Array.isArray(messages) && messages.every((message) => typeof message === "string"))
}
