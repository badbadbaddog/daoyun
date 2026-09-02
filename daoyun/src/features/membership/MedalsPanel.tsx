import type { MemberMedal } from "./membershipTypes"

export function MedalsPanel({ medals }: { medals: MemberMedal[] }) {
  return <section className="member-panel medals-panel" aria-label="公开勋章"><p className="member-panel__eyebrow">身份勋章</p><h2>勋章</h2>{medals.length ? <ul className="medals-list">{medals.map((medal) => <li key={medal.key}><img src={medal.assetUrl} alt="" width={40} height={40} loading="lazy" /><span>{medal.displayName}</span></li>)}</ul> : <p>还没有获得勋章</p>}</section>
}
