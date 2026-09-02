import { describe, expect, it } from "vitest"

import {
  DEFAULT_LOCAL_API_URL,
  DEFAULT_LOCAL_DATABASE_URL,
  LOCAL_MODERATION_FIXTURE,
  LOCAL_TEST_ACCOUNTS,
  assertLoopbackUrl,
} from "./local-development.mjs"
import {
  buildLocalModerationFixtureSql,
  buildLocalQuotaResetSql,
  buildPsqlArguments,
  isPostgresTrue,
  parseSeedArguments,
  sqlLiteral,
} from "./seed-local-test-accounts.mjs"
import {
  buildLocalApiEnvironment,
  buildCargoInvocation,
  parseStartArguments,
  resolveCargoInvocation,
} from "./start-local-api.mjs"

describe("local development configuration", () => {
  it("keeps the API and database defaults on loopback interfaces", () => {
    expect(assertLoopbackUrl(DEFAULT_LOCAL_API_URL, ["http", "https"], "API URL").hostname).toBe("127.0.0.1")
    expect(assertLoopbackUrl(DEFAULT_LOCAL_DATABASE_URL, ["postgres", "postgresql"], "database URL").hostname).toBe("127.0.0.1")
    expect(() => assertLoopbackUrl("https://example.com", ["http", "https"], "API URL")).toThrow("loopback")
  })

  it("defines exactly one reusable administrator and one reusable member", () => {
    expect(LOCAL_TEST_ACCOUNTS).toEqual([
      expect.objectContaining({ username: "demo_admin", role: "super_admin" }),
      expect.objectContaining({ username: "demo_member", role: "member" }),
    ])
    expect(new Set(LOCAL_TEST_ACCOUNTS.map((account) => account.username)).size).toBe(2)
  })

  it("resets persisted quota usage only for the dedicated local test accounts", () => {
    const sql = buildLocalQuotaResetSql(LOCAL_TEST_ACCOUNTS)
    expect(sql).toContain("DELETE FROM community_quota_usage")
    expect(sql).toContain("account.username IN ('demo_admin', 'demo_member')")
    expect(sql).not.toContain("TRUNCATE")
    expect(() => buildLocalQuotaResetSql([])).toThrow("At least one local test account")
  })

  it("defines a repeatable moderation fixture with a move target and paginated data", () => {
    expect(LOCAL_MODERATION_FIXTURE).toEqual(expect.objectContaining({
      sourceBoardSlug: "general",
      targetBoardSlug: "feedback",
      targetTopicCount: 24,
      historyEntryCount: 23,
    }))

    const sql = buildLocalModerationFixtureSql(LOCAL_MODERATION_FIXTURE)
    expect(sql).toContain("generate_series(1, 24)")
    expect(sql).toContain("generate_series(1, 23)")
    expect(sql).toContain("topic_moderation_actions")
    expect(sql).toContain("ON CONFLICT (id) DO UPDATE")
    expect(sql).not.toContain("fixture.fixture_index % 6")
    expect(sql).not.toContain("fixture.fixture_index * 2")
    expect(sql).not.toContain("fixture.fixture_index * 37")
  })

  it("sends UTF-8 seed SQL through psql standard input instead of a Windows command argument", () => {
    const arguments_ = buildPsqlArguments(DEFAULT_LOCAL_DATABASE_URL)
    expect(arguments_).toContain("--file=-")
    expect(arguments_).not.toContain("--command")
  })

  it("rejects non-local overrides before it can issue insecure local credentials", () => {
    expect(() => parseStartArguments(["--database-url", "postgresql://db.example.com/daoyun"], {}))
      .toThrow("loopback")
    expect(() => parseSeedArguments(["--api-url", "https://api.example.com"], {}))
      .toThrow("loopback")
  })

  it("accepts explicit local overrides and keeps SQL literals quoted", () => {
    expect(parseStartArguments([
      "--database-url",
      "postgresql://daoyun@localhost:55433/daoyun_dev",
      "--bind-address",
      "localhost:3001",
    ], {})).toEqual({
      databaseUrl: "postgresql://daoyun@localhost:55433/daoyun_dev",
      bindAddress: "localhost:3001",
    })
    expect(parseSeedArguments([
      "--api-url",
      "http://localhost:3001",
      "--database-url",
      "postgresql://daoyun@localhost:55433/daoyun_dev",
    ], {})).toEqual({
      apiBaseUrl: "http://localhost:3001",
      databaseUrl: "postgresql://daoyun@localhost:55433/daoyun_dev",
    })
    expect(sqlLiteral("demo'o")).toBe("'demo''o'")
  })

  it("always forces non-secure cookies for the loopback HTTP API", () => {
    expect(buildLocalApiEnvironment({ DAOYUN_COOKIE_SECURE: "true" }, {
      databaseUrl: DEFAULT_LOCAL_DATABASE_URL,
      bindAddress: "127.0.0.1:3000",
    }).DAOYUN_COOKIE_SECURE).toBe("false")
  })

  it("selects the installed GNU toolchain when Windows has no MSVC linker", () => {
    expect(buildCargoInvocation(null)).toEqual({ command: "cargo", args: [] })
    expect(buildCargoInvocation("1.94.1-x86_64-pc-windows-gnu")).toEqual({
      command: "rustup",
      args: ["run", "1.94.1-x86_64-pc-windows-gnu", "cargo"],
    })
    expect(resolveCargoInvocation({
      platform: "win32",
      rustToolchain: null,
      msvcLinkerAvailable: false,
      gnuToolchainAvailable: true,
      gnuToolchain: "1.94.1-x86_64-pc-windows-gnu",
      mingwBin: "C:\\msys64\\mingw64\\bin",
    })).toEqual({
      command: "rustup",
      args: ["run", "1.94.1-x86_64-pc-windows-gnu", "cargo"],
      mingwBin: "C:\\msys64\\mingw64\\bin",
    })
  })

  it("accepts PostgreSQL boolean text returned by psql", () => {
    expect(isPostgresTrue("true")).toBe(true)
    expect(isPostgresTrue("t")).toBe(true)
    expect(isPostgresTrue("false")).toBe(false)
  })
})
