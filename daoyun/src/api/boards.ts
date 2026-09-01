import type { Board, BoardIcon, BoardTone } from "../types/community"
import type { components } from "./generated"

const BOARD_ENDPOINT = "/api/v1/boards?limit=50"
const boardIcons = new Set<BoardIcon>(["code", "layout", "aperture", "messages"])
const boardTones = new Set<BoardTone>(["green", "blue", "amber", "rose"])
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

type GeneratedBoardSummaryDto = components["schemas"]["BoardSummary"]
type BoardSummaryDto = GeneratedBoardSummaryDto & {
  parent_id: string | null
  position: number
  depth: number
  child_count: number
}
type GeneratedBoardPageDto = components["schemas"]["PageResponse_BoardSummary"]
type BoardPageDto = Omit<GeneratedBoardPageDto, "data"> & { data: BoardSummaryDto[] }

export type BoardSummary = Board

export interface BoardBreadcrumbItem {
  id: string
  slug: string
  name: string
}

export interface BoardViewerCapabilities {
  canRead: boolean
  canCreateTopic: boolean
  canReply: boolean
  canUploadAttachment: boolean
}

export interface BoardDetail extends Board {
  children: BoardSummary[]
  breadcrumb: BoardBreadcrumbItem[]
  viewer: BoardViewerCapabilities
}

export class BoardApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message)
  }
}

export async function listBoards(signal?: AbortSignal): Promise<Board[]> {
  const boards: Board[] = []
  const seenCursors = new Set<string>()
  let cursor: string | null = null

  do {
    const endpoint = cursor ? `${BOARD_ENDPOINT}&cursor=${encodeURIComponent(cursor)}` : BOARD_ENDPOINT
    const response = await fetch(endpoint, {
      headers: { Accept: "application/json" },
      signal,
    })

    if (!response.ok) {
      throw new Error("板块请求失败")
    }

    const payload: unknown = await response.json()
    if (!isBoardPage(payload)) {
      throw new Error("板块响应格式无效")
    }

    boards.push(...payload.data.map(mapBoardSummary))
    cursor = payload.meta.next_cursor ?? null
    if (cursor && seenCursors.has(cursor)) {
      throw new Error("板块分页响应无效")
    }
    if (cursor) seenCursors.add(cursor)
  } while (cursor)

  return boards
}

export async function getBoard(slug: string, signal?: AbortSignal): Promise<BoardDetail> {
  const response = await fetch(`/api/v1/boards/${encodeURIComponent(slug)}`, {
    headers: { Accept: "application/json" },
    signal,
  })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const error = parseError(payload)
    throw new BoardApiError(error.message, response.status, error.code)
  }
  if (!isBoardDetailResponse(payload)) {
    throw new BoardApiError("版块响应格式无效", response.status, "board.invalid_response")
  }
  return {
    ...mapBoardSummary({
      ...payload.data,
      position: 0,
      depth: Math.max(0, payload.data.breadcrumb.length - 1),
      child_count: payload.data.children.length,
    }),
    children: payload.data.children.map(mapBoardSummary),
    breadcrumb: payload.data.breadcrumb,
    viewer: {
      canRead: payload.data.viewer.can_read,
      canCreateTopic: payload.data.viewer.can_create_topic,
      canReply: payload.data.viewer.can_reply,
      canUploadAttachment: payload.data.viewer.can_upload_attachment,
    },
  }
}

function isBoardPage(value: unknown): value is BoardPageDto {
  if (!isRecord(value) || !Array.isArray(value.data) || !isRecord(value.meta)) {
    return false
  }

  const { request_id: requestId, next_cursor: nextCursor } = value.meta
  return isUuid(requestId)
    && (nextCursor === null || isUuid(nextCursor))
    && value.data.every(isBoardSummary)
}

function isBoardSummary(value: unknown): value is BoardSummaryDto {
  if (!isRecord(value)) {
    return false
  }

  return isUuid(value.id)
    && (value.parent_id === null || isUuid(value.parent_id))
    && typeof value.slug === "string"
    && slugPattern.test(value.slug)
    && typeof value.name === "string"
    && value.name.trim().length > 0
    && typeof value.description === "string"
    && typeof value.icon === "string"
    && typeof value.tone === "string"
    && boardTones.has(value.tone as BoardTone)
    && isNonNegativeInteger(value.position)
    && isNonNegativeInteger(value.depth)
    && isNonNegativeInteger(value.child_count)
    && typeof value.topic_count === "number"
    && Number.isSafeInteger(value.topic_count)
    && value.topic_count >= 0
}

function isBoardDetailResponse(value: unknown): value is {
  data: {
    id: string
    slug: string
    name: string
    description: string
    icon: string
    tone: BoardTone
    parent_id: string | null
    topic_count: number
    children: BoardSummaryDto[]
    breadcrumb: BoardBreadcrumbItem[]
    viewer: {
      can_read: boolean
      can_create_topic: boolean
      can_reply: boolean
      can_upload_attachment: boolean
    }
  }
  meta: { request_id: string }
} {
  if (!isRecord(value) || !isRecord(value.data) || !isRecord(value.meta)) return false
  const data = value.data
  const summary = {
    ...data,
    position: 0,
    depth: 0,
    child_count: Array.isArray(data.children) ? data.children.length : -1,
  }
  return isUuid(value.meta.request_id)
    && isBoardSummary(summary)
    && Array.isArray(data.children)
    && data.children.every(isBoardSummary)
    && Array.isArray(data.breadcrumb)
    && data.breadcrumb.every(isBreadcrumbItem)
    && isRecord(data.viewer)
    && typeof data.viewer.can_read === "boolean"
    && typeof data.viewer.can_create_topic === "boolean"
    && typeof data.viewer.can_reply === "boolean"
    && typeof data.viewer.can_upload_attachment === "boolean"
}

function mapBoardSummary(board: BoardSummaryDto): BoardSummary {
  return {
    id: board.id,
    parentId: board.parent_id,
    slug: board.slug,
    name: board.name,
    description: board.description,
    icon: boardIcons.has(board.icon as BoardIcon) ? board.icon as BoardIcon : "messages",
    tone: board.tone,
    position: board.position,
    depth: board.depth,
    childCount: board.child_count,
    topicCount: board.topic_count,
  }
}

function isBreadcrumbItem(value: unknown): value is BoardBreadcrumbItem {
  return isRecord(value)
    && isUuid(value.id)
    && typeof value.slug === "string"
    && slugPattern.test(value.slug)
    && typeof value.name === "string"
    && value.name.trim().length > 0
}

function parseError(value: unknown): { code: string; message: string } {
  if (isRecord(value) && isRecord(value.error)) {
    return {
      code: typeof value.error.code === "string" ? value.error.code : "board.request_failed",
      message: typeof value.error.message === "string" ? value.error.message : "版块请求失败",
    }
  }
  return { code: "board.request_failed", message: "版块请求失败" }
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value)
}
