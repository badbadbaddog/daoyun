use std::collections::BTreeMap;

use infrastructure::{Database, MIGRATOR};
use serde_json::Value;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

const V2_SCHEMA_VERSION: i64 = 202609160004;
async fn snapshot(pool: &PgPool) -> BTreeMap<String, Value> {
    let mut rows = BTreeMap::new();
    for (table, query) in [
        (
            "users",
            "SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY to_jsonb(row)::text), '[]'::jsonb) FROM users AS row",
        ),
        (
            "membership_accounts",
            "SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY to_jsonb(row)::text), '[]'::jsonb) FROM membership_accounts AS row",
        ),
        (
            "point_ledger_entries",
            "SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY to_jsonb(row)::text), '[]'::jsonb) FROM point_ledger_entries AS row",
        ),
        (
            "experience_accounts",
            "SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY to_jsonb(row)::text), '[]'::jsonb) FROM experience_accounts AS row",
        ),
        (
            "experience_ledger_entries",
            "SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY to_jsonb(row)::text), '[]'::jsonb) FROM experience_ledger_entries AS row",
        ),
        (
            "community_groups",
            "SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY to_jsonb(row)::text), '[]'::jsonb) FROM community_groups AS row",
        ),
        (
            "community_group_memberships",
            "SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY to_jsonb(row)::text), '[]'::jsonb) FROM community_group_memberships AS row",
        ),
        (
            "community_group_permissions",
            "SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY to_jsonb(row)::text), '[]'::jsonb) FROM community_group_permissions AS row",
        ),
        (
            "community_group_quota_rules",
            "SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY to_jsonb(row)::text), '[]'::jsonb) FROM community_group_quota_rules AS row",
        ),
        (
            "roles",
            "SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY to_jsonb(row)::text), '[]'::jsonb) FROM roles AS row",
        ),
        (
            "permissions",
            "SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY to_jsonb(row)::text), '[]'::jsonb) FROM permissions AS row",
        ),
        (
            "role_permissions",
            "SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY to_jsonb(row)::text), '[]'::jsonb) FROM role_permissions AS row",
        ),
        (
            "role_assignments",
            "SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY to_jsonb(row)::text), '[]'::jsonb) FROM role_assignments AS row",
        ),
        (
            "standard_entitlement_types",
            "SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY to_jsonb(row)::text), '[]'::jsonb) FROM standard_entitlement_types AS row",
        ),
        (
            "standard_entitlement_versions",
            "SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY to_jsonb(row)::text), '[]'::jsonb) FROM standard_entitlement_versions AS row",
        ),
        (
            "user_standard_entitlements",
            "SELECT COALESCE(jsonb_agg(to_jsonb(row) - 'granted_ends_at' ORDER BY (to_jsonb(row) - 'granted_ends_at')::text), '[]'::jsonb) FROM user_standard_entitlements AS row",
        ),
    ] {
        rows.insert(
            table.to_owned(),
            sqlx::query_scalar(query).fetch_one(pool).await.unwrap(),
        );
    }
    rows
}

async fn governance_permissions(
    database: &Database,
    user: Uuid,
    scopes: &[Option<Uuid>],
    keys: &[String],
) -> Vec<bool> {
    let mut permissions = Vec::new();
    for scope in scopes {
        for key in keys {
            permissions.push(database.has_permission(user, key, *scope).await.unwrap());
        }
    }
    permissions
}

