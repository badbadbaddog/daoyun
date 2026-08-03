use infrastructure::{Database, MIGRATOR};
use sqlx::{PgPool, types::Uuid};

#[sqlx::test(migrations = false)]
async fn migrations_build_an_uninitialized_singleton_from_an_empty_database(pool: PgPool) {
    let database = Database::from_pool(pool.clone());

    database
        .migrate()
        .await
        .expect("an empty database must migrate successfully");

    let states =
        sqlx::query_as::<_, (bool, bool)>("SELECT singleton, is_initialized FROM system_state")
            .fetch_all(&pool)
            .await
            .expect("system state must be queryable after migrations");

    assert_eq!(states, vec![(true, false)]);
    database
        .check_readiness()
        .await
        .expect("a fully migrated database must be ready");
}

#[sqlx::test(migrations = false)]
async fn readiness_rejects_a_database_with_missing_migrations(pool: PgPool) {
    let database = Database::from_pool(pool);

    let error = database
        .check_readiness()
        .await
        .expect_err("an empty database must not be ready");

    assert_eq!(error.to_string(), "database migration state is not current");
    assert!(MIGRATOR.iter().next().is_some());
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn installation_status_reads_the_database_singleton(pool: PgPool) {
    let database = Database::from_pool(pool.clone());

    assert!(
        !database
            .installation_status()
            .await
            .expect("fresh installation status must be readable")
    );

    sqlx::query(
        "UPDATE system_state \
         SET is_initialized = TRUE, initialized_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP \
         WHERE singleton",
    )
    .execute(&pool)
    .await
    .expect("fixture must mark the installation initialized");

    assert!(
        database
            .installation_status()
            .await
            .expect("initialized status must be readable")
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn public_boards_are_ordered_paginated_and_visibility_filtered(pool: PgPool) {
    let fixtures = [
        (
            "019fc600-0000-7000-8000-000000000001",
            "second",
            "第二板块",
            20,
            "public",
            None,
        ),
        (
            "019fc600-0000-7000-8000-000000000002",
            "first",
            "第一板块",
            10,
            "public",
            None,
        ),
        (
            "019fc600-0000-7000-8000-000000000003",
            "hidden",
            "隐藏板块",
            15,
            "hidden",
            None,
        ),
        (
            "019fc600-0000-7000-8000-000000000004",
            "deleted",
            "已删除板块",
            5,
            "public",
            Some("2026-08-03 00:00:00+00"),
        ),
        (
            "019fc600-0000-7000-8000-000000000005",
            "third",
            "第三板块",
            30,
            "public",
            None,
        ),
    ];

    for (id, slug, name, position, visibility, deleted_at) in fixtures {
        sqlx::query(
            "INSERT INTO boards (id, slug, name, description, icon, tone, position, visibility, deleted_at) \
             VALUES ($1, $2, $3, '', 'messages', 'green', $4, $5, $6::timestamptz)",
        )
        .bind(Uuid::parse_str(id).expect("fixture UUID must be valid"))
        .bind(slug)
        .bind(name)
        .bind(position)
        .bind(visibility)
        .bind(deleted_at)
        .execute(&pool)
        .await
        .expect("board fixture must insert");
    }

    let database = Database::from_pool(pool);
    let first_page = database
        .list_public_boards(None, 2)
        .await
        .expect("first page must load");

    assert_eq!(
        first_page
            .iter()
            .map(|board| board.slug.as_str())
            .collect::<Vec<_>>(),
        vec!["first", "second"]
    );

    let second_page = database
        .list_public_boards(Some(first_page[1].id), 2)
        .await
        .expect("second page must load");

    assert_eq!(
        second_page
            .iter()
            .map(|board| board.slug.as_str())
            .collect::<Vec<_>>(),
        vec!["third"]
    );
}
