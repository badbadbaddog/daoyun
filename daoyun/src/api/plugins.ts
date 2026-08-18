import type { components } from "./generated"

export type PluginCapability =
  | "content.transform"
  | "ui.panel"
  | "events.subscribe"
  | "core.query"
  | "points.write"
  | "experience.write"
  | "entitlements.write"
  | "notifications.write"
  | "storage.read_write"
  | "tasks.schedule"
export type PluginDataScope =
  | "site.read"
  | "actor.read"
  | "users.read.basic"
  | "users.read.membership"
  | "users.targeted"
  | "boards.read"
export type PluginEventSubscription =
  | "user.created"
  | "topic.published"
  | "reply.created"
  | "points.changed"
  | "experience.changed"
  | "entitlement.changed"
export type PluginStatus = "disabled" | "enabled"
export type PluginOperation = "content_transform" | "ui_render"
export type PluginUiTone = "neutral" | "success" | "warning" | "danger"
export type PluginBusinessCapability = Exclude<PluginCapability, "content.transform" | "ui.panel">
export type PluginBusinessManifestCapabilities =
  | [PluginBusinessCapability, ...Exclude<PluginCapability, "content.transform">[]]
  | ["ui.panel", PluginBusinessCapability, ...Exclude<PluginCapability, "content.transform">[]]

export type PluginUiBlock =
  | { kind: "text"; text: string }
  | { kind: "metric"; label: string; value: string }
  | { kind: "status"; tone: PluginUiTone; text: string }
  | { kind: "action"; label: string; action_key: string }

export interface PluginUiSchema {
  schemaVersion: 1
  title: string
  blocks: PluginUiBlock[]
}

export type PluginUiSlot = "user_profile" | "membership_panel" | "admin_user" | "admin_plugin"

export interface PluginUiContribution {
  slot: PluginUiSlot
  schema: PluginUiSchema
}

export interface PluginUiSurfaceContribution extends PluginUiContribution {
  pluginId: string
  pluginKey: string
}

export interface PluginUiActionResult {
  executedCommands: number
}

export interface Plugin {
  id: string
  key: string
  name: string
  version: string
  description: string
  manifestSchemaVersion: 1
  businessApiVersion: "0.1.0" | null
  capabilities: PluginCapability[]
  dataScopes: PluginDataScope[]
  eventSubscriptions: PluginEventSubscription[]
  componentSha256: string
  componentSize: number
  status: PluginStatus
  revision: number
  installedBy: string
  createdAt: string
  updatedAt: string
}

interface PluginManifestBase {
  schemaVersion: 1
  key: string
  name: string
  version: string
  description: string
}

export interface LegacyPluginManifestInput extends PluginManifestBase {
  capabilities: ("content.transform" | "ui.panel")[]
  businessApiVersion?: never
  dataScopes?: never
  eventSubscriptions?: never
}

export interface BusinessPluginManifestInput extends PluginManifestBase {
  capabilities: PluginBusinessManifestCapabilities
  businessApiVersion: "0.1.0"
  dataScopes: PluginDataScope[]
  eventSubscriptions: PluginEventSubscription[]
}

export type PluginManifestInput = LegacyPluginManifestInput | BusinessPluginManifestInput

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
  const manifest = {
    schema_version: input.manifest.schemaVersion,
    key: input.manifest.key,
    name: input.manifest.name,
    version: input.manifest.version,
    description: input.manifest.description,
    capabilities: input.manifest.capabilities,
    ...(input.manifest.businessApiVersion === "0.1.0" ? {
      business_api_version: input.manifest.businessApiVersion,
      data_scopes: input.manifest.dataScopes,
      event_subscriptions: input.manifest.eventSubscriptions,
    } : {}),
  }
  const response = await fetch("/api/v1/admin/plugins", {
    method: "POST",
    headers: jsonHeaders(csrfToken),
    credentials: "include",
    body: JSON.stringify({
      manifest,
      component_base64: input.componentBase64,
    }),
    signal,
  })
  return parseData(response, isPluginDto, mapPlugin)
}

