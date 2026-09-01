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
}: CommunityShellProps) {
  return (
    <div className="app" id="top">
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
