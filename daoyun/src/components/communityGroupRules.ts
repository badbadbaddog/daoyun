export const communityPermissionKeys = ["board.read", "topic.read", "topic.create", "reply.create", "message.send", "attachment.upload", "attachment.download", "topic.poll.create", "topic.bounty.create", "topic.lottery.join", "content.external_link.use", "profile.signature.use", "content.pre_moderation.required"] as const
export const permissionLabels: Record<typeof communityPermissionKeys[number], string> = {
  "board.read": "浏览版块", "topic.read": "阅读主题", "topic.create": "发布主题", "reply.create": "回复主题",
  "message.send": "发送私信", "attachment.upload": "上传附件", "attachment.download": "下载附件",
  "topic.poll.create": "发起投票", "topic.bounty.create": "发布悬赏", "topic.lottery.join": "参与抽奖",
  "content.external_link.use": "使用外链", "profile.signature.use": "使用个人签名", "content.pre_moderation.required": "内容须预审",
}
export const communityQuotaKeys = [
  { key: "topic.create.daily", label: "每日主题数", maximum: 1_000_000 },
  { key: "reply.create.daily", label: "每日回复数", maximum: 1_000_000 },
  { key: "message.send.daily", label: "每日私信数", maximum: 1_000_000 },
  { key: "attachment.upload.daily", label: "每日上传数量", maximum: 10_000 },
  { key: "attachment.file.bytes", label: "单文件字节数", maximum: Number.MAX_SAFE_INTEGER },
  { key: "attachment.storage.bytes", label: "总存储字节数", maximum: Number.MAX_SAFE_INTEGER },
  { key: "attachment.download.bytes.daily", label: "每日下载字节数", maximum: Number.MAX_SAFE_INTEGER },
  { key: "content.external_link.daily", label: "每日外链数", maximum: 1_000_000 },
] as const

const bytesPerMiB = 1048576
export function isByteQuota(key: string): boolean { return key.includes("bytes") }
export function quotaInputValue(key: string, bytes: number): string { return String(isByteQuota(key) ? bytes / bytesPerMiB : bytes) }
export function parseQuotaInput(key: string, value: string): number | null {
  if (!value.trim()) return null
  const amount = Number(value) * (isByteQuota(key) ? bytesPerMiB : 1)
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null
}
export function formatCommunityQuota(key: string, value: number): string {
  const unit = isByteQuota(key) ? "MiB" : key === "attachment.upload.daily" ? "个" : "次"
  return quotaInputValue(key, value) + " " + unit + (value === 0 ? "（不提供）" : "")
}

const groupByteQuotaLabels: Record<string, string> = { "attachment.file.bytes": "单文件上限（MiB）", "attachment.storage.bytes": "总存储空间（MiB）", "attachment.download.bytes.daily": "每日下载上限（MiB）" }
export const communityGroupQuotaKeys = communityQuotaKeys.map(quota => ({ ...quota, label: groupByteQuotaLabels[quota.key] ?? quota.label }))
