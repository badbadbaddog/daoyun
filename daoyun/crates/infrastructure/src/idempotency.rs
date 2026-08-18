use sqlx::{Postgres, Transaction, types::Uuid};

const EXPIRED_PRUNE_BATCH: i64 = 100;

pub(crate) async fn release_expired_key_and_prune(
    transaction: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
    endpoint: &str,
    idempotency_key: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "DELETE FROM idempotency_records
         WHERE user_id = $1 AND endpoint = $2 AND idempotency_key = $3
           AND expires_at <= CURRENT_TIMESTAMP",
    )
    .bind(user_id)
    .bind(endpoint)
    .bind(idempotency_key)
    .execute(&mut **transaction)
    .await?;

    sqlx::query(
        "WITH expired AS (
             SELECT id
             FROM idempotency_records
             WHERE expires_at <= CURRENT_TIMESTAMP
             ORDER BY expires_at, id
             FOR UPDATE SKIP LOCKED
             LIMIT $1
         )
         DELETE FROM idempotency_records AS record
         USING expired
         WHERE record.id = expired.id",
    )
    .bind(EXPIRED_PRUNE_BATCH)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}
