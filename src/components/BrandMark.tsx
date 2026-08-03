import { Cloud } from "lucide-react"

export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <Cloud size={19} strokeWidth={2.15} />
      <span className="brand-mark__blade" />
    </span>
  )
}
