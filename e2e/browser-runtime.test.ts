import { describe, expect, it } from "vitest"

import { resolveChromiumExecutable } from "./browser-runtime"

describe("resolveChromiumExecutable", () => {
  it("uses an explicitly configured executable path", () => {
    expect(resolveChromiumExecutable(
      { PLAYWRIGHT_CHROMIUM_EXECUTABLE: "C:/custom/chrome.exe" },
      "win32",
    )).toBe("C:/custom/chrome.exe")
  })

  it("finds the newest installed Playwright Chromium on Windows", () => {
    const files = new Set([
      "C:\\Users\\test\\AppData\\Local\\ms-playwright\\chromium-1187\\chrome-win\\chrome.exe",
      "C:\\Users\\test\\AppData\\Local\\ms-playwright\\chromium-1200\\chrome-win\\chrome.exe",
    ])
    const directories = ["chromium-1187", "chromium-1200", "chromium_headless_shell-1234"]

    expect(resolveChromiumExecutable(
      { LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" },
      "win32",
      {
        exists: (path) => files.has(path),
        listDirectories: () => directories,
      },
    )).toBe("C:\\Users\\test\\AppData\\Local\\ms-playwright\\chromium-1200\\chrome-win\\chrome.exe")
  })

  it("does not scan Windows install paths on CI or non-Windows hosts", () => {
    const options = {
      exists: () => true,
      listDirectories: () => ["chromium-1187"],
    }
    expect(resolveChromiumExecutable({ CI: "true", LOCALAPPDATA: "C:/local" }, "win32", options))
      .toBeUndefined()
    expect(resolveChromiumExecutable({ LOCALAPPDATA: "/local" }, "linux", options))
      .toBeUndefined()
  })
})
