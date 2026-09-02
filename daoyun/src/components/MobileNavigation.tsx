import { Bell, Home, LayoutGrid, Plus, UserRound } from "lucide-react"

type MobileDestination = "home" | "community" | "notifications" | "profile" | "none"

interface MobileNavigationProps {
  onCompose: () => void
  sessionUsername: string | null
  onLogin: () => void
  active: MobileDestination
  showCompose?: boolean
}

export function MobileNavigation({
  onCompose,
  sessionUsername,
  onLogin,
  active,
  showCompose = true,
}: MobileNavigationProps) {
  return (
    <nav className={`mobile-navigation${showCompose ? "" : " mobile-navigation--without-create"}`} aria-label="移动端导航">
      <a className={linkClass(active === "home")} href="#hot" aria-label="移动端首页" aria-current={active === "home" ? "page" : undefined}><Home size={20} /><span>首页</span></a>
      <a className={linkClass(active === "community")} href="#boards" aria-label="移动端社区" aria-current={active === "community" ? "page" : undefined}><LayoutGrid size={20} /><span>社区</span></a>
      {showCompose && <button className="mobile-create" type="button" onClick={onCompose} aria-label="从移动导航发布新主题"><Plus size={23} /></button>}
      <a className={linkClass(active === "notifications")} href="#notifications" aria-label="移动端通知" aria-current={active === "notifications" ? "page" : undefined}><Bell size={20} /><span>通知</span></a>
      {sessionUsername ? (
        <a className={linkClass(active === "profile")} href="#member" aria-label="移动端我的" aria-current={active === "profile" ? "page" : undefined}><UserRound size={20} /><span>我的</span></a>
      ) : (
        <button className="mobile-nav-link" type="button" onClick={onLogin} aria-label="移动端登录"><UserRound size={20} /><span>登录</span></button>
      )}
    </nav>
  )
}

function linkClass(active: boolean): string {
  return active ? "mobile-nav-link mobile-nav-link--active" : "mobile-nav-link"
}
