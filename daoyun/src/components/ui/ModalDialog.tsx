import { useEffect, useRef, type FormEventHandler, type KeyboardEvent, type MouseEvent, type ReactNode } from "react"
import { useBodyScrollLock } from "./useBodyScrollLock"

const focusableSelector = "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex='-1'])"

type ModalDialogElement = "div" | "section" | "form"
type ModalDialogRole = "dialog" | "alertdialog"

interface ModalDialogProps {
  titleId: string
  children: ReactNode
  onClose: () => void
  busy?: boolean
  returnFocus?: HTMLElement | null
  className?: string
  backdropClassName?: string
  describedBy?: string
  role?: ModalDialogRole
  element?: ModalDialogElement
  initialFocusSelector?: string
  onSubmit?: FormEventHandler<HTMLFormElement>
}

export function ModalDialog({
  titleId,
  children,
  onClose,
  busy = false,
  returnFocus = null,
  className = "dialog-panel",
  backdropClassName = "dialog-backdrop",
  describedBy,
  role = "dialog",
  element = "section",
  initialFocusSelector,
  onSubmit,
}: ModalDialogProps) {
  const dialogRef = useRef<HTMLElement | null>(null)
  const capturedReturnFocusRef = useRef<HTMLElement | null>(null)
  useBodyScrollLock()

  useEffect(() => {
    capturedReturnFocusRef.current = returnFocus?.isConnected
      ? returnFocus
      : document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    queueMicrotask(() => {
      const preferred = initialFocusSelector
        ? dialogRef.current?.querySelector<HTMLElement>(initialFocusSelector)
        : null
      preferred?.focus()
      if (!preferred) {
        const controls = focusableControls()
        if (controls.length > 0) controls[0].focus()
        else dialogRef.current?.focus()
      }
    })
    return () => {
      const focusTarget = returnFocus?.isConnected ? returnFocus : capturedReturnFocusRef.current
      queueMicrotask(() => {
        if (focusTarget?.isConnected) focusTarget.focus()
      })
    }
  }, [])

  function focusableControls() {
    return [...(dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])]
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      if (!busy) onClose()
      return
    }
    if (event.key !== "Tab") return
    event.stopPropagation()
    const controls = focusableControls()
    if (controls.length === 0) {
      event.preventDefault()
      dialogRef.current?.focus()
      return
    }
    const first = controls[0]
    const last = controls.at(-1) ?? first
    const activeInside = dialogRef.current?.contains(document.activeElement) ?? false
    if (event.shiftKey && (document.activeElement === first || !activeInside)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (document.activeElement === last || !activeInside)) {
      event.preventDefault()
      first.focus()
    }
  }

  function closeFromBackdrop(event: MouseEvent<HTMLDivElement>) {
    if (event.currentTarget !== event.target) return
    event.preventDefault()
    if (!busy) onClose()
  }

  const sharedProps = {
    className,
    role,
    "aria-modal": true,
    "aria-labelledby": titleId,
    "aria-describedby": describedBy,
    "aria-busy": busy,
    tabIndex: -1,
    onKeyDown: handleKeyDown,
  } as const
  const setDialogRef = (node: HTMLElement | null) => { dialogRef.current = node }

  return <div className={backdropClassName} onMouseDown={closeFromBackdrop}>
    {element === "form"
      ? <form ref={setDialogRef} {...sharedProps} onSubmit={onSubmit}>{children}</form>
      : element === "div"
        ? <div ref={setDialogRef} {...sharedProps}>{children}</div>
        : <section ref={setDialogRef} {...sharedProps}>{children}</section>}
  </div>
}
