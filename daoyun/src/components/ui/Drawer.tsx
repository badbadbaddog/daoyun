import { X } from "lucide-react"
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react"
import { useBodyScrollLock } from "./useBodyScrollLock"

const focusableSelector = "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex='-1'])"

export function Drawer({ title, description, onClose, children, busy = false }: { title: string; description?: string; onClose: () => void; children: ReactNode; busy?: boolean }) {
  const ref = useRef<HTMLElement | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const descriptionId = useId()
  useBodyScrollLock()

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    ref.current?.querySelector<HTMLElement>(focusableSelector)?.focus()
    return () => {
      const target = returnFocusRef.current
      queueMicrotask(() => {
        if (target?.isConnected) target.focus()
      })
    }
  }, [])

  useEffect(() => {
    // Dynamic forms may remove the focused control after a successful action.
    if (document.activeElement === document.body) ref.current?.focus()
  })

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && !busy) {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== "Tab") return
    const controls = [...(ref.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])]
    const first = controls[0]
    const last = controls.at(-1)
    if (!first || !last) {
      event.preventDefault()
      ref.current?.focus()
      return
    }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      className="drawer-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <section ref={ref} tabIndex={-1} className="drawer-panel" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} onKeyDown={onKeyDown}>
        <header className="drawer-header">
          <div>
            <h3 id={titleId}>{title}</h3>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
          <button className="icon-button" type="button" aria-label="关闭抽屉" title="关闭" disabled={busy} onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div className="drawer-body">{children}</div>
      </section>
    </div>
  )
}
