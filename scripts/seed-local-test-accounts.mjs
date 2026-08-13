import { spawn, spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"

import {
  DEFAULT_LOCAL_API_URL,
  DEFAULT_LOCAL_DATABASE_URL,
  LOCAL_TEST_ACCOUNTS,
  assertLoopbackUrl,
  normalizeLocalApiUrl,
} from "./local-development.mjs"

export function parseSeedArguments(arguments_, environment = process.env) {
  let apiBaseUrl = environment.DAOYUN_API_URL ?? DEFAULT_LOCAL_API_URL
  let databaseUrl = environment.DATABASE_URL ?? DEFAULT_LOCAL_DATABASE_URL

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    const value = arguments_[index + 1]
    if (argument === "--api-url" && value) {
      apiBaseUrl = value
      index += 1
    } else if (argument === "--database-url" && value) {
      databaseUrl = value
      index += 1
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`)
    }
  }

  return {
    apiBaseUrl: normalizeLocalApiUrl(apiBaseUrl),
    databaseUrl: assertLoopbackUrl(databaseUrl, ["postgres", "postgresql"], "Database URL").href,
  }
}

export function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`
}

export function isPostgresTrue(value) {
  return value === "true" || value === "t"
}

async function resolvePsql(environment = process.env) {
  const candidates = [
    environment.DAOYUN_PSQL_PATH,
    "psql",
    "C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe",
    "C:\\Program Files (x86)\\PostgreSQL\\16\\bin\\psql.exe",
  ].filter(Boolean)

  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--version"], {
      stdio: "ignore",
      windowsHide: true,
    })
    if (result.status === 0) return candidate
  }

  throw new Error("psql was not found. Set DAOYUN_PSQL_PATH or install PostgreSQL 16 client tools.")
}

function runPsql(psqlPath, databaseUrl, query) {
  return new Promise((resolveQuery, rejectQuery) => {
    const child = spawn(psqlPath, [
      `--dbname=${databaseUrl}`,
      "--tuples-only",
      "--no-align",
      "--quiet",
      "--set=ON_ERROR_STOP=1",
      "--command",
      query,
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.once("error", rejectQuery)
    child.once("close", (code) => {
      if (code === 0) {
        resolveQuery(stdout)
      } else {
        rejectQuery(new Error(`psql failed: ${stderr.trim() || `exit code ${code}`}`))
      }
    })
  })
}

async function scalar(psqlPath, databaseUrl, query) {
  const output = await runPsql(psqlPath, databaseUrl, query)
  return output.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? ""
}

async function ensureApiReady(apiBaseUrl) {
  const response = await fetch(`${apiBaseUrl}/api/v1/health/ready`)
  if (!response.ok) {
    throw new Error(`Local API is not ready (HTTP ${response.status}).`)
  }
}

async function registerAccount(apiBaseUrl, account) {
  const response = await fetch(`${apiBaseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      username: account.username,
      email: account.email,
      display_name: account.displayName,
      password: account.password,
    }),
  })
  if (response.status === 409) return false
  if (!response.ok) {
    throw new Error(`Could not create ${account.username} (HTTP ${response.status}).`)
  }
  return true
}

async function findUserId(psqlPath, databaseUrl, username) {
  return scalar(
    psqlPath,
    databaseUrl,
    `SELECT id::text FROM users WHERE username = ${sqlLiteral(username)} LIMIT 1`,
  )
}

async function clearInitialSession(psqlPath, databaseUrl, userId) {
  await runPsql(
    psqlPath,
    databaseUrl,
    `DELETE FROM sessions WHERE user_id = ${sqlLiteral(userId)}::uuid`,
  )
}

async function ensureRole(psqlPath, databaseUrl, account) {
  if (account.role === "super_admin") {
    await runPsql(psqlPath, databaseUrl, `
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT role.id, permission.id
      FROM roles AS role
      CROSS JOIN permissions AS permission
      WHERE role.key = 'super_admin'
      ON CONFLICT DO NOTHING;

      INSERT INTO role_assignments (id, user_id, role_id, assigned_by)
      SELECT gen_random_uuid(), account.id, role.id, account.id
      FROM users AS account
      INNER JOIN roles AS role ON role.key = 'super_admin'
      WHERE account.username = ${sqlLiteral(account.username)}
      ON CONFLICT DO NOTHING;
    `)
  }

  const assigned = await scalar(psqlPath, databaseUrl, `
    SELECT EXISTS (
      SELECT 1
      FROM role_assignments AS assignment
      INNER JOIN users AS account ON account.id = assignment.user_id
      INNER JOIN roles AS role ON role.id = assignment.role_id
      WHERE account.username = ${sqlLiteral(account.username)}
        AND role.key = ${sqlLiteral(account.role)}
    )::text
  `)
  if (!isPostgresTrue(assigned)) {
    throw new Error(`${account.username} does not have the expected ${account.role} role.`)
  }
}

export async function seedLocalTestAccounts(options = parseSeedArguments([])) {
  const psqlPath = await resolvePsql()
  await ensureApiReady(options.apiBaseUrl)

  const initialized = await scalar(
    psqlPath,
    options.databaseUrl,
    "SELECT is_initialized::text FROM system_state WHERE singleton",
  )
  if (!isPostgresTrue(initialized)) {
    throw new Error("The local DaoYun instance must be initialized before seeding test accounts.")
  }

  const superAdminRoleExists = await scalar(
    psqlPath,
    options.databaseUrl,
    "SELECT EXISTS (SELECT 1 FROM roles WHERE key = 'super_admin')::text",
  )
  if (!isPostgresTrue(superAdminRoleExists)) {
    throw new Error("The local DaoYun instance has no super_admin role.")
  }

  const results = []
  for (const account of LOCAL_TEST_ACCOUNTS) {
    let userId = await findUserId(psqlPath, options.databaseUrl, account.username)
    let status = "reused"
    if (!userId) {
      const created = await registerAccount(options.apiBaseUrl, account)
      userId = await findUserId(psqlPath, options.databaseUrl, account.username)
      if (!userId) {
        throw new Error(`${account.username} was not found after registration.`)
      }
      if (created) {
        await clearInitialSession(psqlPath, options.databaseUrl, userId)
        status = "created"
      }
    }
    await ensureRole(psqlPath, options.databaseUrl, account)
    results.push({ username: account.username, role: account.role, status })
  }

  console.table(results)
  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedLocalTestAccounts(parseSeedArguments(process.argv.slice(2))).catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
