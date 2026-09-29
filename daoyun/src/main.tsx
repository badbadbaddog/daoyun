import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { App } from "./App"
import "@daoyun/design-tokens/tokens.css"
import "./styles.css"
import "./styles.community.css"
import "./styles.admin.css"
import "./styles.home.css"
import "./styles.boards.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