// AC-X-28: synthetic nonempty V2-schema fixture, never a claim about a historical production database.
#[sqlx::test(migrations = false)]
async fn v2_to_current_upgrade_preserves_nonempty_accounts_grants_ledgers_and_authorization(
    pool: PgPool,
) {
    MIGRATOR.run(&pool).await.unwrap();
    MIGRATOR.undo(&pool, V2_SCHEMA_VERSION).await.unwrap();
    let old_version: i64 =
        sqlx::query_scalar("SELECT max(version) FROM _sqlx_migrations WHERE success")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(old_version, V2_SCHEMA_VERSION);
    let users = [Uuid::now_v7(), Uuid::now_v7()];
    for (index, user) in users.iter().enumerate() {
        let name = format!("upgrade_member_{index}");
        sqlx::query("INSERT INTO users (id, username, email, display_name, status) VALUES ($1, $2, $2 || '@example.com', $2, $3)")
            .bind(user).bind(name).bind(if index == 0 { "active" } else { "restricted" }).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO membership_accounts (user_id, points_balance, lifetime_points, revision) VALUES ($1, $2, $3, 3)")
            .bind(user).bind(if index == 0 { 80_i64 } else { 40 }).bind(if index == 0 { 100_i64 } else { 60 }).execute(&pool).await.unwrap();
        for (amount, balance, key, day) in [
            (
                if index == 0 { 100_i64 } else { 60 },
                if index == 0 { 100_i64 } else { 60 },
                "credit",
                1,
            ),
            (-20, if index == 0 { 80 } else { 40 }, "debit", 2),
        ] {
            sqlx::query("INSERT INTO point_ledger_entries (id, user_id, amount, reason, idempotency_key, balance_after, created_at) VALUES ($1, $2, $3, 'upgrade.fixture', $4, $5, '2026-01-01'::timestamptz + ($6::int * interval '1 day'))")
                .bind(Uuid::now_v7()).bind(user).bind(amount).bind(key).bind(balance).bind(day).execute(&pool).await.unwrap();
        }
    }
    let board = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO boards (id, slug, name) VALUES ($1, 'upgrade-assigned', 'Assigned scope')",
    )
    .bind(board)
    .execute(&pool)
    .await
    .unwrap();
    let other_board = Uuid::now_v7();
    sqlx::query("INSERT INTO boards (id, slug, name) VALUES ($1, 'upgrade-other', 'Other scope')")
        .bind(other_board)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO role_assignments (id, user_id, role_id, scope_id, scope_mode, assigned_by) SELECT $1, $2, id, $3, 'exact', $2 FROM roles WHERE key='board_moderator'")
        .bind(Uuid::now_v7()).bind(users[0]).bind(board).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO community_group_memberships (id, user_id, group_id, membership_kind, source, reason, idempotency_key, granted_by) SELECT $1, $2, id, 'additional', 'upgrade.fixture', 'Upgrade fixture grant', 'upgrade-group', $3 FROM community_groups WHERE internal_key='verified_author'")
        .bind(Uuid::now_v7()).bind(users[0]).bind(users[1]).execute(&pool).await.unwrap();
    let kind = Uuid::now_v7();
    sqlx::query("INSERT INTO standard_entitlement_types (id, internal_key, display_name) VALUES ($1, 'upgrade_vip', 'Upgrade VIP')").bind(kind).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO standard_entitlement_versions (id, entitlement_type_id, version, permission_keys, quotas, created_by) VALUES ($1, $2, 1, ARRAY['topic.poll.create'], '{\"topic.create.daily\":42}', $3)")
        .bind(Uuid::now_v7()).bind(kind).bind(users[0]).execute(&pool).await.unwrap();
    for user in users {
        sqlx::query("INSERT INTO user_standard_entitlements (id, user_id, entitlement_type_id, entitlement_key, type_version, permission_snapshot, quota_snapshot, source, reason, starts_at, ends_at, idempotency_key, granted_by) VALUES ($1, $2, $3, 'upgrade_vip', 1, ARRAY['topic.poll.create'], '{\"topic.create.daily\":42}', 'upgrade_fixture', 'Upgrade fixture grant', '2026-01-01', CASE WHEN $2=$4 THEN NULL ELSE '2090-01-01'::timestamptz END, 'upgrade-vip', $4)")
            .bind(Uuid::now_v7()).bind(user).bind(kind).bind(users[0]).execute(&pool).await.unwrap();
    }
    let nonempty_groups: i64 =
        sqlx::query_scalar("SELECT count(*) FROM community_group_memberships")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(nonempty_groups, 3);
    let before = snapshot(&pool).await;
    let database = Database::from_pool(pool.clone());
    let effective_at = OffsetDateTime::now_utc();
    let keys: Vec<String> =
        sqlx::query_scalar("SELECT permission_key FROM permissions ORDER BY permission_key")
            .fetch_all(&pool)
            .await
            .unwrap();
    let scopes = [None, Some(board), Some(other_board)];
    let mut authorization_before = Vec::new();
    let mut community_before = Vec::new();
    for user in users {
        authorization_before.push(governance_permissions(&database, user, &scopes, &keys).await);
        community_before.push(
            database
                .community_access_snapshot(user, effective_at)
                .await
                .unwrap(),
        );
    }
    assert!(
        database
            .has_permission(users[0], "moderation.topic.pin", Some(board))
            .await
            .unwrap()
    );
    assert!(
        !database
            .has_permission(users[0], "moderation.topic.pin", Some(other_board))
            .await
            .unwrap()
    );
    assert!(
        community_before[0]
            .permission_keys
            .contains("topic.poll.create")
    );
    assert!(!community_before[1].permission_keys.contains("topic.create"));

    MIGRATOR.run(&pool).await.unwrap();
    // Added command metadata has its own invariant; every original business field stays exact.
    let correctly_backfilled: i64 = sqlx::query_scalar("SELECT count(*) FROM user_standard_entitlements WHERE granted_ends_at IS NOT DISTINCT FROM ends_at").fetch_one(&pool).await.unwrap();
    assert_eq!(correctly_backfilled, 2);
    let finite: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM user_standard_entitlements WHERE granted_ends_at IS NOT NULL",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(finite, 1);
    let fabricated_receipts: i64 =
        sqlx::query_scalar("SELECT count(*) FROM standard_entitlement_renewal_receipts")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(fabricated_receipts, 0);
    assert_eq!(
        snapshot(&pool).await,
        before,
        "every preserved row, ID, revision and timestamp must match"
    );
    for (index, user) in users.iter().enumerate() {
        assert_eq!(
            governance_permissions(&database, *user, &scopes, &keys).await,
            authorization_before[index]
        );
        let access = database
            .community_access_snapshot(*user, effective_at)
            .await
            .unwrap();
        assert_eq!(
            access.permission_keys,
            community_before[index].permission_keys
        );
        assert_eq!(
            access.blocked_permission_keys,
            community_before[index].blocked_permission_keys
        );
        assert_eq!(access.quotas, community_before[index].quotas);
        let balance: i64 =
            sqlx::query_scalar("SELECT points_balance FROM membership_accounts WHERE user_id=$1")
                .bind(user)
                .fetch_one(&pool)
                .await
                .unwrap();
        let total: i64 = sqlx::query_scalar(
            "SELECT sum(amount)::bigint FROM point_ledger_entries WHERE user_id=$1",
        )
        .bind(user)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(balance, total);
        let broken_running_balances: i64 = sqlx::query_scalar("SELECT count(*) FROM (SELECT balance_after, sum(amount) OVER (ORDER BY created_at, id) AS running FROM point_ledger_entries WHERE user_id=$1) AS ledger WHERE balance_after <> running")
            .bind(user).fetch_one(&pool).await.unwrap();
        assert_eq!(broken_running_balances, 0);
    }
    let dangling_references: i64 = sqlx::query_scalar(
        "SELECT sum(broken)::bigint FROM (
            SELECT count(*) AS broken FROM community_group_memberships AS m LEFT JOIN users AS u ON u.id=m.user_id LEFT JOIN community_groups AS g ON g.id=m.group_id WHERE u.id IS NULL OR g.id IS NULL
            UNION ALL SELECT count(*) FROM role_assignments AS a LEFT JOIN users AS u ON u.id=a.user_id LEFT JOIN roles AS r ON r.id=a.role_id WHERE u.id IS NULL OR r.id IS NULL
            UNION ALL SELECT count(*) FROM user_standard_entitlements AS e LEFT JOIN users AS u ON u.id=e.user_id LEFT JOIN standard_entitlement_versions AS v ON v.entitlement_type_id=e.entitlement_type_id AND v.version=e.type_version WHERE u.id IS NULL OR v.id IS NULL
            UNION ALL SELECT count(*) FROM point_ledger_entries AS l LEFT JOIN membership_accounts AS a ON a.user_id=l.user_id WHERE a.user_id IS NULL
        ) AS reference_checks"
    ).fetch_one(&pool).await.unwrap();
    assert_eq!(dangling_references, 0);
    MIGRATOR.run(&pool).await.unwrap();
    assert_eq!(
        snapshot(&pool).await,
        before,
        "running migrations again must preserve the same facts"
    );
    MIGRATOR.undo(&pool, V2_SCHEMA_VERSION).await.unwrap();
    assert_eq!(
        snapshot(&pool).await,
        before,
        "schema rollback must preserve these business facts"
    );
    MIGRATOR.run(&pool).await.unwrap();
    assert_eq!(snapshot(&pool).await, before);
}
