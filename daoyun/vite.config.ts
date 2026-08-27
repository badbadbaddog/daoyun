import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    css: true,
    include: [
      "src/**/*.{test,spec}.?(c|m)[jt]s?(x)",
      "e2e/**/*.test.ts",
      "scripts/**/*.test.mjs",
    ],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.git/**", "e2e/**/*.spec.ts"],
  },
})
