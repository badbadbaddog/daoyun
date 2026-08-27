import { describe, expect, it } from "vitest"
import { EventEmitter } from "node:events"

import {
  assertPostgresVersion,
  assertServicePortsAvailable,
  assertStopCommandSucceeded,
  buildInitDbArguments,
  buildGatewayInvocation,
  buildPostgresStartArguments,
  buildStopInvocation,
  buildWebInvocation,
  completePostgresStartup,
  ensureLocalEmailEncryptionKey,
  requiredPostgresToolNames,
  isSameDataDirectory,
  isPostgres16BinaryVersion,
  openLocalSite,
  parseLocalStartArguments,
  resolvePersistentDataDirectory,
  waitForExit,
  waitForReady,
} from "./start-local.mjs"

describe("local one-click launcher", () => {
  it("stores PostgreSQL outside build and temporary directories by default", () => {
    expect(resolvePersistentDataDirectory({
      environment: { LOCALAPPDATA: "C:\\Users\\demo\\AppData\\Local" },
      platform: "win32",
      homeDirectory: "C:\\Users\\demo",
    })).toBe("C:\\Users\\demo\\AppData\\Local\\DaoYun\\postgresql-16")

    expect(resolvePersistentDataDirectory({
      environment: { XDG_DATA_HOME: "/home/demo/.data" },
      platform: "linux",
      homeDirectory: "/home/demo",
    })).toBe("/home/demo/.data/daoyun/postgresql-16")
  })

  it("persists one local email encryption key and reuses it across launches", () => {
    let stored = null
    const io = {
      exists: () => stored !== null,
      read: () => stored,
      write: (_path, value) => { stored = value },
      random: () => Buffer.alloc(32, 7),
    }

    const first = ensureLocalEmailEncryptionKey("D:\\DaoYunData", {}, io)
    const second = ensureLocalEmailEncryptionKey("D:\\DaoYunData", {}, io)

    expect(Buffer.from(first, "base64")).toHaveLength(32)
    expect(second).toBe(first)
  })

  it("accepts only an absolute explicit PostgreSQL data directory", () => {
    expect(resolvePersistentDataDirectory({
      environment: { DAOYUN_LOCAL_DATA_DIR: "D:\\DaoYunData" },
      platform: "win32",
      homeDirectory: "C:\\Users\\demo",
    })).toBe("D:\\DaoYunData")

    expect(() => resolvePersistentDataDirectory({
      environment: { DAOYUN_LOCAL_DATA_DIR: "target/postgres" },
      platform: "linux",
      homeDirectory: "/home/demo",
    })).toThrow("absolute")
  })

  it("parses browser and PostgreSQL binary overrides without accepting unknown flags", () => {
    expect(parseLocalStartArguments([
      "--no-browser",
      "--postgres-bin",
      "C:\\PostgreSQL\\16\\bin",
      "--data-dir",
      "D:\\DaoYunData",
    ], {})).toEqual({
      dataDirectory: "D:\\DaoYunData",
      openBrowser: false,
      postgresBin: "C:\\PostgreSQL\\16\\bin",
    })

    expect(() => parseLocalStartArguments(["--reset-database"], {}))
      .toThrow("Unknown or incomplete argument")
  })

  it("builds loopback-only PostgreSQL initialization and start arguments", () => {
    expect(buildInitDbArguments("D:\\DaoYunData")).toEqual([
      "-D",
      "D:\\DaoYunData",
      "-U",
      "daoyun",
      "--auth=trust",
      "--encoding=UTF8",
      "--no-locale",
    ])
    expect(buildPostgresStartArguments("D:\\DaoYunData", "D:\\DaoYunData\\postgres.log")).toEqual([
      "-D",
      "D:\\DaoYunData",
      "-l",
      "D:\\DaoYunData\\postgres.log",
      "-o",
      "-h 127.0.0.1 -p 55433",
      "-w",
      "-t",
      "120",
      "start",
    ])
  })

  it("builds the web app with Node instead of an interactive package-manager shim", () => {
    expect(buildWebInvocation("C:\\repo", "C:\\node.exe", "win32")).toEqual({
      command: "C:\\node.exe",
      args: ["C:\\repo\\node_modules\\vite\\bin\\vite.js", "build"],
    })
    expect(buildWebInvocation("/repo", "/usr/bin/node", "linux")).toEqual({
      command: "/usr/bin/node",
      args: ["/repo/node_modules/vite/bin/vite.js", "build"],
    })
  })

  it("starts the local gateway as a managed Node service", () => {
    expect(buildGatewayInvocation("C:\\repo", "C:\\node.exe", "win32")).toEqual({
      command: "C:\\node.exe",
      args: ["C:\\repo\\scripts\\local-gateway.mjs"],
    })
    expect(buildGatewayInvocation("/repo", "/usr/bin/node", "linux")).toEqual({
      command: "/usr/bin/node",
      args: ["/repo/scripts/local-gateway.mjs"],
    })
  })

  it("stops the complete Windows service process tree without an interactive prompt", () => {
    expect(buildStopInvocation(4321, "win32")).toEqual({
      command: "taskkill.exe",
      args: ["/pid", "4321", "/t", "/f"],
    })
    expect(buildStopInvocation(4321, "linux")).toBeNull()
    expect(() => assertStopCommandSucceeded({ error: null, status: 1 }, true))
      .toThrow("Could not stop")
    expect(() => assertStopCommandSucceeded({ error: null, status: 1 }, false))
      .not.toThrow()
  })

  it("accepts a failed taskkill when the child already exited from Ctrl+C", async () => {
    const child = new EventEmitter()
    child.exitCode = null
    child.pid = 4321
    child.kill = () => true

    await expect(waitForExit(child, {
      platform: "win32",
      runStop: () => {
        queueMicrotask(() => {
          child.exitCode = 0
          child.emit("exit", 0)
        })
        return { error: null, status: 1 }
      },
      stopFailureGraceMs: 10,
      timeoutMs: 20,
    })).resolves.toBeUndefined()
  })

  it("reports service spawn errors without waiting for the readiness timeout", async () => {
    const child = new EventEmitter()
    child.exitCode = null
    child.startError = new Error("vite executable missing")
    await expect(waitForReady("http://127.0.0.1:5173/", "Web app", child, {
      fetchImpl: async () => ({ ok: false }),
      pollIntervalMs: 1,
      timeoutMs: 20,
    })).rejects.toThrow("vite executable missing")
  })

  it("treats browser opening as optional when the platform opener is unavailable", () => {
    const opener = new EventEmitter()
    opener.unref = () => {}
    let warning = ""
    openLocalSite("http://127.0.0.1:5173/", {
      platform: "linux",
      runOpen: () => opener,
      warn: (message) => { warning = message },
    })
    opener.emit("error", new Error("xdg-open missing"))
    expect(warning).toContain("Could not open the browser")
  })

  it("rejects occupied application ports before starting any service", async () => {
    await expect(assertServicePortsAvailable(async (port) => port === 3000))
      .rejects.toThrow("3000")
    const checkedPorts = []
    await expect(assertServicePortsAvailable(async (port) => {
      checkedPorts.push(port)
      return false
    })).resolves.toBeUndefined()
    expect(checkedPorts).toEqual([3000, 5173])
  })

  it("cleans up PostgreSQL when post-start initialization fails", () => {
    let stopped = false
    expect(() => completePostgresStartup(true, () => {
      throw new Error("database creation failed")
    }, () => {
      stopped = true
    })).toThrow("database creation failed")
    expect(stopped).toBe(true)

    expect(() => completePostgresStartup(true, () => {
      throw new Error("database creation failed")
    }, () => {
      throw new Error("shutdown failed")
    })).toThrow(AggregateError)
  })

  it("requires every PostgreSQL tool and an exact PostgreSQL 16 data directory", () => {
    expect(requiredPostgresToolNames()).toEqual([
      "postgres",
      "pg_ctl",
      "initdb",
      "pg_isready",
      "psql",
      "createdb",
    ])
    expect(() => assertPostgresVersion("16\n")).not.toThrow()
    expect(() => assertPostgresVersion("15\n")).toThrow("PostgreSQL 16")
    expect(isPostgres16BinaryVersion("postgres (PostgreSQL) 16.12")).toBe(true)
    expect(isPostgres16BinaryVersion("postgres (PostgreSQL) 17.2")).toBe(false)
  })

  it("compares PostgreSQL data directories using platform path rules", () => {
    expect(isSameDataDirectory(
      "C:\\Users\\DEMO\\AppData\\Local\\DaoYun\\postgresql-16",
      "C:\\Users\\demo\\AppData\\Local\\DaoYun\\postgresql-16\\",
      "win32",
    )).toBe(true)
    expect(isSameDataDirectory("/srv/daoyun-a", "/srv/daoyun-b", "linux")).toBe(false)
  })
})
