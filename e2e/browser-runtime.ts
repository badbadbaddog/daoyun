import { readdirSync, existsSync } from "node:fs"
import { join, win32 } from "node:path"

type BrowserDiscovery = {
  exists: (path: string) => boolean
  listDirectories: (path: string) => string[]
}

const defaultDiscovery: BrowserDiscovery = {
  exists: existsSync,
  listDirectories: (root) => {
    try {
      return readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    } catch {
      return []
    }
  },
}

export function resolveChromiumExecutable(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  discovery: BrowserDiscovery = defaultDiscovery,
): string | undefined {
  const configured = env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?.trim()
  if (configured) return configured
  if (platform !== "win32" || env.CI) return undefined

  const pathJoin = (...parts: string[]) => win32.join(...parts)
  const localAppData = env.LOCALAPPDATA
  if (localAppData) {
    const browserRoot = pathJoin(localAppData, "ms-playwright")
    const browserDirectories = discovery
      .listDirectories(browserRoot)
      .filter((name) => /^chromium-\d+$/.test(name))
      .sort((left, right) => versionNumber(right) - versionNumber(left))

    for (const directory of browserDirectories) {
      const executable = pathJoin(browserRoot, directory, "chrome-win", "chrome.exe")
      if (discovery.exists(executable)) return executable
    }
  }

  const installedChromePaths = [
    env.ProgramFiles,
    env["ProgramFiles(x86)"],
  ].filter((value): value is string => Boolean(value)).flatMap((programFiles) => [
    pathJoin(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
    pathJoin(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
  ])
  return installedChromePaths.find((path) => discovery.exists(path))
}

function versionNumber(name: string): number {
  return Number(name.slice("chromium-".length))
}
