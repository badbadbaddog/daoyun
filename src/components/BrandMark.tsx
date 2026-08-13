import { Cloud } from "lucide-react"

export function BrandMark({ logoUrl = null }: { logoUrl?: string | null }) {
  return (
    <span className="brand-mark" aria-hidden="true">
      {logoUrl ? <img src={logoUrl} alt="" /> : <><Cloud size={19} strokeWidth={2.15} /><span className="brand-mark__blade" /></>}
    </span>
  )
}
