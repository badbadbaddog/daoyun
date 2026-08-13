import { Bookmark, Home, MessageCircle, Plus, UserRound } from "lucide-react"

type MobileDestination = "home" | "messages" | "bookmarks" | "profile"

interface MobileNavigationProps {
  onCompose: () => void
  sessionUsername: string | null
  onLogin: () => void
  active: MobileDestination
}

export function MobileNavigation({
  onCompose,
  sessionUsername,
  onLogin,
  active,
}: MobileNavigationProps) {
  return (
    <nav className="mobile-navigation" aria-label="移动端导航">
      <a className={linkClass(active === "home")} href="#top" aria-label="移动端首页"><Home size={20} /><span>首页</span></a>
      <a className={linkClass(active === "messages")} href="#messages" aria-label="移动端私信"><MessageCircle size={20} /><span>私信</span></a>
      <button className="mobile-create" type="button" onClick={onCompose} aria-label="从移动导航发布新主题"><Plus size={23} /></button>
      <a className={linkClass(active === "bookmarks")} href="#bookmarks" aria-label="移动端收藏"><Bookmark size={20} /><span>收藏</span></a>
      {sessionUsername ? (
        <a className={linkClass(active === "profile")} href={`#user/${sessionUsername}`} aria-label="移动端我的"><UserRound size={20} /><span>我的</span></a>
      ) : (
        <button className="mobile-nav-link" type="button" onClick={onLogin} aria-label="移动端登录"><UserRound size={20} /><span>登录</span></button>
      )}
    </nav>
  )
}

function linkClass(active: boolean): string {
  return active ? "mobile-nav-link mobile-nav-link--active" : "mobile-nav-link"
}
