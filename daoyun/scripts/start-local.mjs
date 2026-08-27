import { spawn, spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { createConnection } from "node:net"
import { homedir } from "node:os"
import { dirname, join, posix, resolve, win32 } from "node:path"
import { fileURLToPath } from "node:url"

import {
  DEFAULT_LOCAL_API_URL,
  DEFAULT_LOCAL_DATABASE_URL,
} from "./local-development.mjs"

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectDirectory = resolve(scriptDirectory, "..")
const POSTGRES_PORT = "55433"
const POSTGRES_USER = "daoyun"
const DATABASE_NAME = "daoyun_dev"
const WEB_URL = "http://127.0.0.1:5173/"
const READY_TIMEOUT_MS = 120_000
const POSTGRES_START_TIMEOUT_SECONDS = "120"

export function parseLocalStartArguments(arguments_, environment = process.env) {
  let dataDirectory = environment.DAOYUN_LOCAL_DATA_DIR ?? null
  let postgresBin = environment.DAOYUN_POSTGRES_BIN ?? null
  let openBrowser = environment.DAOYUN_OPEN_BROWSER !== "false"

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    const value = arguments_[index + 1]
    if (argument === "--data-dir" && value) {
      dataDirectory = value
      index += 1
    } else if (argument === "--postgres-bin" && value) {
      postgresBin = value
      index += 1
    } else if (argument === "--no-browser") {
      openBrowser = false
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`)
    }
  }

  return { dataDirectory, openBrowser, postgresBin }
}

export function resolvePersistentDataDirectory({
  environment = process.env,
  platform = process.platform,
  homeDirectory = homedir(),
  explicitDirectory = environment.DAOYUN_LOCAL_DATA_DIR ?? null,
} = {}) {
  const pathApi = platform === "win32" ? win32 : posix
  if (explicitDirectory) {
    if (!pathApi.isAbsolute(explicitDirectory)) {
      throw new Error("PostgreSQL data directory must be an absolute path.")
    }
    return pathApi.normalize(explicitDirectory)
  }

  if (platform === "win32") {
    const localAppData = environment.LOCALAPPDATA || win32.join(homeDirectory, "AppData", "Local")
    return win32.join(localAppData, "DaoYun", "postgresql-16")
  }

  const dataHome = environment.XDG_DATA_HOME || posix.join(homeDirectory, ".local", "share")
  return posix.join(dataHome, "daoyun", "postgresql-16")
}

export function ensureLocalEmailEncryptionKey(dataDirectory, environment = process.env, io = {}) {
  const keyFile = join(dataDirectory, "daoyun-email-encryption.key")
  const exists = io.exists ?? existsSync
  const read = io.read ?? ((path) => readFileSync(path, "utf8"))
  const write = io.write ?? ((path, value) => writeFileSync(path, value, { encoding: "utf8", flag: "wx", mode: 0o600 }))
  const random = io.random ?? (() => randomBytes(32))
  const configured = environment.DAOYUN_SMTP_ENCRYPTION_KEY?.trim()
  const key = configured || (exists(keyFile) ? read(keyFile).trim() : random().toString("base64"))

  if (!/^[A-Za-z0-9+/]{43}=$/.test(key) || Buffer.from(key, "base64").length !== 32) {
    throw new Error("DAOYUN_SMTP_ENCRYPTION_KEY must be a base64-encoded 32-byte key.")
  }
  if (!configured && !exists(keyFile)) write(keyFile, key)
  return key
}

export function buildInitDbArguments(dataDirectory) {
  return [
    "-D",
    dataDirectory,
    "-U",
    POSTGRES_USER,
    "--auth=trust",
    "--encoding=UTF8",
    "--no-locale",
  ]
}

export function buildPostgresStartArguments(dataDirectory, logFile) {
  return [
    "-D",
    dataDirectory,
    "-l",
    logFile,
    "-o",
    `-h 127.0.0.1 -p ${POSTGRES_PORT}`,
    "-w",
    "-t",
    POSTGRES_START_TIMEOUT_SECONDS,
    "start",
  ]
}

export function buildWebInvocation(rootDirectory, nodeExecutable, platform = process.platform) {
  const pathApi = platform === "win32" ? win32 : posix
  return {
    command: nodeExecutable,
    args: [
      pathApi.join(rootDirectory, "node_modules", "vite", "bin", "vite.js"),
      "build",
    ],
  }
}

export function buildGatewayInvocation(rootDirectory, nodeExecutable, platform = process.platform) {
  const pathApi = platform === "win32" ? win32 : posix
  return {
    command: nodeExecutable,
    args: [pathApi.join(rootDirectory, "scripts", "local-gateway.mjs")],
  }
}

export function buildStopInvocation(processId, platform = process.platform) {
  if (platform !== "win32") return null
  return {
    command: "taskkill.exe",
    args: ["/pid", String(processId), "/t", "/f"],
  }
}

export function assertStopCommandSucceeded(result, childStillRunning) {
  if (!childStillRunning) return
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error("Could not stop the local service process tree.")
  }
}

export function requiredPostgresToolNames() {
  return ["postgres", "pg_ctl", "initdb", "pg_isready", "psql", "createdb"]
}

export function assertPostgresVersion(versionText) {
  if (versionText.trim() !== "16") {
    throw new Error(`PostgreSQL 16 data directory required; found version ${versionText.trim() || "unknown"}.`)
  }
}

export function isPostgres16BinaryVersion(versionText) {
  return /(?:PostgreSQL\)?\s+)16(?:\.|\s|$)/i.test(versionText.trim())
}

export function completePostgresStartup(startedByLauncher, prepare, cleanup) {
  try {
    prepare()
  } catch (error) {
    if (startedByLauncher) {
      try {
        cleanup()
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "PostgreSQL preparation failed and cleanup also failed.",
          { cause: error },
        )
      }
    }
    throw error
  }
  return startedByLauncher
}

function isTcpPortOpen(port) {
  return new Promise((resolveCheck) => {
    const socket = createConnection({ host: "127.0.0.1", port })
    const finish = (open) => {
      socket.destroy()
      resolveCheck(open)
    }
    socket.setTimeout(300)
    socket.once("connect", () => finish(true))
    socket.once("error", () => finish(false))
    socket.once("timeout", () => finish(false))
  })
}

export async function assertServicePortsAvailable(checkPort = isTcpPortOpen) {
  for (const port of [3000, 5173]) {
    if (await checkPort(port)) {
      throw new Error(`Port ${port} is already in use. Stop the existing DaoYun service and try again.`)
    }
  }
}

export function isSameDataDirectory(actual, expected, platform = process.platform) {
  const pathApi = platform === "win32" ? win32 : posix
  const normalize = (value) => pathApi.normalize(value.trim()).replace(/[\\/]$/, "")
  const left = normalize(actual)
  const right = normalize(expected)
  return platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right
}

function executableName(name, platform = process.platform) {
  return platform === "win32" ? `${name}.exe` : name
}

function postgresTool(postgresBin, name) {
  return join(postgresBin, executableName(name))
}

function postgresBinCandidates(explicitDirectory, environment = process.env) {
  return [
    explicitDirectory,
    environment.DAOYUN_POSTGRES_BIN,
    process.platform === "win32" ? "C:\\Program Files\\PostgreSQL\\16\\bin" : null,
    process.platform === "win32" ? "C:\\Program Files (x86)\\PostgreSQL\\16\\bin" : null,
    "/usr/local/pgsql/bin",
    "/usr/local/bin",
    "/usr/bin",
  ].filter(Boolean)
}

function resolvePostgresBin(explicitDirectory, environment = process.env) {
  for (const candidate of postgresBinCandidates(explicitDirectory, environment)) {
    if (!requiredPostgresToolNames().every((name) => existsSync(postgresTool(candidate, name)))) {
      continue
    }
    const version = spawnSync(postgresTool(candidate, "postgres"), ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    })
    if (version.status === 0 && isPostgres16BinaryVersion(version.stdout)) {
      return candidate
    }
  }
  throw new Error("PostgreSQL 16 was not found. Set DAOYUN_POSTGRES_BIN to its bin directory.")
}

function runChecked(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: projectDirectory,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const detail = options.capture ? (result.stderr || result.stdout || "").trim() : ""
    throw new Error(`${options.label ?? command} failed${detail ? `: ${detail}` : "."}`)
  }
  return options.capture ? result.stdout.trim() : ""
}

function isPostgresReady(postgresBin) {
  return spawnSync(postgresTool(postgresBin, "pg_isready"), [
    "-h", "127.0.0.1", "-p", POSTGRES_PORT,
  ], { stdio: "ignore", windowsHide: true }).status === 0
}

function queryPostgres(postgresBin, query) {
  return runChecked(postgresTool(postgresBin, "psql"), [
    "-h", "127.0.0.1",
    "-p", POSTGRES_PORT,
    "-U", POSTGRES_USER,
    "-d", "postgres",
    "-Atc", query,
  ], { capture: true, label: "PostgreSQL query" })
}

function verifyPostgresIdentity(postgresBin, dataDirectory) {
  const activeDirectory = queryPostgres(postgresBin, "SHOW data_directory")
  if (!isSameDataDirectory(activeDirectory, dataDirectory)) {
    throw new Error(
      `Port ${POSTGRES_PORT} belongs to another PostgreSQL data directory: ${activeDirectory}. `
      + `Stop that instance before starting DaoYun (${dataDirectory}).`,
    )
  }
}

function ensureDatabase(postgresBin) {
  const exists = queryPostgres(
    postgresBin,
    `SELECT 1 FROM pg_database WHERE datname = '${DATABASE_NAME}'`,
  ) === "1"
  if (exists) return
  runChecked(postgresTool(postgresBin, "createdb"), [
    "-h", "127.0.0.1",
    "-p", POSTGRES_PORT,
    "-U", POSTGRES_USER,
    DATABASE_NAME,
  ], { label: "Database creation" })
}

function ensurePostgres(postgresBin, dataDirectory) {
  mkdirSync(dataDirectory, { recursive: true })
  const versionFile = join(dataDirectory, "PG_VERSION")
  if (!existsSync(versionFile)) {
    if (readdirSync(dataDirectory).length > 0) {
      throw new Error(`Refusing to initialize non-empty PostgreSQL directory: ${dataDirectory}`)
    }
    console.log(`[DaoYun] Initializing persistent PostgreSQL data at ${dataDirectory}`)
    runChecked(postgresTool(postgresBin, "initdb"), buildInitDbArguments(dataDirectory), {
      label: "PostgreSQL initialization",
    })
  } else {
    assertPostgresVersion(readFileSync(versionFile, "utf8"))
  }

  let startedByLauncher = false
  if (!isPostgresReady(postgresBin)) {
    console.log("[DaoYun] Starting PostgreSQL...")
    startedByLauncher = true
    try {
      runChecked(
        postgresTool(postgresBin, "pg_ctl"),
        buildPostgresStartArguments(dataDirectory, join(dataDirectory, "postgres.log")),
        { label: "PostgreSQL startup" },
      )
    } catch (error) {
      if (isPostgresReady(postgresBin)) stopPostgres(postgresBin, dataDirectory)
      throw error
    }
  }

  return completePostgresStartup(startedByLauncher, () => {
    verifyPostgresIdentity(postgresBin, dataDirectory)
    ensureDatabase(postgresBin)
  }, () => stopPostgres(postgresBin, dataDirectory))
}

function spawnService(command, arguments_, environment) {
  const child = spawn(command, arguments_, {
    cwd: projectDirectory,
    env: environment,
    stdio: "inherit",
    windowsHide: false,
  })
  child.once("error", (error) => {
    child.startError = error
    console.error(`[DaoYun] Could not start ${command}: ${error.message}`)
  })
  return child
}

export async function waitForReady(url, label, child, {
  fetchImpl = fetch,
  pollIntervalMs = 500,
  timeoutMs = READY_TIMEOUT_MS,
} = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.startError) {
      throw new Error(`${label} could not start: ${child.startError.message}`)
    }
    if (child.exitCode !== null) {
      throw new Error(`${label} exited before becoming ready (exit code ${child.exitCode}).`)
    }
    try {
      const response = await fetchImpl(url)
      if (response.ok) return
    } catch {
      // The service is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, pollIntervalMs))
  }
  throw new Error(`${label} did not become ready within ${timeoutMs / 1000} seconds.`)
}

export function openLocalSite(url, {
  platform = process.platform,
  runOpen = spawn,
  warn = console.warn,
} = {}) {
  const invocation = platform === "win32"
    ? { command: "cmd.exe", args: ["/d", "/s", "/c", "start", "", url] }
    : platform === "darwin"
      ? { command: "open", args: [url] }
      : { command: "xdg-open", args: [url] }
  const opener = runOpen(invocation.command, invocation.args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  })
  opener.once("error", (error) => {
    warn(`[DaoYun] Could not open the browser automatically: ${error.message}`)
  })
  opener.unref()
}

function waitWithTimeout(promise, timeoutMs, message) {
  return new Promise((resolveWait, rejectWait) => {
    const timer = setTimeout(() => rejectWait(new Error(message)), timeoutMs)
    promise.then((value) => {
      clearTimeout(timer)
      resolveWait(value)
    }, (error) => {
      clearTimeout(timer)
      rejectWait(error)
    })
  })
}

export async function waitForExit(child, {
  platform = process.platform,
  runStop = spawnSync,
  stopFailureGraceMs = 250,
  timeoutMs = 5_000,
} = {}) {
  if (!child || child.exitCode !== null) return
  const exited = new Promise((resolveExit) => child.once("exit", resolveExit))
  const stop = buildStopInvocation(child.pid, platform)
  if (stop) {
    const result = runStop(stop.command, stop.args, { stdio: "ignore", windowsHide: true })
    if (result.error || result.status !== 0) {
      await Promise.race([
        exited,
        new Promise((resolveGrace) => setTimeout(resolveGrace, stopFailureGraceMs)),
      ])
    }
    assertStopCommandSucceeded(result, child.exitCode === null)
  } else if (!child.kill("SIGTERM") && child.exitCode === null) {
    throw new Error(`Could not stop local service process ${child.pid}.`)
  }

  if (child.exitCode !== null) return
  await waitWithTimeout(
    exited,
    timeoutMs,
    `Local service process ${child.pid} did not stop within ${timeoutMs / 1000} seconds.`,
  )
}

function stopPostgres(postgresBin, dataDirectory) {
  if (!isPostgresReady(postgresBin)) return
  runChecked(postgresTool(postgresBin, "pg_ctl"), [
    "-D", dataDirectory, "-w", "-t", "30", "stop", "-m", "fast",
  ], { label: "PostgreSQL shutdown" })
}

export async function startLocal(options = parseLocalStartArguments(process.argv.slice(2))) {
  await assertServicePortsAvailable()
  const dataDirectory = resolvePersistentDataDirectory({
    environment: process.env,
    explicitDirectory: options.dataDirectory,
  })
  const postgresBin = resolvePostgresBin(options.postgresBin)
  const startedPostgres = ensurePostgres(postgresBin, dataDirectory)
  const emailEncryptionKey = ensureLocalEmailEncryptionKey(dataDirectory)
  const childEnvironment = {
    ...process.env,
    DATABASE_URL: DEFAULT_LOCAL_DATABASE_URL,
    DAOYUN_BIND_ADDR: "127.0.0.1:3000",
    DAOYUN_COOKIE_SECURE: "false",
    DAOYUN_SMTP_ENCRYPTION_KEY: emailEncryptionKey,
  }
  let apiChild
  let gatewayChild
  let stopping = false

  const stopAll = async () => {
    if (stopping) return
    stopping = true
    console.log("\n[DaoYun] Stopping local services...")
    const serviceStops = await Promise.allSettled([
      waitForExit(gatewayChild),
      waitForExit(apiChild),
    ])
    let postgresStopError
    try {
      if (startedPostgres) stopPostgres(postgresBin, dataDirectory)
    } catch (error) {
      postgresStopError = error
    }
    const serviceStopError = serviceStops.find((result) => result.status === "rejected")
    if (serviceStopError?.status === "rejected") throw serviceStopError.reason
    if (postgresStopError) throw postgresStopError
  }

  try {
    console.log("[DaoYun] Starting API...")
    apiChild = spawnService(process.execPath, [
      join(scriptDirectory, "start-local-api.mjs"),
      "--database-url", DEFAULT_LOCAL_DATABASE_URL,
      "--bind-address", "127.0.0.1:3000",
    ], childEnvironment)
    await waitForReady(`${DEFAULT_LOCAL_API_URL}/api/v1/health/ready`, "API", apiChild)

    console.log("[DaoYun] Building web app...")
    const web = buildWebInvocation(projectDirectory, process.execPath)
    runChecked(web.command, web.args, { label: "Web build" })

    console.log("[DaoYun] Starting local gateway...")
    const gateway = buildGatewayInvocation(projectDirectory, process.execPath)
    gatewayChild = spawnService(gateway.command, gateway.args, childEnvironment)
    await waitForReady(WEB_URL, "Local gateway", gatewayChild)

    console.log(`[DaoYun] Web: ${WEB_URL}`)
    console.log(`[DaoYun] API: ${DEFAULT_LOCAL_API_URL}/`)
    console.log(`[DaoYun] PostgreSQL: ${DEFAULT_LOCAL_DATABASE_URL}`)
    console.log(`[DaoYun] Data: ${dataDirectory}`)
    console.log("[DaoYun] Press Ctrl+C to stop all services.")
    if (options.openBrowser) openLocalSite(WEB_URL)

    await new Promise((resolveStop, rejectStop) => {
      const requestStop = () => resolveStop()
      process.once("SIGINT", requestStop)
      process.once("SIGTERM", requestStop)
      apiChild.once("exit", (code) => {
        if (!stopping) rejectStop(new Error(`API exited unexpectedly (exit code ${code ?? 1}).`))
      })
      gatewayChild.once("exit", (code) => {
        if (!stopping) rejectStop(new Error(`Local gateway exited unexpectedly (exit code ${code ?? 1}).`))
      })
    })
  } finally {
    await stopAll()
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startLocal().catch((error) => {
    console.error(`[DaoYun] ${error.message}`)
    process.exitCode = 1
  })
}