export async function listPluginUiContributions(
  pluginId: string,
  signal?: AbortSignal,
): Promise<PluginUiContribution[]> {
  const response = await fetch(
    `/api/v1/admin/plugins/${encodeURIComponent(pluginId)}/ui-contributions`,
    { headers: { Accept: "application/json" }, credentials: "include", signal },
  )
  return parseData(response, isPluginUiContributionDtoList, (items) => items.map((item) => ({
    slot: item.slot,
    schema: mapUiSchema(item.schema),
  })))
}

export async function executePluginUiAction(
  pluginId: string,
  actionKey: string,
  idempotencyKey: string,
  csrfToken: string,
  signal?: AbortSignal,
): Promise<PluginUiActionResult> {
  const response = await fetch(`/api/v1/admin/plugins/${encodeURIComponent(pluginId)}/ui-actions`, {
    method: "POST",
    headers: jsonHeaders(csrfToken),
    credentials: "include",
    body: JSON.stringify({
      slot: "admin_plugin",
      action_key: actionKey,
      idempotency_key: idempotencyKey,
      subject_id: null,
    }),
    signal,
  })
  return parseData(response, isPluginUiActionResultDto, (value) => ({
    executedCommands: value.executed_commands,
  }))
}

export async function listPluginUiSurfaceContributions(
  slot: Exclude<PluginUiSlot, "admin_plugin">,
  subjectId: string,
  signal?: AbortSignal,
): Promise<PluginUiSurfaceContribution[]> {
  const response = await fetch(
    `/api/v1/plugin-ui/${slot}/${encodeURIComponent(subjectId)}`,
    { headers: { Accept: "application/json" }, credentials: "include", signal },
  )
  return parseData(response, isPluginUiSurfaceContributionDtoList, (items) => items.map((item) => ({
    pluginId: item.plugin_id,
    pluginKey: item.plugin_key,
    slot: item.slot,
    schema: mapUiSchema(item.schema),
  })))
}

export async function executePluginUiSurfaceAction(
  pluginId: string,
  slot: Exclude<PluginUiSlot, "admin_plugin">,
  subjectId: string,
  actionKey: string,
  idempotencyKey: string,
  csrfToken: string,
  signal?: AbortSignal,
): Promise<PluginUiActionResult> {
  const response = await fetch(
    `/api/v1/plugin-ui/${slot}/${encodeURIComponent(subjectId)}/${encodeURIComponent(pluginId)}/actions`,
    {
      method: "POST",
      headers: jsonHeaders(csrfToken),
      credentials: "include",
      body: JSON.stringify({
        slot,
        action_key: actionKey,
        idempotency_key: idempotencyKey,
        subject_id: subjectId,
      }),
      signal,
    },
  )
  return parseData(response, isPluginUiActionResultDto, (value) => ({
    executedCommands: value.executed_commands,
  }))
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
type PluginUiContributionDto = {
  slot: PluginUiSlot
  schema: PluginUiSchemaDto
}
type PluginUiActionResultDto = { executed_commands: number }
type PluginUiSurfaceContributionDto = {
  plugin_id: string
  plugin_key: string
  slot: Exclude<PluginUiSlot, "admin_plugin">
  schema: PluginUiSchemaDto
}

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
    manifestSchemaVersion: 1,
    businessApiVersion: value.business_api_version === "0.1.0" ? "0.1.0" : null,
    capabilities: value.capabilities,
    dataScopes: value.data_scopes,
    eventSubscriptions: value.event_subscriptions,
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
    "id", "key", "name", "version", "description", "manifest_schema_version",
    "business_api_version", "capabilities", "data_scopes", "event_subscriptions", "component_sha256",
    "component_size", "status", "revision", "installed_by", "created_at", "updated_at",
  ])) return false
  return isUuid(value.id)
    && typeof value.key === "string"
    && /^[a-z][a-z0-9_]{2,63}$/.test(value.key)
    && isBoundedText(value.name, 1, 80)
    && typeof value.version === "string"
    && /^(0|[1-9][0-9]{0,9})\.(0|[1-9][0-9]{0,9})\.(0|[1-9][0-9]{0,9})$/.test(value.version)
    && isBoundedText(value.description, 0, 500)
    && value.manifest_schema_version === 1
    && (value.business_api_version === null || value.business_api_version === "0.1.0")
    && Array.isArray(value.capabilities)
    && value.capabilities.length >= 1
    && value.capabilities.length <= 16
    && value.capabilities.every(isPluginCapability)
    && new Set(value.capabilities).size === value.capabilities.length
    && Array.isArray(value.data_scopes)
    && value.data_scopes.length <= 8
    && value.data_scopes.every(isPluginDataScope)
    && new Set(value.data_scopes).size === value.data_scopes.length
    && Array.isArray(value.event_subscriptions)
    && value.event_subscriptions.length <= 6
    && value.event_subscriptions.every(isPluginEventSubscription)
    && new Set(value.event_subscriptions).size === value.event_subscriptions.length
    && validBusinessContract(value.business_api_version, value.capabilities, value.data_scopes, value.event_subscriptions)
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

