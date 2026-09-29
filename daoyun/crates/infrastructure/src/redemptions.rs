use serde_json::{Value, json};
use sqlx::{FromRow, PgConnection};
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use crate::Database;
use crate::admin::insert_audit;
use crate::authorization::has_permission_with_executor;
use crate::outbox::enqueue_core_event_in_transaction;

#[derive(Debug)]
pub enum RedemptionError {
    NotFound,
    Forbidden,
    Disabled,
    Conflict,
    InvalidInput,
    InsufficientBalance,
    AlreadyEntitled,
    LimitReached,
    Database(sqlx::Error),
}
impl From<sqlx::Error> for RedemptionError {
    fn from(value: sqlx::Error) -> Self {
        Self::Database(value)
    }
}
#[derive(Debug, Clone, FromRow)]
pub struct RedemptionProductRecord {
    pub id: Uuid,
    pub name: String,
    pub entitlement_type_id: Uuid,
    pub type_version: i32,
    pub price: i64,
    pub duration_days: i32,
    pub per_user_limit: i32,
    pub enabled: bool,
    pub revision: i64,
    pub permission_keys: Vec<String>,
    pub quotas: Value,
    pub unavailable_reason: Option<String>,
}
#[derive(Debug, Clone)]
pub struct PutRedemptionProduct {
    pub id: Uuid,
    pub name: String,
    pub entitlement_type_id: Uuid,
    pub type_version: i32,
    pub price: i64,
    pub duration_days: i32,
    pub per_user_limit: i32,
    pub enabled: bool,
    pub expected_revision: Option<i64>,
}
#[derive(Debug, Clone, FromRow)]
pub struct RedemptionRecord {
    pub id: Uuid,
    pub product_id: Uuid,
    pub product_revision: i64,
    pub product_name: String,
    pub price: i64,
    pub balance_after: i64,
    pub entitlement_id: Uuid,
    pub created_at: OffsetDateTime,
    pub ends_at: OffsetDateTime,
}
async fn provider(conn: &mut PgConnection) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT key FROM plugins WHERE status='enabled' AND capabilities ? 'membership.redemption' FOR SHARE")
        .fetch_optional(conn).await
}
async fn product(
    conn: &mut PgConnection,
    id: Uuid,
) -> Result<RedemptionProductRecord, RedemptionError> {
    sqlx::query_as("SELECT p.id,p.name,p.entitlement_type_id,p.type_version,p.price,p.duration_days,p.per_user_limit,p.enabled,p.revision,v.permission_keys,v.quotas,NULL::text AS unavailable_reason FROM redemption_products p JOIN standard_entitlement_versions v ON v.entitlement_type_id=p.entitlement_type_id AND v.version=p.type_version WHERE p.id=$1")
        .bind(id).fetch_optional(conn).await?.ok_or(RedemptionError::NotFound)
}
impl Database {
    pub async fn redemption_enabled(&self) -> Result<bool, RedemptionError> {
        let mut connection = self.pool.acquire().await?;
        Ok(provider(&mut connection).await?.is_some())
    }
    pub async fn list_redemption_products(
        &self,
        actor: Option<Uuid>,
        admin: bool,
        cursor: Option<Uuid>,
        limit: i64,
    ) -> Result<Vec<RedemptionProductRecord>, RedemptionError> {
        if !(1..=101).contains(&limit) {
            return Err(RedemptionError::InvalidInput);
        }
        let mut tx = self.pool.begin().await?;
        if admin
            && !has_permission_with_executor(
                &mut tx,
                actor.ok_or(RedemptionError::Forbidden)?,
                "membership.redemptions.read",
                None,
            )
            .await?
        {
            return Err(RedemptionError::Forbidden);
        }
        // Historical products remain manageable after disabling a provider.
        let key: Option<String> = sqlx::query_scalar(
            "SELECT key FROM plugins WHERE capabilities ? 'membership.redemption' FOR SHARE",
        )
        .fetch_optional(&mut *tx)
        .await?;
        let records=sqlx::query_as(
            "SELECT p.id,p.name,p.entitlement_type_id,p.type_version,p.price,p.duration_days,p.per_user_limit,p.enabled,p.revision,v.permission_keys,v.quotas,
             CASE WHEN NOT p.enabled OR t.status<>'active' THEN '商品已下架'
             WHEN EXISTS(SELECT 1 FROM user_standard_entitlements e WHERE e.user_id=$1 AND e.entitlement_type_id=p.entitlement_type_id AND e.revoked_at IS NULL AND (e.ends_at IS NULL OR e.ends_at>CURRENT_TIMESTAMP)) THEN '已有同类有效或待生效权益'
             WHEN (SELECT count(*) FROM point_redemptions r WHERE r.user_id=$1 AND r.product_id=p.id)>=p.per_user_limit THEN '已达到兑换上限'
             ELSE NULL END AS unavailable_reason
             FROM redemption_products p JOIN standard_entitlement_versions v ON v.entitlement_type_id=p.entitlement_type_id AND v.version=p.type_version
             JOIN standard_entitlement_types t ON t.id=p.entitlement_type_id
             WHERE p.provider_key=$2 AND ($3 OR (p.enabled AND t.status='active'))
             AND ($4::uuid IS NULL OR p.id<$4) ORDER BY p.id DESC LIMIT $5")
            .bind(actor).bind(key).bind(admin).bind(cursor).bind(limit).fetch_all(&mut *tx).await?;
        tx.commit().await?;
        Ok(records)
    }
    pub async fn put_redemption_product(
        &self,
        actor: Uuid,
        input: PutRedemptionProduct,
    ) -> Result<RedemptionProductRecord, RedemptionError> {
        let name = input.name.trim();
        if !(1..=80).contains(&name.chars().count())
            || name.chars().any(char::is_control)
            || !(1..=1_000_000).contains(&input.price)
            || !(1..=3650).contains(&input.duration_days)
            || !(1..=1000).contains(&input.per_user_limit)
            || input.type_version < 1
            || input.expected_revision.is_some_and(|v| v < 1)
        {
            return Err(RedemptionError::InvalidInput);
        }
        let mut tx = self.pool.begin().await?;
        if !has_permission_with_executor(&mut tx, actor, "membership.redemptions.write", None)
            .await?
        {
            return Err(RedemptionError::Forbidden);
        }
        let key = provider(&mut tx).await?.ok_or(RedemptionError::Disabled)?;
        let valid:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM standard_entitlement_versions v JOIN standard_entitlement_types t ON t.id=v.entitlement_type_id WHERE t.id=$1 AND v.version=$2 AND t.status='active' FOR SHARE OF t,v)")
            .bind(input.entitlement_type_id).bind(input.type_version).fetch_one(&mut *tx).await?;
        if !valid {
            return Err(RedemptionError::InvalidInput);
        }
        let changed = if let Some(revision) = input.expected_revision {
            sqlx::query("UPDATE redemption_products SET name=$3,entitlement_type_id=$4,type_version=$5,price=$6,duration_days=$7,per_user_limit=$8,enabled=$9,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND provider_key=$2 AND revision=$10")
                .bind(input.id).bind(&key).bind(name).bind(input.entitlement_type_id).bind(input.type_version).bind(input.price).bind(input.duration_days).bind(input.per_user_limit).bind(input.enabled).bind(revision).execute(&mut *tx).await?.rows_affected()
        } else {
            sqlx::query("INSERT INTO redemption_products(id,provider_key,name,entitlement_type_id,type_version,price,duration_days,per_user_limit,enabled,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(id) DO NOTHING")
                .bind(input.id).bind(&key).bind(name).bind(input.entitlement_type_id).bind(input.type_version).bind(input.price).bind(input.duration_days).bind(input.per_user_limit).bind(input.enabled).bind(actor).execute(&mut *tx).await?.rows_affected()
        };
        if changed != 1 {
            return Err(RedemptionError::Conflict);
        }
        insert_audit(
            &mut tx,
            actor,
            "membership.redemption.product.write",
            "redemption_product",
            Some(input.id),
            json!({"enabled":input.enabled,"price":input.price}),
        )
        .await?;
        let result = product(&mut tx, input.id).await?;
        tx.commit().await?;
        Ok(result)
    }
    pub async fn list_redemptions(
        &self,
        user: Uuid,
        cursor: Option<Uuid>,
        limit: i64,
    ) -> Result<Vec<RedemptionRecord>, RedemptionError> {
        if !(1..=101).contains(&limit) {
            return Err(RedemptionError::InvalidInput);
        }
        Ok(sqlx::query_as("SELECT id,product_id,product_revision,product_name,price,balance_after,entitlement_id,created_at,ends_at FROM point_redemptions WHERE user_id=$1 AND ($2::uuid IS NULL OR id<$2) ORDER BY id DESC LIMIT $3")
            .bind(user).bind(cursor).bind(limit).fetch_all(&self.pool).await?)
    }
    pub async fn redeem_points(
        &self,
        user: Uuid,
        product_id: Uuid,
        expected_revision: i64,
        key: &str,
    ) -> Result<(RedemptionRecord, bool), RedemptionError> {
        if expected_revision < 1
            || !(1..=128).contains(&key.len())
            || !key
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
        {
            return Err(RedemptionError::InvalidInput);
        }
        let mut tx = self.pool.begin().await?;
        // Serializes a member's redemptions across products and protects account-state changes.
        let status: Option<String> =
            sqlx::query_scalar("SELECT status FROM users WHERE id=$1 FOR UPDATE")
                .bind(user)
                .fetch_optional(&mut *tx)
                .await?;
        if status.as_deref() != Some("active") {
            return Err(RedemptionError::Forbidden);
        }
        let balance: i64 = sqlx::query_scalar(
            "SELECT points_balance FROM membership_accounts WHERE user_id=$1 FOR UPDATE",
        )
        .bind(user)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(RedemptionError::NotFound)?;
        if let Some(existing)=sqlx::query_as::<_,RedemptionRecord>("SELECT id,product_id,product_revision,product_name,price,balance_after,entitlement_id,created_at,ends_at FROM point_redemptions WHERE user_id=$1 AND idempotency_key=$2")
            .bind(user).bind(key).fetch_optional(&mut *tx).await? {
            if existing.product_id!=product_id || existing.product_revision!=expected_revision {return Err(RedemptionError::Conflict);}
            tx.commit().await?; return Ok((existing,false));
        }
        let provider = provider(&mut tx).await?.ok_or(RedemptionError::Disabled)?;
        let locked: Option<Uuid> = sqlx::query_scalar(
            "SELECT id FROM redemption_products WHERE id=$1 AND provider_key=$2 FOR SHARE",
        )
        .bind(product_id)
        .bind(provider)
        .fetch_optional(&mut *tx)
        .await?;
        if locked.is_none() {
            return Err(RedemptionError::NotFound);
        }
        let item = product(&mut tx, product_id).await?;
        if item.revision != expected_revision {
            return Err(RedemptionError::Conflict);
        }
        if !item.enabled {
            return Err(RedemptionError::Disabled);
        }
        let kind:Option<String>=sqlx::query_scalar("SELECT internal_key FROM standard_entitlement_types WHERE id=$1 AND status='active' FOR SHARE")
            .bind(item.entitlement_type_id).fetch_optional(&mut *tx).await?;
        let kind = kind.ok_or(RedemptionError::Disabled)?;
        let already:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM user_standard_entitlements WHERE user_id=$1 AND entitlement_type_id=$2 AND revoked_at IS NULL AND (ends_at IS NULL OR ends_at>CURRENT_TIMESTAMP))")
            .bind(user).bind(item.entitlement_type_id).fetch_one(&mut *tx).await?;
        if already {
            return Err(RedemptionError::AlreadyEntitled);
        }
        let used: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM point_redemptions WHERE user_id=$1 AND product_id=$2",
        )
        .bind(user)
        .bind(item.id)
        .fetch_one(&mut *tx)
        .await?;
        if used >= i64::from(item.per_user_limit) {
            return Err(RedemptionError::LimitReached);
        }
        let after = balance
            .checked_sub(item.price)
            .filter(|v| *v >= 0)
            .ok_or(RedemptionError::InsufficientBalance)?;
        let now: OffsetDateTime = sqlx::query_scalar("SELECT CURRENT_TIMESTAMP")
            .fetch_one(&mut *tx)
            .await?;
        let end = now + Duration::days(i64::from(item.duration_days));
        let id = Uuid::now_v7();
        let entitlement = Uuid::now_v7();
        let ledger = Uuid::now_v7();
        let domain_key = format!("redemption:{id}");
        sqlx::query("UPDATE membership_accounts SET points_balance=$2,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE user_id=$1")
            .bind(user).bind(after).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO point_ledger_entries(id,user_id,amount,reason,idempotency_key,balance_after) VALUES($1,$2,$3,'points.redemption',$4,$5)")
            .bind(ledger).bind(user).bind(-item.price).bind(&domain_key).bind(after).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO user_standard_entitlements(id,user_id,entitlement_type_id,entitlement_key,type_version,permission_snapshot,quota_snapshot,source,source_reference_id,reason,starts_at,ends_at,idempotency_key,granted_by) VALUES($1,$2,$3,$4,$5,$6,$7,'points_redemption',$8,'积分兑换',$9,$10,$11,$2)")
            .bind(entitlement).bind(user).bind(item.entitlement_type_id).bind(&kind).bind(item.type_version)
            .bind(&item.permission_keys).bind(&item.quotas).bind(id.to_string()).bind(now).bind(end).bind(&domain_key).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO point_redemptions(id,user_id,product_id,product_revision,product_name,price,balance_after,entitlement_id,ledger_entry_id,idempotency_key,created_at,ends_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)")
            .bind(id).bind(user).bind(item.id).bind(item.revision).bind(&item.name).bind(item.price).bind(after).bind(entitlement).bind(ledger).bind(key).bind(now).bind(end).execute(&mut *tx).await?;
        insert_audit(&mut tx,user,"membership.redemption.create","point_redemption",Some(id),json!({"product_id":item.id,"entitlement_id":entitlement,"amount":-item.price,"balance_after":after})).await?;
        let account: (i64, String, i64) = sqlx::query_as(
            "SELECT lifetime_points,level_key,revision FROM membership_accounts WHERE user_id=$1",
        )
        .bind(user)
        .fetch_one(&mut *tx)
        .await?;
        enqueue_core_event_in_transaction(&mut tx,ledger,"points.changed","user",user,json!({"user_id":user,"entry_id":ledger,"amount":-item.price,"reason":"points.redemption","balance_after":after,"lifetime_points":account.0,"level_key":account.1,"revision":account.2})).await?;
        let payload = json!({"operation":"granted","entitlement_id":entitlement,"user_id":user,"entitlement_key":kind,"type_version":item.type_version,"permission_snapshot":item.permission_keys,"quota_snapshot":item.quotas,"starts_at_unix":now.unix_timestamp(),"ends_at_unix":end.unix_timestamp(),"revision":1});
        enqueue_core_event_in_transaction(
            &mut tx,
            Uuid::now_v7(),
            "standard_entitlement.granted",
            "standard_entitlement",
            entitlement,
            payload.clone(),
        )
        .await?;
        enqueue_core_event_in_transaction(
            &mut tx,
            Uuid::now_v7(),
            "entitlement.changed",
            "user",
            user,
            payload,
        )
        .await?;
        let result=sqlx::query_as("SELECT id,product_id,product_revision,product_name,price,balance_after,entitlement_id,created_at,ends_at FROM point_redemptions WHERE id=$1").bind(id).fetch_one(&mut *tx).await?;
        tx.commit().await?;
        Ok((result, true))
    }
}
