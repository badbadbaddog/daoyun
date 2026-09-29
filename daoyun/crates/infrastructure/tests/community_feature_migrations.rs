use infrastructure::MIGRATOR;
use sqlx::PgPool;
#[sqlx::test(migrations = false)]
async fn community_feature_migrations_roll_back_and_reapply_without_state(pool: PgPool) {
    MIGRATOR.run(&pool).await.unwrap();
    for table in [
        "redemption_products",
        "analytics_activity",
        "member_drafts",
        "topic_polls",
    ] {
        assert!(
            sqlx::query_scalar::<_, bool>("SELECT to_regclass($1) IS NOT NULL")
                .bind(table)
                .fetch_one(&pool)
                .await
                .unwrap()
        );
    }
    MIGRATOR.undo(&pool, 202609100002).await.unwrap();
    for table in [
        "redemption_products",
        "analytics_activity",
        "member_drafts",
        "topic_polls",
    ] {
        assert!(
            !sqlx::query_scalar::<_, bool>("SELECT to_regclass($1) IS NOT NULL")
                .bind(table)
                .fetch_one(&pool)
                .await
                .unwrap()
        );
    }
    MIGRATOR.run(&pool).await.unwrap();
}
