import type { components } from "./generated"
import { parseTopicPage, TopicApiError, type TopicPage } from "./topics"

const FEED_ENDPOINT = "/api/v1/feed"
const DEFAULT_LIMIT = 20

export type FeedMode = components["schemas"]["FeedMode"]

export interface ListFeedOptions {
  cursor?: string
  limit?: number
  signal?: AbortSignal
}

export async function listFeed(mode: FeedMode, options: ListFeedOptions = {}): Promise<TopicPage> {
  const params = new URLSearchParams({
    mode,
    limit: String(options.limit ?? DEFAULT_LIMIT),
  })
  if (options.cursor) params.set("cursor", options.cursor)

  const response = await fetch(`${FEED_ENDPOINT}?${params.toString()}`, {
    headers: { Accept: "application/json" },
    credentials: "include",
    signal: options.signal,
  })
  const payload = await readJson(response)
  if (!response.ok) throw feedApiError(response.status, payload)
  const page = parseTopicPage(payload)
  if (response.status !== 200 || !page) {
    throw new Error("内容流响应格式无效")
  }
  return page
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown
  } catch {
    return undefined
  }
}

function feedApiError(status: number, payload: unknown): TopicApiError {
  if (!isErrorResponse(payload)) {
    return new TopicApiError(status, "response.invalid", "内容流服务响应格式无效")
  }
  return new TopicApiError(status, payload.error.code, payload.error.message, payload.error.fields)
}

function isErrorResponse(value: unknown): value is {
  error: { code: string; message: string; fields: Record<string, string[]> }
} {
  if (!isRecord(value) || !isRecord(value.error)) return false
  return typeof value.error.code === "string"
    && typeof value.error.message === "string"
    && isFieldErrors(value.error.fields)
}

function isFieldErrors(value: unknown): value is Record<string, string[]> {
  return isRecord(value) && Object.values(value).every(
    (messages) => Array.isArray(messages) && messages.every((message) => typeof message === "string"),
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
