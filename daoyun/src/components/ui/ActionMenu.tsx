import { MoreHorizontal } from "lucide-react"
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react"

export interface ActionMenuItem {
  label: string
  onSelect: () => void
  disabled?: boolean
  danger?: boolean
  icon?: ReactNode
}

export function ActionMenu({ label, items, disabled = false }: { label: string; items: ActionMenuItem[]; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  function enabledItems() {
    return [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)") ?? [])]
  }

  function focusItem(index: number) {
    enabledItems()[index]?.focus()
  }

  function closeMenu({ restoreFocus }: { restoreFocus: boolean }) {
    setOpen(false)
    if (restoreFocus) queueMicrotask(() => triggerRef.current?.focus())
  }

  function openMenu(target: "first" | "last" = "first") {
    setOpen(true)
    queueMicrotask(() => {
      const options = enabledItems()
      options[target === "last" ? options.length - 1 : 0]?.focus()
    })
  }

  useEffect(() => {
    if (!open) return
    function closeFromPointer(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        closeMenu({ restoreFocus: false })
      }
    }
    document.addEventListener("pointerdown", closeFromPointer)
    return () => document.removeEventListener("pointerdown", closeFromPointer)
  }, [open])

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      openMenu("first")
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      openMenu("last")
    }
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const options = enabledItems()
    const index = options.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === "Escape") {
      event.preventDefault()
      closeMenu({ restoreFocus: true })
      return
    }
    if (event.key === "Home") {
      event.preventDefault()
      focusItem(0)
      return
    }
    if (event.key === "End") {
      event.preventDefault()
      focusItem(options.length - 1)
      return
    }
    if (event.key === "ArrowDown") {
      event.preventDefault()
      options[(index + 1 + options.length) % options.length]?.focus()
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      options[(index - 1 + options.length) % options.length]?.focus()
    }
  }

  return (
    <div ref={rootRef} className="action-menu">
      <button
        ref={triggerRef}
        className="icon-button"
        type="button"
        aria-label={label}
        title="更多操作"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onKeyDown={handleTriggerKeyDown}
        onClick={() => {
          if (open) closeMenu({ restoreFocus: false })
          else openMenu("first")
        }}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {open && (
        <div ref={menuRef} className="action-menu__popover" role="menu" aria-label={label} onKeyDown={handleMenuKeyDown}>
          {items.map((item) => (
            <button
              key={item.label}
              className={item.danger ? "action-menu__item action-menu__item--danger" : "action-menu__item"}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                closeMenu({ restoreFocus: true })
                item.onSelect()
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
