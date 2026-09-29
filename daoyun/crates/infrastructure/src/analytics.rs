use crate::Database;
use sqlx::FromRow;
use time::{Date, Duration, OffsetDateTime};
use uuid::Uuid;

#[derive(Debug)]
pub enum AnalyticsError {
    Forbidden,
    Disabled,
    InvalidWindow,
    Database(sqlx::Error),
}
impl From<sqlx::Error> for AnalyticsError {
    fn from(e: sqlx::Error) -> Self {
        Self::Database(e)
    }
}

#[derive(Debug, FromRow)]
pub struct AnalyticsDayRecord {
    pub day: Date,
    pub activity_complete: bool,
    pub content_complete: bool,
    pub new_users: i64,
    pub active_users: i64,
    pub topics: i64,
    pub replies: i64,
    pub points_issued: i64,
    pub points_spent: i64,
}
#[derive(Debug, FromRow)]
pub struct AnalyticsBoardRecord {
    pub board_id: Uuid,
    pub name: String,
    pub topics: i64,
    pub replies: i64,
    pub participants: i64,
}
#[derive(Debug)]
pub struct AnalyticsReportRecord {
    pub started_at: OffsetDateTime,
    pub from: Date,
    pub through: Date,
    pub activity_complete: bool,
    pub content_complete: bool,
    pub new_users: i64,
    pub active_users: i64,
    pub topics: i64,
    pub replies: i64,
    pub points_issued: i64,
    pub points_spent: i64,
    pub retention_eligible: i64,
    pub retention_returned: i64,
    pub days: Vec<AnalyticsDayRecord>,
    pub boards: Vec<AnalyticsBoardRecord>,
}

