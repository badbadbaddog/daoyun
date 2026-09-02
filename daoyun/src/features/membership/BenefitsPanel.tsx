import type { MemberEntitlement } from "./membershipTypes"

export function BenefitsPanel({ entitlements }: { entitlements: MemberEntitlement[] }) {
  return <section className="member-panel benefits-panel" aria-label="标准权益"><p className="member-panel__eyebrow">当前权益</p><h2>标准权益</h2>{entitlements.length ? <ul className="benefits-list">{entitlements.map((item) => <li key={item.id}><strong>{item.displayName}</strong><span>{item.expiresAt ? `有效期至 ${new Date(item.expiresAt).toLocaleDateString()}` : "长期有效"}</span>{Object.entries(item.quotas).map(([key, value]) => <small key={key}>{key}: {value.toLocaleString()}</small>)}</li>)}</ul> : <p>当前没有生效中的标准权益</p>}</section>
}