function isPluginUiContributionDtoList(value: unknown): value is PluginUiContributionDto[] {
  return Array.isArray(value) && value.every((item) => isRecord(item)
    && hasExactKeys(item, ["slot", "schema"])
    && ["user_profile", "membership_panel", "admin_user", "admin_plugin"].includes(String(item.slot))
    && isPluginUiSchemaDto(item.schema))
}

function isPluginUiSurfaceContributionDtoList(value: unknown): value is PluginUiSurfaceContributionDto[] {
  return Array.isArray(value) && value.every((item) => isRecord(item)
    && hasExactKeys(item, ["plugin_id", "plugin_key", "slot", "schema"])
    && isUuid(item.plugin_id)
    && typeof item.plugin_key === "string"
    && /^[a-z][a-z0-9_]{2,63}$/u.test(item.plugin_key)
    && ["user_profile", "membership_panel", "admin_user"].includes(String(item.slot))
    && isPluginUiSchemaDto(item.schema))
}

function isPluginInvocationDto(value: unknown): value is PluginInvocationDto {
  if (!isRecord(value) || !hasOnlyKeys(value, ["operation", "payload", "ui_schema"])) return false
  if (!isPluginOperation(value.operation) || typeof value.payload !== "string") return false
  if (value.operation === "content_transform") return value.ui_schema === undefined
  return isPluginUiSchemaDto(value.ui_schema)
}

function isPluginUiActionResultDto(value: unknown): value is PluginUiActionResultDto {
  return isRecord(value)
    && hasExactKeys(value, ["executed_commands"])
    && isSafeCount(value.executed_commands)
    && value.executed_commands <= 32
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
  if (value.kind === "action") {
    return hasExactKeys(value, ["kind", "label", "action_key"])
      && isBoundedText(value.label, 1, 80)
      && isPluginUiActionKey(value.action_key)
  }
  return false
}

function isPluginUiActionKey(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 80
    && /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/u.test(value)
}

function isPluginCapability(value: unknown): value is PluginCapability {
  return typeof value === "string" && [
    "content.transform", "ui.panel", "events.subscribe", "core.query", "points.write",
    "experience.write", "entitlements.write", "notifications.write", "storage.read_write",
    "tasks.schedule",
  ].includes(value)
}

function isPluginDataScope(value: unknown): value is PluginDataScope {
  return typeof value === "string"
    && ["site.read", "actor.read", "users.read.basic", "users.read.membership", "users.targeted", "boards.read"].includes(value)
}

function isPluginEventSubscription(value: unknown): value is PluginEventSubscription {
  return typeof value === "string" && [
    "user.created", "topic.published", "reply.created", "points.changed",
    "experience.changed", "entitlement.changed",
  ].includes(value)
}

function validBusinessContract(
  version: unknown,
  capabilities: PluginCapability[],
  dataScopes: PluginDataScope[],
  eventSubscriptions: PluginEventSubscription[],
): boolean {
  const businessCapabilities = capabilities.filter((capability) => capability !== "content.transform" && capability !== "ui.panel")
  if (version === null) {
    return businessCapabilities.length === 0
      && dataScopes.length === 0
      && eventSubscriptions.length === 0
  }
  if (version !== "0.1.0" || businessCapabilities.length === 0 || capabilities.includes("content.transform")) return false
  const targetedWrite = capabilities.some((capability) => [
    "points.write", "experience.write", "entitlements.write", "notifications.write",
  ].includes(capability))
  return (!targetedWrite || dataScopes.includes("users.targeted"))
    && (eventSubscriptions.length === 0 || capabilities.includes("events.subscribe"))
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
