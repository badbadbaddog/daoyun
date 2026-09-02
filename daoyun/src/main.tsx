import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { App } from "./App"
import "@daoyun/design-tokens/tokens.css"
import "./styles.css"
import "./styles.community.css"
import "./styles.admin.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
