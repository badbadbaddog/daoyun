import type { BrandLink } from "../api/admin"

interface SiteFooterProps {
  siteName: string
  text: string | null
  links: BrandLink[]
}

export function SiteFooter({ siteName, text, links }: SiteFooterProps) {
  return (
    <footer className="site-footer">
      <span>{text || `© 2026 ${siteName}`}</span>
      {links.length > 0 && (
        <nav aria-label="页脚导航">
          {links.map((link) => <a href={link.url} key={`${link.label}-${link.url}`}>{link.label}</a>)}
        </nav>
      )}
    </footer>
  )
}
