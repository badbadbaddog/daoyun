import { MoreHorizontal } from "lucide-react"
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react"

export interface ActionMenuItem { label: string; onSelect: () => void; disabled?: boolean; danger?: boolean; icon?: ReactNode }

export function ActionMenu({ label, items, disabled = false }: { label: string; items: ActionMenuItem[]; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  function focusItem(index: number) { menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)")[index]?.focus() }
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)") ?? [])]
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === "Escape") { event.preventDefault(); setOpen(false); return }
    if (event.key === "Home") { event.preventDefault(); focusItem(0); return }
    if (event.key === "End") { event.preventDefault(); focusItem(items.length - 1); return }
    if (event.key === "ArrowDown") { event.preventDefault(); items[(index + 1 + items.length) % items.length]?.focus() }
    if (event.key === "ArrowUp") { event.preventDefault(); items[(index - 1 + items.length) % items.length]?.focus() }
  }
  return <div className="action-menu"><button className="icon-button" type="button" aria-label={label} title="更多操作" aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => { setOpen((value) => !value); queueMicrotask(() => focusItem(0)) }}><MoreHorizontal size={16} aria-hidden="true" /></button>{open && <div ref={menuRef} className="action-menu__popover" role="menu" aria-label={label} onKeyDown={handleKeyDown}>{items.map((item) => <button key={item.label} className={item.danger ? "action-menu__item action-menu__item--danger" : "action-menu__item"} type="button" role="menuitem" disabled={item.disabled} onClick={() => { setOpen(false); item.onSelect() }}>{item.icon}{item.label}</button>)}</div>}</div>
}
