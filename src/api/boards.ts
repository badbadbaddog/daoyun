import type { Board, BoardIcon, BoardTone } from "../types/community"

const BOARD_ENDPOINT = "/api/v1/boards?limit=50"
const boardIcons = new Set<BoardIcon>(["code", "layout", "aperture", "messages"])
const boardTones = new Set<BoardTone>(["green", "blue", "amber", "rose"])
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

interface BoardSummaryDto {
  id: string
  slug: string
  name: string
  description: string
  icon: string
  tone: BoardTone
  topic_count: number
}

interface BoardPageDto {
  data: BoardSummaryDto[]
  meta: {
    request_id: string
    next_cursor: string | null
  }
}

export async function listBoards(signal?: AbortSignal): Promise<Board[]> {
  const response = await fetch(BOARD_ENDPOINT, {
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

  return payload.data.map((board) => ({
    id: board.id,
    slug: board.slug,
    name: board.name,
    description: board.description,
    icon: boardIcons.has(board.icon as BoardIcon) ? board.icon as BoardIcon : "messages",
    tone: board.tone,
    topicCount: board.topic_count,
  }))
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
    && typeof value.slug === "string"
    && slugPattern.test(value.slug)
    && typeof value.name === "string"
    && value.name.trim().length > 0
    && typeof value.description === "string"
    && typeof value.icon === "string"
    && typeof value.tone === "string"
    && boardTones.has(value.tone as BoardTone)
    && typeof value.topic_count === "number"
    && Number.isSafeInteger(value.topic_count)
    && value.topic_count >= 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value)
}
