import type { Connect } from "vite"

export function createLocalApiProxy(options: {
  target: string
  fetchImpl?: typeof fetch
}): Connect.NextHandleFunction

export function proxyBufferedRequest(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
  target: string,
  fetchImpl?: typeof fetch,
): void
