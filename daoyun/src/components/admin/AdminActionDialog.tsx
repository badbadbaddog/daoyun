import { X } from "lucide-react"
import { useId, type ReactNode } from "react"

import { ModalDialog } from "../ui/ModalDialog"

export function AdminActionDialog({ title, children, onClose, busy = false }: {
  title: string
  children: ReactNode
  onClose: () => void
  busy?: boolean
}) {
  const titleId = useId()
  return <ModalDialog titleId={titleId} onClose={onClose} busy={busy} className="admin-action-dialog">
    <header className="admin-action-dialog__header">
      <h3 id={titleId}>{title}</h3>
      <button className="icon-button" type="button" aria-label={`关闭${title}`} title="关闭" disabled={busy} onClick={onClose}><X size={18} aria-hidden="true" /></button>
    </header>
    <div className="admin-action-dialog__body">{children}</div>
  </ModalDialog>
}
