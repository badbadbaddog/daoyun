import { X } from "lucide-react"
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react"

const focusableSelector = "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex='-1'])"

export function Drawer({ title, description, onClose, children, busy = false }: { title: string; description?: string; onClose: () => void; children: ReactNode; busy?: boolean }) {
  const ref = useRef<HTMLElement | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

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

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && !busy) {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== "Tab") return
    const controls = [...(ref.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])]
    const first = controls[0]
    const last = controls.at(-1)
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) {
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
      <section ref={ref} className="drawer-panel" role="dialog" aria-modal="true" aria-labelledby="drawer-title" aria-describedby={description ? "drawer-description" : undefined} onKeyDown={onKeyDown}>
        <header className="drawer-header">
          <div>
            <h3 id="drawer-title">{title}</h3>
            {description && <p id="drawer-description">{description}</p>}
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
