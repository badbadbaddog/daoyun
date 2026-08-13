import type { TopicPage } from "./topics"
import { parseTopicPage } from "./topics"
import type { components } from "./generated"

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface BookmarkState {
  topicId: string
  bookmarked: boolean
}

export interface PostLikeState {
  postId: string
  liked: boolean
  likeCount: number
}

export interface ListBookmarksOptions {
  cursor?: string
  limit?: number
  signal?: AbortSignal
}

type BookmarkResponseDto = components["schemas"]["ApiResponse_BookmarkState"]
type PostLikeResponseDto = components["schemas"]["ApiResponse_PostLikeState"]
type ErrorResponseDto = components["schemas"]["ErrorResponse"]

export class RelationApiError extends Error {
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
    this.name = "RelationApiError"
    this.status = status
    this.code = code
    this.fields = fields
  }
}

export async function setTopicBookmark(
  topicId: string,
  bookmarked: boolean,
  csrfToken: string,
  signal?: AbortSignal,
): Promise<BookmarkState> {
  const response = await fetch(`/api/v1/topics/${encodeURIComponent(topicId)}/bookmark`, {
    method: bookmarked ? "PUT" : "DELETE",
    headers: {
      Accept: "application/json",
      "x-csrf-token": csrfToken,
    },
    credentials: "include",
    signal,
  })
  const payload = await readJson(response)
  if (!response.ok) throw toApiError(response.status, payload)
  if (response.status !== 200 || !isBookmarkResponse(payload)) {
    throw new Error("收藏响应格式无效")
  }
  return {
    topicId: payload.data.topic_id,
    bookmarked: payload.data.bookmarked,
  }
}

export async function setPostLike(
  postId: string,
  liked: boolean,
  csrfToken: string,
  signal?: AbortSignal,
): Promise<PostLikeState> {
  const response = await fetch(`/api/v1/posts/${encodeURIComponent(postId)}/like`, {
    method: liked ? "PUT" : "DELETE",
    headers: {
      Accept: "application/json",
      "x-csrf-token": csrfToken,
    },
    credentials: "include",
    signal,
  })
  const payload = await readJson(response)
  if (!response.ok) throw toApiError(response.status, payload)
  if (response.status !== 200 || !isPostLikeResponse(payload)) {
    throw new Error("点赞响应格式无效")
  }
  return {
    postId: payload.data.post_id,
    liked: payload.data.liked,
    likeCount: payload.data.like_count,
  }
}

export async function listBookmarks(
  options: ListBookmarksOptions = {},
): Promise<TopicPage> {
  const params = new URLSearchParams()
  if (options.cursor) params.set("cursor", options.cursor)
  params.set("limit", String(options.limit ?? 20))
  const response = await fetch(`/api/v1/users/me/bookmarks?${params.toString()}`, {
    headers: { Accept: "application/json" },
    credentials: "include",
    signal: options.signal,
  })
  const payload = await readJson(response)
  if (!response.ok) throw toApiError(response.status, payload)
  const page = parseTopicPage(payload)
  if (response.status !== 200 || !page) throw new Error("收藏列表响应格式无效")
  return page
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown
  } catch {
    return undefined
  }
}

function toApiError(status: number, payload: unknown): RelationApiError {
  if (!isErrorResponse(payload)) {
    return new RelationApiError(status, "response.invalid", "互动服务响应格式无效")
  }
  return new RelationApiError(
    status,
    payload.error.code,
    payload.error.message,
    payload.error.fields,
  )
}

function isBookmarkResponse(value: unknown): value is BookmarkResponseDto {
  return isRecord(value)
    && isRecord(value.data)
    && isRecord(value.meta)
    && isUuid(value.data.topic_id)
    && typeof value.data.bookmarked === "boolean"
    && isUuid(value.meta.request_id)
}

function isPostLikeResponse(value: unknown): value is PostLikeResponseDto {
  return isRecord(value)
    && isRecord(value.data)
    && isRecord(value.meta)
    && isUuid(value.data.post_id)
    && typeof value.data.liked === "boolean"
    && isSafeNonNegativeInteger(value.data.like_count)
    && isUuid(value.meta.request_id)
}

function isErrorResponse(value: unknown): value is ErrorResponseDto {
  return isRecord(value)
    && isRecord(value.error)
    && isRecord(value.meta)
    && isNonEmptyString(value.error.code)
    && isNonEmptyString(value.error.message)
    && isUuid(value.meta.request_id)
    && (value.error.fields === undefined || isFieldErrors(value.error.fields))
}

function isFieldErrors(value: unknown): value is Record<string, string[]> {
  return isRecord(value) && Object.values(value).every((messages) => (
    Array.isArray(messages) && messages.length > 0 && messages.every(isNonEmptyString)
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

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}
