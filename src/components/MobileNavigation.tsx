import { Bell, Compass, Home, Plus, UserRound } from "lucide-react"

interface MobileNavigationProps {
  onCompose: () => void
}

export function MobileNavigation({ onCompose }: MobileNavigationProps) {
  return (
    <nav className="mobile-navigation" aria-label="移动端导航">
      <a className="mobile-nav-link mobile-nav-link--active" href="#top" aria-label="首页"><Home size={20} /><span>首页</span></a>
      <a className="mobile-nav-link" href="#discover" aria-label="发现"><Compass size={20} /><span>发现</span></a>
      <button className="mobile-create" type="button" onClick={onCompose} aria-label="从移动导航发布新主题"><Plus size={23} /></button>
      <a className="mobile-nav-link" href="#notifications" aria-label="通知"><Bell size={20} /><span>通知</span></a>
      <a className="mobile-nav-link" href="#profile" aria-label="我的"><UserRound size={20} /><span>我的</span></a>
    </nav>
  )
}
