import { afterEach, describe, expect, it } from "vitest"

import {
  consumeOidcSettingsReturn,
  rememberOidcSettingsReturn,
} from "./oidcSettingsReturn"

afterEach(() => {
  sessionStorage.clear()
})

describe("OIDC settings return state", () => {
  it("round-trips a short-lived username once", () => {
    rememberOidcSettingsReturn("member", 1_000)

    expect(consumeOidcSettingsReturn(1_001)).toBe("member")
    expect(consumeOidcSettingsReturn(1_002)).toBeNull()
  })

  it("rejects malformed, mismatched and expired values", () => {
    rememberOidcSettingsReturn("Member", 1_000)
    expect(consumeOidcSettingsReturn(1_001)).toBeNull()

    rememberOidcSettingsReturn("member", 1_000)
    expect(consumeOidcSettingsReturn(1_000 + 10 * 60 * 1_000 + 1)).toBeNull()

    sessionStorage.setItem("daoyun-oidc-settings-return", "not-json")
    expect(consumeOidcSettingsReturn(1_001)).toBeNull()
  })
})
