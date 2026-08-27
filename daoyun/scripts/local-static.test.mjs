import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { serveStaticWeb } from "./local-static.mjs"

const temporaryDirectories = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

function createResponseRecorder() {
  const headers = new Map()
  return {
    headers,
    statusCode: 0,
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value)
    },
    end: vi.fn(),
  }
}

describe("serveStaticWeb", () => {
  it("serves built assets with an explicit content length", async () => {
    const directory = await mkdtemp(join(tmpdir(), "daoyun-static-"))
    temporaryDirectories.push(directory)
    await writeFile(join(directory, "index.html"), "<main>DaoYun</main>", "utf8")
    const response = createResponseRecorder()

    await serveStaticWeb({ method: "GET", url: "/" }, response, directory)

    expect(response.statusCode).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/html")
    expect(response.headers.get("content-length")).toBe(String(Buffer.byteLength("<main>DaoYun</main>")))
    expect(response.end).toHaveBeenCalledWith(Buffer.from("<main>DaoYun</main>"))
  })

  it("uses the SPA entry point for client-side routes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "daoyun-static-"))
    temporaryDirectories.push(directory)
    await writeFile(join(directory, "index.html"), "app", "utf8")
    const response = createResponseRecorder()

    await serveStaticWeb({ method: "GET", url: "/topic/example" }, response, directory)

    expect(response.statusCode).toBe(200)
    expect(response.end).toHaveBeenCalledWith(Buffer.from("app"))
  })

  it("returns 404 for a missing built asset instead of serving HTML as JavaScript", async () => {
    const directory = await mkdtemp(join(tmpdir(), "daoyun-static-"))
    temporaryDirectories.push(directory)
    await writeFile(join(directory, "index.html"), "app", "utf8")
    const response = createResponseRecorder()

    await serveStaticWeb({ method: "GET", url: "/assets/missing.js" }, response, directory)

    expect(response.statusCode).toBe(404)
    expect(response.headers.get("content-type")).toContain("text/plain")
  })
})
