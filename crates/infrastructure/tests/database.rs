use infrastructure::{Database, MIGRATOR};
use sqlx::PgPool;

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
