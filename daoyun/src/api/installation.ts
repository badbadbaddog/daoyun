import type { components } from "./generated"

const INSTALLATION_ENDPOINT = "/api/v1/installation"
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const usernamePattern = /^[a-z][a-z0-9_]{2,31}$/
const emailPattern = /^[^\s@]+@[^\s@]+$/
const controlCharacterPattern = /\p{Cc}/u

export interface InstallationStatus {
  isInitialized: boolean
}

export interface InitializeInstallationInput {
  username: string
  email: string
  displayName: string
  password: string
}

export interface InitialAdministrator {
  id: string
  username: string
  email: string
  displayName: string
}

export interface InstallationInitialization extends InstallationStatus {
  administrator: InitialAdministrator
}

type InstallationStatusDto = components["schemas"]["ApiResponse_InstallationStatus"]
type InstallationInitializationDto = components["schemas"]["ApiResponse_InstallationInitialization"]
type ErrorResponseDto = components["schemas"]["ErrorResponse"]
type InitializeInstallationRequestDto = components["schemas"]["InitializeInstallationRequest"]
type InstallationEnvelope = { data: Record<string, unknown>; meta: components["schemas"]["ResponseMeta"] }

export class InstallationApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fields: Record<string, string[]>

  constructor(
    status: number,
    code: string,
    message: string,
    fields: Record<string, string[]> = {},
  ) {
    super(message)
    this.name = "InstallationApiError"
    this.status = status
    this.code = code
    this.fields = fields
  }
}

export async function getInstallationStatus(signal?: AbortSignal): Promise<InstallationStatus> {
  const response = await fetch(INSTALLATION_ENDPOINT, {
    headers: { Accept: "application/json" },
    signal,
  })
  const payload = await readJson(response)

  if (!response.ok) {
    throw toApiError(response.status, payload)
  }
  if (!isInstallationStatusResponse(payload)) {
    throw new Error("安装状态响应格式无效")
  }

  return { isInitialized: payload.data.is_initialized }
}

export async function initializeInstallation(
  input: InitializeInstallationInput,
  signal?: AbortSignal,
): Promise<InstallationInitialization> {
  const body: InitializeInstallationRequestDto = {
    username: input.username,
    email: input.email,
    display_name: input.displayName,
    password: input.password,
  }
  const response = await fetch(INSTALLATION_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  })
  const payload = await readJson(response)

  if (!response.ok) {
    throw toApiError(response.status, payload)
  }
  if (response.status !== 201 || !isInstallationInitializationResponse(payload)) {
    throw new Error("安装响应格式无效")
  }

  return {
    isInitialized: payload.data.is_initialized,
    administrator: {
      id: payload.data.administrator.id,
      username: payload.data.administrator.username,
      email: payload.data.administrator.email,
      displayName: payload.data.administrator.display_name,
    },
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown
  } catch {
    return undefined
  }
}

function toApiError(status: number, payload: unknown): InstallationApiError {
  if (!isErrorResponse(payload)) {
    return new InstallationApiError(status, "response.invalid", "安装服务响应格式无效")
  }

  return new InstallationApiError(
    status,
    payload.error.code,
    payload.error.message,
    payload.error.fields,
  )
}

function isInstallationStatusResponse(value: unknown): value is InstallationStatusDto {
  return isEnvelope(value)
    && typeof value.data.is_initialized === "boolean"
}

function isInstallationInitializationResponse(value: unknown): value is InstallationInitializationDto {
  if (!isEnvelope(value)
    || value.data.is_initialized !== true
    || !isRecord(value.data.administrator)) {
    return false
  }

  const administrator = value.data.administrator
  return isUuid(administrator.id)
    && typeof administrator.username === "string"
    && usernamePattern.test(administrator.username)
    && typeof administrator.email === "string"
    && administrator.email === administrator.email.trim()
    && countCharacters(administrator.email) <= 254
    && emailPattern.test(administrator.email)
    && typeof administrator.display_name === "string"
    && administrator.display_name === administrator.display_name.trim()
    && countCharacters(administrator.display_name) >= 1
    && countCharacters(administrator.display_name) <= 80
    && !controlCharacterPattern.test(administrator.display_name)
}

function isEnvelope(value: unknown): value is InstallationEnvelope {
  return isRecord(value)
    && isRecord(value.data)
    && isRecord(value.meta)
    && isUuid(value.meta.request_id)
}

function isErrorResponse(value: unknown): value is ErrorResponseDto {
  if (!isRecord(value)
    || !isRecord(value.error)
    || !isRecord(value.meta)
    || !isUuid(value.meta.request_id)
    || !isNonEmptyString(value.error.code)
    || !isNonEmptyString(value.error.message)) {
    return false
  }

  const fields = value.error.fields
  return fields === undefined || isFieldErrors(fields)
}

function isFieldErrors(value: unknown): value is Record<string, string[]> {
  return isRecord(value)
    && Object.values(value).every((messages) => (
      Array.isArray(messages)
      && messages.length > 0
      && messages.every(isNonEmptyString)
    ))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function countCharacters(value: string): number {
  return [...value].length
}