impl Database {
    pub async fn record_analytics_activity(
        &self,
        user: Uuid,
        day: Date,
    ) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "INSERT INTO analytics_activity(user_id,day) VALUES($1,$2) ON CONFLICT DO NOTHING",
        )
        .bind(user)
        .bind(day)
        .execute(&mut *tx)
        .await?;
        sqlx::query("UPDATE analytics_collection SET activity_confirmed_through=GREATEST(activity_confirmed_through,$1::date-1) WHERE id").bind(day).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(())
    }
    pub async fn recover_analytics_capture(&self, day: Date) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        let confirmed: Date = sqlx::query_scalar(
            "SELECT activity_confirmed_through FROM analytics_collection WHERE id FOR UPDATE",
        )
        .fetch_one(&mut *tx)
        .await?;
        sqlx::query("INSERT INTO analytics_gaps(day,kind) SELECT d::date,'activity' FROM generate_series(($1::date+1)::timestamp,$2::date::timestamp,interval '1 day') d ON CONFLICT DO NOTHING").bind(confirmed).bind(day).execute(&mut *tx).await?;
        sqlx::query("UPDATE analytics_collection SET activity_confirmed_through=GREATEST(activity_confirmed_through,$1::date-1) WHERE id").bind(day).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(())
    }
    pub async fn mark_analytics_gap(&self, from: Date, through: Date) -> Result<(), sqlx::Error> {
        sqlx::query("INSERT INTO analytics_gaps(day,kind) SELECT d::date,'activity' FROM generate_series($1::date,$2::date,interval '1 day') d ON CONFLICT DO NOTHING")
   .bind(from).bind(through).execute(&self.pool).await?;
        Ok(())
    }
    pub async fn community_analytics(
        &self,
        actor: Uuid,
        window: i32,
    ) -> Result<AnalyticsReportRecord, AnalyticsError> {
        if ![7, 30, 90].contains(&window) {
            return Err(AnalyticsError::InvalidWindow);
        }
        let mut tx = self.pool.begin().await?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
            .execute(&mut *tx)
            .await?;
        if !crate::authorization::has_permission_with_executor(
            &mut tx,
            actor,
            "community.analytics.read",
            None,
        )
        .await?
        {
            return Err(AnalyticsError::Forbidden);
        }
        let enabled:Option<Uuid>=sqlx::query_scalar("SELECT id FROM plugins WHERE status='enabled' AND capabilities ? 'community.analytics' LIMIT 1 FOR SHARE").fetch_optional(&mut *tx).await?;
        if enabled.is_none() {
            return Err(AnalyticsError::Disabled);
        }
        let now: OffsetDateTime = sqlx::query_scalar("SELECT CURRENT_TIMESTAMP")
            .fetch_one(&mut *tx)
            .await?;
        let through = now.date();
        let from = through - Duration::days(i64::from(window) - 1);
        let (started_at, confirmed_through): (OffsetDateTime, Date) = sqlx::query_as(
            "SELECT started_at,activity_confirmed_through FROM analytics_collection WHERE id",
        )
        .fetch_one(&mut *tx)
        .await?;
        let activity_gap:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM analytics_gaps WHERE kind='activity' AND day BETWEEN $1 AND $2)").bind(from).bind(through).fetch_one(&mut *tx).await?;
        let content_gap:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM analytics_gaps WHERE kind='content' AND day BETWEEN $1 AND $2)").bind(from).bind(through).fetch_one(&mut *tx).await?;
        let days=sqlx::query_as::<_,AnalyticsDayRecord>(
   "WITH days AS (SELECT d::date AS day FROM generate_series($1::date,$2::date,interval '1 day') d)
    SELECT day,
     day > ($3::timestamptz AT TIME ZONE 'UTC')::date AND (day=$2::date OR day<=$4::date) AND NOT EXISTS(SELECT 1 FROM analytics_gaps g WHERE g.day=days.day AND g.kind='activity') AS activity_complete,
     day > ($3::timestamptz AT TIME ZONE 'UTC')::date AND NOT EXISTS(SELECT 1 FROM analytics_gaps g WHERE g.day=days.day AND g.kind='content') AS content_complete,
     (SELECT count(*) FROM users WHERE created_at>=day::timestamp AT TIME ZONE 'UTC' AND created_at<(day+1)::timestamp AT TIME ZONE 'UTC') AS new_users,
     (SELECT count(*) FROM analytics_activity a WHERE a.day=days.day) AS active_users,
     (SELECT count(*) FROM analytics_content_events e WHERE kind='topic' AND happened_at>=day::timestamp AT TIME ZONE 'UTC' AND happened_at<(day+1)::timestamp AT TIME ZONE 'UTC') AS topics,
     (SELECT count(*) FROM analytics_content_events e WHERE kind='reply' AND happened_at>=day::timestamp AT TIME ZONE 'UTC' AND happened_at<(day+1)::timestamp AT TIME ZONE 'UTC') AS replies,
     (SELECT COALESCE(sum(amount) FILTER(WHERE amount>0),0)::bigint FROM point_ledger_entries WHERE created_at>=day::timestamp AT TIME ZONE 'UTC' AND created_at<(day+1)::timestamp AT TIME ZONE 'UTC') AS points_issued,
     (SELECT COALESCE(-sum(amount) FILTER(WHERE amount<0),0)::bigint FROM point_ledger_entries WHERE created_at>=day::timestamp AT TIME ZONE 'UTC' AND created_at<(day+1)::timestamp AT TIME ZONE 'UTC') AS points_spent
    FROM days ORDER BY day"
  ).bind(from).bind(through).bind(started_at).bind(confirmed_through).fetch_all(&mut *tx).await?;
        let active_users: i64 = sqlx::query_scalar(
            "SELECT count(DISTINCT user_id) FROM analytics_activity WHERE day BETWEEN $1 AND $2",
        )
        .bind(from)
        .bind(through)
        .fetch_one(&mut *tx)
        .await?;
        let (retention_eligible,retention_returned):(i64,i64)=sqlx::query_as(
   "WITH cohorts AS (SELECT id,(created_at AT TIME ZONE 'UTC')::date AS day FROM users
     WHERE created_at >= $1::date::timestamp AT TIME ZONE 'UTC'
       AND (created_at AT TIME ZONE 'UTC')::date > ($3::timestamptz AT TIME ZONE 'UTC')::date
       AND (created_at AT TIME ZONE 'UTC')::date + 7 < $2::date AND (created_at AT TIME ZONE 'UTC')::date + 7 <= $4::date),
    complete AS (SELECT * FROM cohorts c WHERE NOT EXISTS(SELECT 1 FROM analytics_gaps g WHERE g.kind='activity' AND g.day BETWEEN c.day AND c.day+7))
    SELECT count(*),count(*) FILTER(WHERE EXISTS(SELECT 1 FROM analytics_activity a WHERE a.user_id=c.id AND a.day=c.day+7)) FROM complete c"
  ).bind(from).bind(through).bind(started_at).bind(confirmed_through).fetch_one(&mut *tx).await?;
        let boards=sqlx::query_as::<_,AnalyticsBoardRecord>(
   "SELECT e.board_id,COALESCE(b.name,'已删除版块')::text AS name,
      count(*) FILTER(WHERE e.kind='topic') AS topics,count(*) FILTER(WHERE e.kind='reply') AS replies,count(DISTINCT e.author_id) AS participants
    FROM analytics_content_events e LEFT JOIN boards b ON b.id=e.board_id
    WHERE e.happened_at >= $1::date::timestamp AT TIME ZONE 'UTC' AND e.happened_at < ($2::date+1)::timestamp AT TIME ZONE 'UTC'
    GROUP BY e.board_id,b.name ORDER BY count(*) DESC,e.board_id LIMIT 20"
  ).bind(from).bind(through).fetch_all(&mut *tx).await?;
        let report = AnalyticsReportRecord {
            started_at,
            from,
            through,
            activity_complete: from > started_at.date()
                && !activity_gap
                && confirmed_through >= through - Duration::days(1),
            content_complete: from > started_at.date() && !content_gap,
            new_users: days.iter().map(|d| d.new_users).sum(),
            active_users,
            topics: days.iter().map(|d| d.topics).sum(),
            replies: days.iter().map(|d| d.replies).sum(),
            points_issued: days.iter().map(|d| d.points_issued).sum(),
            points_spent: days.iter().map(|d| d.points_spent).sum(),
            retention_eligible,
            retention_returned,
            days,
            boards,
        };
        tx.commit().await?;
        Ok(report)
    }
}
