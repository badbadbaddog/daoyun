import { spawn, spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"

import {
  DEFAULT_LOCAL_API_URL,
  DEFAULT_LOCAL_DATABASE_URL,
  LOCAL_MODERATION_FIXTURE,
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

export function buildLocalQuotaResetSql(accounts = LOCAL_TEST_ACCOUNTS) {
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error("At least one local test account is required to reset quota usage.")
  }
  const usernames = accounts.map((account) => sqlLiteral(account.username)).join(", ")
  return `
    DELETE FROM community_quota_usage AS usage
    USING users AS account
    WHERE usage.user_id = account.id
      AND account.username IN (${usernames});
  `
}

export function buildLocalModerationFixtureSql(fixture = LOCAL_MODERATION_FIXTURE) {
  const sourceBoardSlug = sqlLiteral(fixture.sourceBoardSlug)
  const targetBoardSlug = sqlLiteral(fixture.targetBoardSlug)
  const targetTopicCount = Number(fixture.targetTopicCount)
  const historyEntryCount = Number(fixture.historyEntryCount)
  if (!Number.isSafeInteger(targetTopicCount) || targetTopicCount < 21) {
    throw new Error("The local moderation fixture needs at least 21 target topics.")
  }
  if (!Number.isSafeInteger(historyEntryCount) || historyEntryCount < 21) {
    throw new Error("The local moderation fixture needs at least 21 history entries.")
  }

  return `
    BEGIN;

    INSERT INTO boards (
      id, slug, name, description, icon, tone, position, visibility
    )
    SELECT
      '019fd000-0000-7000-8000-000000000102'::uuid,
      ${targetBoardSlug},
      '产品反馈',
      '用于本地主题治理、分页与跨板块移动验收。',
      'message-square-warning',
      'blue',
      1,
      'public'
    WHERE NOT EXISTS (
      SELECT 1 FROM boards WHERE slug = ${targetBoardSlug} AND deleted_at IS NULL
    );

    INSERT INTO topics (
      id, board_id, author_id, title, excerpt, content, status,
      published_at, last_activity_at, reply_count, like_count, view_count,
      moderation_status
    )
    SELECT
      '019fd100-0000-7000-8000-000000000000'::uuid,
      board.id,
      author.id,
      '治理验收：跨板块移动与处理记录',
      '用于验证移动板块、审核备注、冲突反馈和处理记录分页。',
      '这是本地治理工作台的可重复验收主题。',
      'published',
      TIMESTAMPTZ '2026-08-26 09:30:00+08',
      TIMESTAMPTZ '2026-08-26 09:30:00+08',
      0,
      0,
      0,
      'approved'
    FROM boards AS board
    CROSS JOIN users AS author
    WHERE board.slug = ${sourceBoardSlug}
      AND board.deleted_at IS NULL
      AND author.username = 'demo_member'
    ON CONFLICT (id) DO UPDATE SET
      board_id = EXCLUDED.board_id,
      author_id = EXCLUDED.author_id,
      title = EXCLUDED.title,
      excerpt = EXCLUDED.excerpt,
      content = EXCLUDED.content,
      status = 'published',
      moderation_status = 'approved',
      published_at = EXCLUDED.published_at,
      last_activity_at = EXCLUDED.last_activity_at,
      reply_count = EXCLUDED.reply_count,
      like_count = EXCLUDED.like_count,
      view_count = EXCLUDED.view_count,
      featured_at = NULL,
      pinned_at = NULL,
      locked_at = NULL,
      locked_by = NULL,
      deleted_at = NULL,
      updated_at = CURRENT_TIMESTAMP;

    WITH fixture_topics AS (
      SELECT
        fixture_index,
        ('019fd100-0000-7000-8000-' || lpad(fixture_index::text, 12, '0'))::uuid AS topic_id
      FROM generate_series(1, ${targetTopicCount}) AS fixture_index
    )
    INSERT INTO topics (
      id, board_id, author_id, title, excerpt, content, status,
      published_at, last_activity_at, reply_count, like_count, view_count,
      moderation_status
    )
    SELECT
      fixture.topic_id,
      board.id,
      author.id,
      '治理分页验收主题 ' || lpad(fixture.fixture_index::text, 2, '0'),
      '第 ' || fixture.fixture_index || ' 条可重复治理数据，用于验证加载更多和紧凑列表。',
      '本地治理分页验收内容 ' || fixture.fixture_index || '。',
      'published',
      TIMESTAMPTZ '2026-08-26 09:00:00+08' - make_interval(hours => fixture.fixture_index),
      TIMESTAMPTZ '2026-08-26 09:00:00+08' - make_interval(hours => fixture.fixture_index),
      0,
      0,
      0,
      'approved'
    FROM fixture_topics AS fixture
    CROSS JOIN boards AS board
    CROSS JOIN users AS author
    WHERE board.slug = ${targetBoardSlug}
      AND board.deleted_at IS NULL
      AND author.username = 'demo_member'
    ON CONFLICT (id) DO UPDATE SET
      board_id = EXCLUDED.board_id,
      author_id = EXCLUDED.author_id,
      title = EXCLUDED.title,
      excerpt = EXCLUDED.excerpt,
      content = EXCLUDED.content,
      status = 'published',
      moderation_status = 'approved',
      published_at = EXCLUDED.published_at,
      last_activity_at = EXCLUDED.last_activity_at,
      reply_count = EXCLUDED.reply_count,
      like_count = EXCLUDED.like_count,
      view_count = EXCLUDED.view_count,
      featured_at = NULL,
      pinned_at = NULL,
      locked_at = NULL,
      locked_by = NULL,
      deleted_at = NULL,
      updated_at = CURRENT_TIMESTAMP;

    WITH fixture_topics AS (
      SELECT 0 AS fixture_index, '019fd100-0000-7000-8000-000000000000'::uuid AS topic_id
      UNION ALL
      SELECT
        fixture_index,
        ('019fd100-0000-7000-8000-' || lpad(fixture_index::text, 12, '0'))::uuid
      FROM generate_series(1, ${targetTopicCount}) AS fixture_index
    )
    INSERT INTO posts (
      id, topic_id, author_id, kind, content, status, revision_count,
      created_at, updated_at, deleted_at
    )
    SELECT
      ('019fd200-0000-7000-8000-' || lpad(fixture.fixture_index::text, 12, '0'))::uuid,
      fixture.topic_id,
      author.id,
      'topic',
      topic.content,
      'published',
      1,
      topic.published_at,
      topic.published_at,
      NULL
    FROM fixture_topics AS fixture
    JOIN topics AS topic ON topic.id = fixture.topic_id
    CROSS JOIN users AS author
    WHERE author.username = 'demo_member'
    ON CONFLICT (id) DO UPDATE SET
      topic_id = EXCLUDED.topic_id,
      author_id = EXCLUDED.author_id,
      content = EXCLUDED.content,
      status = 'published',
      deleted_at = NULL,
      updated_at = EXCLUDED.updated_at;

    WITH fixture_posts AS (
      SELECT
        fixture_index,
        ('019fd200-0000-7000-8000-' || lpad(fixture_index::text, 12, '0'))::uuid AS post_id
      FROM generate_series(0, ${targetTopicCount}) AS fixture_index
    )
    INSERT INTO post_revisions (
      id, post_id, editor_id, revision_number, content, created_at
    )
    SELECT
      ('019fd300-0000-7000-8000-' || lpad(fixture.fixture_index::text, 12, '0'))::uuid,
      fixture.post_id,
      author.id,
      1,
      post.content,
      post.created_at
    FROM fixture_posts AS fixture
    JOIN posts AS post ON post.id = fixture.post_id
    CROSS JOIN users AS author
    WHERE author.username = 'demo_member'
    ON CONFLICT (id) DO UPDATE SET
      post_id = EXCLUDED.post_id,
      editor_id = EXCLUDED.editor_id,
      content = EXCLUDED.content;

    WITH fixture_history AS (
      SELECT
        fixture_index,
        ('019fd400-0000-7000-8000-' || lpad(fixture_index::text, 12, '0'))::uuid AS action_id,
        CASE fixture_index % 3
          WHEN 1 THEN 'approved'
          WHEN 2 THEN 'hidden'
          ELSE 'rejected'
        END AS action
      FROM generate_series(1, ${historyEntryCount}) AS fixture_index
    )
    INSERT INTO topic_moderation_actions (
      id, topic_id, moderator_id, action, reason, created_at
    )
    SELECT
      fixture.action_id,
      '019fd100-0000-7000-8000-000000000000'::uuid,
      moderator.id,
      fixture.action,
      '本地验收记录 ' || lpad(fixture.fixture_index::text, 2, '0'),
      TIMESTAMPTZ '2026-08-26 10:00:00+08' - make_interval(mins => fixture.fixture_index)
    FROM fixture_history AS fixture
    CROSS JOIN users AS moderator
    WHERE moderator.username = 'demo_admin'
    ON CONFLICT (id) DO UPDATE SET
      moderator_id = EXCLUDED.moderator_id,
      action = EXCLUDED.action,
      reason = EXCLUDED.reason,
      created_at = EXCLUDED.created_at;

    UPDATE boards AS board
    SET topic_count = (
      SELECT COUNT(*)
      FROM topics AS topic
      WHERE topic.board_id = board.id
        AND topic.status = 'published'
        AND topic.deleted_at IS NULL
    ), updated_at = CURRENT_TIMESTAMP
    WHERE board.slug IN (${sourceBoardSlug}, ${targetBoardSlug})
      AND board.deleted_at IS NULL;

    COMMIT;
  `
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
    const child = spawn(psqlPath, buildPsqlArguments(databaseUrl), {
      env: { ...process.env, PGCLIENTENCODING: "UTF8" },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    })
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdin.end(query, "utf8")
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

export function buildPsqlArguments(databaseUrl) {
  return [
    `--dbname=${databaseUrl}`,
    "--tuples-only",
    "--no-align",
    "--quiet",
    "--set=ON_ERROR_STOP=1",
    "--file=-",
  ]
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

  await runPsql(psqlPath, options.databaseUrl, buildLocalQuotaResetSql())
  await runPsql(psqlPath, options.databaseUrl, buildLocalModerationFixtureSql())

  console.table(results)
  console.log(`Quota usage reset for local test accounts: ${LOCAL_TEST_ACCOUNTS.map((account) => account.username).join(", ")}.`)
  console.log(`Moderation fixture ready: ${LOCAL_MODERATION_FIXTURE.sourceBoardSlug} -> ${LOCAL_MODERATION_FIXTURE.targetBoardSlug}, ${LOCAL_MODERATION_FIXTURE.targetTopicCount} paginated topics, ${LOCAL_MODERATION_FIXTURE.historyEntryCount} history entries.`)
  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedLocalTestAccounts(parseSeedArguments(process.argv.slice(2))).catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
