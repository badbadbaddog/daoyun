import { useId, type ReactNode } from "react"

import { ModalDialog } from "./ModalDialog"

interface ConfirmDialogProps {
  title: string
  children: ReactNode
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
  danger?: boolean
  cancelLabel?: string
  returnFocus?: HTMLElement | null
}

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
  busy = false,
  danger = true,
  cancelLabel = "取消",
  returnFocus = null,
}: ConfirmDialogProps) {
  const titleId = `confirm-dialog-${useId().replaceAll(":", "")}`

  return (
    <ModalDialog
      titleId={titleId}
      className="dialog-panel confirm-dialog"
      role="alertdialog"
      busy={busy}
      returnFocus={returnFocus}
      initialFocusSelector="[data-confirm-cancel]"
      onClose={onCancel}
    >
      <h3 id={titleId}>{title}</h3>
      <div className="confirm-dialog__content">{children}</div>
      <div className="confirm-dialog__actions">
        <button data-confirm-cancel className="secondary-button" type="button" disabled={busy} onClick={onCancel}>{cancelLabel}</button>
        <button className={danger ? "danger-button" : "primary-button"} type="button" disabled={busy} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </ModalDialog>
  )
}
