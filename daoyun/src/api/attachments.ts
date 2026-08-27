const DRAFT_ENDPOINT = "/api/v1/attachments/drafts"
const MAX_EDITOR_IMAGE_BYTES = 10 * 1024 * 1024
const UPLOAD_TIMEOUT_MS = 60_000
const imageTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface DraftImageAttachment {
  id: string
  originalName: string
  mimeType: string
  sizeBytes: number
  expiresAt: string
}

export class AttachmentApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = "AttachmentApiError"
    this.status = status
    this.code = code
  }
}

export async function uploadDraftImage(
  file: File,
  csrfToken: string,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<DraftImageAttachment> {
  if (!imageTypes.has(file.type)) {
    throw new AttachmentApiError(422, "attachment.invalid", "仅支持 PNG、JPG、GIF 或 WebP 图片")
  }
  if (file.size < 1 || file.size > MAX_EDITOR_IMAGE_BYTES) {
    throw new AttachmentApiError(422, "attachment.too_large", "单张图片不能超过 10 MiB")
  }

  if (signal?.aborted) {
    throw new AttachmentApiError(0, "request.aborted", "图片上传已取消")
  }
  const controller = new AbortController()
  let timedOut = false
  const abort = () => controller.abort()
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, UPLOAD_TIMEOUT_MS)
  signal?.addEventListener("abort", abort, { once: true })

  try {
    let body: ArrayBuffer
    try {
      body = await readFileBytes(file, controller.signal)
    } catch {
      if (timedOut) throw new AttachmentApiError(0, "request.timeout", "图片上传超时，请重试")
      if (signal?.aborted) throw new AttachmentApiError(0, "request.aborted", "图片上传已取消")
      throw new AttachmentApiError(0, "attachment.read_failed", "图片读取失败，请重新选择")
    }
    let response: { status: number; payload: unknown }
    try {
      response = await sendDraftRequest(body, file, csrfToken, onProgress, controller.signal)
    } catch {
      if (timedOut) throw new AttachmentApiError(0, "request.timeout", "图片上传超时，请重试")
      if (signal?.aborted) throw new AttachmentApiError(0, "request.aborted", "图片上传已取消")
      throw new AttachmentApiError(0, "network.unavailable", "图片上传失败，请检查网络后重试")
    }

    if (response.status < 200 || response.status >= 300) throw toApiError(response.status, response.payload)
    if (!isDraftEnvelope(response.payload)) {
      throw new AttachmentApiError(response.status, "response.invalid", "图片上传响应格式无效")
    }
    onProgress?.(100)
    return {
      id: response.payload.data.id,
      originalName: response.payload.data.original_name,
      mimeType: response.payload.data.mime_type,
      sizeBytes: response.payload.data.size_bytes,
      expiresAt: response.payload.data.expires_at,
    }
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener("abort", abort)
  }
}

function sendDraftRequest(
  body: ArrayBuffer,
  file: File,
  csrfToken: string,
  onProgress: ((percent: number) => void) | undefined,
  signal: AbortSignal,
): Promise<{ status: number; payload: unknown }> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"))
      return
    }

    const request = new XMLHttpRequest()
    const cleanup = () => signal.removeEventListener("abort", abort)
    const abort = () => request.abort()
    request.onload = () => {
      cleanup()
      resolve({ status: request.status, payload: readJson(request.responseText) })
    }
    request.onerror = () => {
      cleanup()
      reject(new Error("image upload failed"))
    }
    request.onabort = () => {
      cleanup()
      reject(new DOMException("Aborted", "AbortError"))
    }
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return
      const percent = Math.max(1, Math.min(98, Math.round((event.loaded / event.total) * 100)))
      onProgress?.(percent)
    }
    signal.addEventListener("abort", abort, { once: true })

    try {
      request.open("POST", DRAFT_ENDPOINT)
      request.withCredentials = true
      request.setRequestHeader("Accept", "application/json")
      request.setRequestHeader("Content-Type", file.type)
      request.setRequestHeader("x-file-name", encodeURIComponent(file.name))
      request.setRequestHeader("x-csrf-token", csrfToken)
      request.send(body)
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}

function readFileBytes(file: File, signal: AbortSignal): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("image read aborted"))
      return
    }
    const reader = new FileReader()
    const cleanup = () => signal.removeEventListener("abort", abort)
    const abort = () => reader.abort()
    reader.onload = () => {
      cleanup()
      if (reader.result instanceof ArrayBuffer) resolve(reader.result)
      else reject(new Error("image bytes are unavailable"))
    }
    reader.onerror = () => {
      cleanup()
      reject(reader.error ?? new Error("image read failed"))
    }
    reader.onabort = () => {
      cleanup()
      reject(new Error("image read aborted"))
    }
    signal.addEventListener("abort", abort, { once: true })
    reader.readAsArrayBuffer(file)
  })
}

function isDraftEnvelope(value: unknown): value is {
  data: { id: string; original_name: string; mime_type: string; size_bytes: number; expires_at: string }
  meta: { request_id: string }
} {
  if (!isRecord(value) || !isRecord(value.data) || !isRecord(value.meta)) return false
  return isUuid(value.data.id)
    && typeof value.data.original_name === "string"
    && imageTypes.has(String(value.data.mime_type))
    && Number.isSafeInteger(value.data.size_bytes)
    && Number(value.data.size_bytes) > 0
    && typeof value.data.expires_at === "string"
    && !Number.isNaN(Date.parse(value.data.expires_at))
    && isUuid(value.meta.request_id)
}

function toApiError(status: number, value: unknown): AttachmentApiError {
  if (isRecord(value) && isRecord(value.error)
    && typeof value.error.code === "string" && typeof value.error.message === "string") {
    return new AttachmentApiError(status, value.error.code, value.error.message)
  }
  return new AttachmentApiError(status, "response.invalid", "图片上传失败，请稍后重试")
}

function readJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
