use infrastructure::{AnalyticsError, Database};
use sqlx::PgPool;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

async fn setup(pool: &PgPool) -> (Database, Uuid, Uuid) {
    let admin = Uuid::now_v7();
    let member = Uuid::now_v7();
    for (id, name) in [(admin, "analytics_admin"), (member, "analytics_member")] {
        sqlx::query("INSERT INTO users(id,username,email,display_name,status) VALUES($1,$2,$2||'@test.invalid',$2,'active')").bind(id).bind(name).execute(pool).await.unwrap();
    }
    let role = Uuid::now_v7();
    sqlx::query("INSERT INTO roles(id,key,name,scope) VALUES($1,'analytics_admin','Analytics admin','instance')").bind(role).execute(pool).await.unwrap();
    sqlx::query("INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE permission_key='community.analytics.read'").bind(role).execute(pool).await.unwrap();
    sqlx::query("INSERT INTO role_assignments(id,user_id,role_id,assigned_by) VALUES($1,$2,$3,$2)")
        .bind(Uuid::now_v7())
        .bind(admin)
        .bind(role)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO plugins(id,key,name,version,description,capabilities,component_bytes,component_sha256,status,installed_by,business_api_version,data_scopes,event_subscriptions) VALUES($1,'official_community_analytics','Analytics','0.1.0','','[\"community.analytics\",\"ui.panel\"]',$2,$3,'enabled',$4,'0.1.0','[]','[]')").bind(Uuid::now_v7()).bind(vec![0u8]).bind("a".repeat(64)).bind(admin).execute(pool).await.unwrap();
    (Database::from_pool(pool.clone()), admin, member)
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn analytics_deduplicates_utc_activity_and_d7_requires_complete_cohorts(pool: PgPool) {
    let (db, admin, member) = setup(&pool).await;
    let today = OffsetDateTime::now_utc().date();
    sqlx::query("UPDATE analytics_collection SET started_at=$1")
        .bind((today - Duration::days(30)).midnight().assume_utc())
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE users SET created_at=$1 WHERE id=$2")
        .bind((today - Duration::days(8)).midnight().assume_utc())
        .bind(member)
        .execute(&pool)
        .await
        .unwrap();
    let day = today - Duration::days(1);
    db.record_analytics_activity(member, day).await.unwrap();
    db.record_analytics_activity(member, day).await.unwrap();
    let report = db.community_analytics(admin, 30).await.unwrap();
    assert_eq!(report.active_users, 1);
    assert_eq!(
        (report.retention_eligible, report.retention_returned),
        (1, 1)
    );
    assert_eq!(report.days.last().unwrap().active_users, 0);
    assert!(matches!(
        db.community_analytics(member, 30).await,
        Err(AnalyticsError::Forbidden)
    ));
    assert!(matches!(
        db.community_analytics(admin, 31).await,
        Err(AnalyticsError::InvalidWindow)
    ));
    sqlx::query("INSERT INTO analytics_gaps(day,kind) VALUES($1,'activity')")
        .bind(day)
        .execute(&pool)
        .await
        .unwrap();
    let report = db.community_analytics(admin, 30).await.unwrap();
    assert!(!report.activity_complete);
    assert_eq!(report.retention_eligible, 0);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn published_counts_survive_hiding_and_disabled_plugin_blocks_reports(pool: PgPool) {
    let (db, admin, member) = setup(&pool).await;
    let board = Uuid::now_v7();
    let topic = Uuid::now_v7();
    sqlx::query("INSERT INTO boards(id,slug,name,description,icon,tone,position,visibility) VALUES($1,'analytics','Analytics','','message-circle','blue',0,'public')").bind(board).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO topics(id,board_id,author_id,title,excerpt,content,status,published_at,last_activity_at) VALUES($1,$2,$3,'Title','Body','Body','published',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)").bind(topic).bind(board).bind(member).execute(&pool).await.unwrap();
    sqlx::query("UPDATE topics SET status='hidden',deleted_at=CURRENT_TIMESTAMP WHERE id=$1")
        .bind(topic)
        .execute(&pool)
        .await
        .unwrap();
    let report = db.community_analytics(admin, 7).await.unwrap();
    assert_eq!(report.topics, 1);
    assert_eq!(report.boards[0].participants, 1);
    assert_eq!(report.retention_eligible, 0);
    sqlx::query("UPDATE plugins SET status='disabled'")
        .execute(&pool)
        .await
        .unwrap();
    assert!(matches!(
        db.community_analytics(admin, 7).await,
        Err(AnalyticsError::Disabled)
    ));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn restarting_capture_marks_unconfirmed_days_as_incomplete(pool: PgPool) {
    let (db, admin, member) = setup(&pool).await;
    let today = OffsetDateTime::now_utc().date();
    sqlx::query("UPDATE analytics_collection SET started_at=$1,activity_confirmed_through=$2")
        .bind((today - Duration::days(30)).midnight().assume_utc())
        .bind(today - Duration::days(3))
        .execute(&pool)
        .await
        .unwrap();
    db.recover_analytics_capture(today).await.unwrap();
    let report = db.community_analytics(admin, 7).await.unwrap();
    assert!(!report.activity_complete);
    assert!(!report.days[4].activity_complete);
    assert!(!report.days[5].activity_complete);
    db.record_analytics_activity(member, today).await.unwrap();
    assert_eq!(
        db.community_analytics(admin, 7).await.unwrap().active_users,
        1
    );
}
