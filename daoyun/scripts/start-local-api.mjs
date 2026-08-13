import { spawn, spawnSync } from "node:child_process"
import { delimiter, dirname, join, resolve } from "node:path"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

import {
  DEFAULT_LOCAL_BIND_ADDRESS,
  DEFAULT_LOCAL_DATABASE_URL,
  assertLoopbackBindAddress,
  assertLoopbackUrl,
} from "./local-development.mjs"

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectDirectory = resolve(scriptDirectory, "..")
const DEFAULT_GNU_TOOLCHAIN = "1.94.1-x86_64-pc-windows-gnu"
const DEFAULT_MINGW_BIN = "C:\\msys64\\mingw64\\bin"

export function parseStartArguments(arguments_, environment = process.env) {
  let databaseUrl = environment.DATABASE_URL ?? DEFAULT_LOCAL_DATABASE_URL
  let bindAddress = environment.DAOYUN_BIND_ADDR ?? DEFAULT_LOCAL_BIND_ADDRESS

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    const value = arguments_[index + 1]
    if (argument === "--database-url" && value) {
      databaseUrl = value
      index += 1
    } else if (argument === "--bind-address" && value) {
      bindAddress = value
      index += 1
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`)
    }
  }

  assertLoopbackUrl(databaseUrl, ["postgres", "postgresql"], "Database URL")
  assertLoopbackBindAddress(bindAddress)
  return { databaseUrl, bindAddress }
}

export function buildLocalApiEnvironment(environment, options) {
  return {
    ...environment,
    DATABASE_URL: options.databaseUrl,
    DAOYUN_BIND_ADDR: options.bindAddress,
    DAOYUN_COOKIE_SECURE: "false",
  }
}

export function buildCargoInvocation(toolchain) {
  return toolchain
    ? { command: "rustup", args: ["run", toolchain, "cargo"] }
    : { command: "cargo", args: [] }
}

function commandSucceeded(command, arguments_) {
  return spawnSync(command, arguments_, { stdio: "ignore", windowsHide: true }).status === 0
}

function installedToolchain(toolchain) {
  const result = spawnSync("rustup", ["toolchain", "list"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  })
  if (result.status !== 0) return false
  return result.stdout.split(/\r?\n/).some((line) => {
    const normalized = line.trim()
    return normalized === toolchain || normalized.startsWith(`${toolchain} `)
  })
}

export function resolveCargoInvocation({
  platform = process.platform,
  rustToolchain = process.env.DAOYUN_RUST_TOOLCHAIN ?? null,
  msvcLinkerAvailable,
  gnuToolchain = process.env.DAOYUN_GNU_TOOLCHAIN ?? DEFAULT_GNU_TOOLCHAIN,
  gnuToolchainAvailable,
  mingwBin = process.env.DAOYUN_MINGW_BIN ?? DEFAULT_MINGW_BIN,
} = {}) {
  if (rustToolchain) {
    const invocation = buildCargoInvocation(rustToolchain)
    return rustToolchain.endsWith("-gnu") ? { ...invocation, mingwBin } : invocation
  }

  if (platform !== "win32") return buildCargoInvocation(null)

  const hasMsvcLinker = msvcLinkerAvailable ?? commandSucceeded("where.exe", ["link.exe"])
  if (hasMsvcLinker) return buildCargoInvocation(null)

  const hasGnuToolchain = gnuToolchainAvailable ?? (
    installedToolchain(gnuToolchain)
      && (existsSync(join(mingwBin, "gcc.exe")) || commandSucceeded("gcc", ["--version"]))
  )
  if (!hasGnuToolchain) {
    throw new Error(
      "No Windows Rust linker is available. Install Visual C++ Build Tools or the configured GNU toolchain.",
    )
  }

  return { ...buildCargoInvocation(gnuToolchain), mingwBin }
}

export async function startLocalApi(options) {
  const cargo = resolveCargoInvocation()
  const childEnvironment = buildLocalApiEnvironment(process.env, options)
  if (cargo.mingwBin) {
    const pathKey = Object.keys(childEnvironment).find((key) => key.toLowerCase() === "path") ?? "PATH"
    childEnvironment[pathKey] = `${cargo.mingwBin}${delimiter}${childEnvironment[pathKey] ?? ""}`
  }
  const child = spawn(cargo.command, [...cargo.args, "run", "-p", "daoyun-api"], {
    cwd: projectDirectory,
    env: childEnvironment,
    stdio: "inherit",
    windowsHide: false,
  })

  const forwardSignal = (signal) => {
    if (!child.killed) child.kill(signal)
  }
  process.once("SIGINT", () => forwardSignal("SIGINT"))
  process.once("SIGTERM", () => forwardSignal("SIGTERM"))

  const exitCode = await new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit)
    child.once("exit", (code) => resolveExit(code ?? 1))
  })
  if (exitCode !== 0) {
    throw new Error(`Local API exited with code ${exitCode}.`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startLocalApi(parseStartArguments(process.argv.slice(2))).catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
