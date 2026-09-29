import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { CommunityShell } from "./CommunityShell"

const shellContent = {
  header: <header>Header</header>,
  leftSidebar: <aside>Left</aside>,
  main: <section>Main</section>,
  rightSidebar: <aside>Right</aside>,
  footer: <footer>Footer</footer>,
  mobileNavigation: <nav>Mobile</nav>,
  overlays: <div>Overlays</div>,
}

describe("CommunityShell", () => {
  it("always applies the public shell scope and reserves the home scope for home content", () => {
    const { container, rerender } = render(<CommunityShell {...shellContent} />)

    expect(container.firstElementChild).toHaveClass("app", "app--public")
    expect(container.firstElementChild).not.toHaveClass("app--home")

    rerender(<CommunityShell {...shellContent} surface="home" />)

    expect(container.firstElementChild).toHaveClass("app", "app--public", "app--home")
  })
})
