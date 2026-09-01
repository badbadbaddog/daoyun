export const adminMembershipReasons = [
  ["operations.community_reward", "社区贡献奖励"],
  ["operations.event_reward", "活动奖励"],
  ["operations.correction", "账务纠正"],
  ["operations.compensation", "服务补偿"],
] as const

interface AdminReasonFieldProps {
  reason: string
  details: string
  onReasonChange: (reason: string) => void
  onDetailsChange: (details: string) => void
  disabled?: boolean
}

export function AdminReasonField({ reason, details, onReasonChange, onDetailsChange, disabled }: AdminReasonFieldProps) {
  return <div className="admin-reason-field"><label>运营原因<select aria-label="运营原因" value={reason} disabled={disabled} onChange={(event) => onReasonChange(event.target.value)}><option value="">请选择运营原因</option>{adminMembershipReasons.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label><label>补充说明<textarea aria-label="补充说明" value={details} disabled={disabled} maxLength={200} onChange={(event) => onDetailsChange(event.target.value)} /></label></div>
}
