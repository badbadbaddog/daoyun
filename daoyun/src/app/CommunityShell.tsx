import type { ReactNode } from "react"

interface CommunityShellProps {
  header: ReactNode
  authStatus?: ReactNode
  leftSidebar: ReactNode
  main: ReactNode
  rightSidebar: ReactNode
  footer: ReactNode
  mobileNavigation: ReactNode
  overlays: ReactNode
  surface?: "default" | "home"
}

export function CommunityShell({
  header,
  authStatus,
  leftSidebar,
  main,
  rightSidebar,
  footer,
  mobileNavigation,
  overlays,
  surface = "default",
}: CommunityShellProps) {
  return (
    <div className={`app app--public${surface === "home" ? " app--home" : ""}`} id="top">
      {header}
      {authStatus}
      <div className="page-shell">
        {leftSidebar}
        <main className="main-column">{main}</main>
        {rightSidebar}
      </div>
      {footer}
      {mobileNavigation}
      {overlays}
    </div>
  )
}
