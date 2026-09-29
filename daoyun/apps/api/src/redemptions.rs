use crate::auth::{ApiError, AuthRuntime, authenticate_session, authenticate_state_change};
use api_contract::{
    ApiResponse, ErrorBody, ErrorCode, ErrorResponse, PutRedemptionProductRequest,
    RedeemPointsRequest, RedemptionCatalog, RedemptionHistory, RedemptionProduct,
    RedemptionReceipt, RequestId,
};
use axum::{
    Extension, Json, Router,
    extract::{
        DefaultBodyLimit, Path, Query, State,
        rejection::{JsonRejection, PathRejection, QueryRejection},
    },
    http::{
        HeaderMap, HeaderValue, StatusCode,
        header::{CACHE_CONTROL, VARY},
    },
    routing::{get, put},
};
use infrastructure::{
    Database, PutRedemptionProduct, RedemptionError, RedemptionProductRecord, RedemptionRecord,
};
use serde::Deserialize;
use time::format_description::well_known::Rfc3339;
use uuid::Uuid;

pub(crate) fn router(runtime: AuthRuntime) -> Router<Database> {
    Router::new()
        .route("/api/v1/membership/redemption-products", get(catalog))
        .route("/api/v1/admin/redemption-products", get(admin_catalog))
        .route(
            "/api/v1/admin/redemption-products/{product_id}",
            put(save_product),
        )
        .route("/api/v1/users/me/redemptions", get(history).post(redeem))
        .layer(DefaultBodyLimit::max(16 * 1024))
        .layer(Extension(runtime))
}
#[derive(Deserialize)]
pub(crate) struct PageQuery {
    cursor: Option<Uuid>,
    limit: Option<i64>,
}
type Reply<T> = Result<(HeaderMap, Json<ApiResponse<T>>), ApiError>;
#[utoipa::path(get,path="/api/v1/membership/redemption-products",operation_id="listRedemptionProducts",tag="membership",
params(("cursor"=Option<Uuid>,Query),("limit"=Option<i64>,Query)),
responses((status=200,body=ApiResponse<RedemptionCatalog>,headers(("x-request-id"=String))),
(status=401,body=ErrorResponse,headers(("x-request-id"=String))),(status=403,body=ErrorResponse,headers(("x-request-id"=String))),(status=404,body=ErrorResponse,headers(("x-request-id"=String))),(status=409,body=ErrorResponse,headers(("x-request-id"=String))),(status=413,body=ErrorResponse,headers(("x-request-id"=String))),(status=422,body=ErrorResponse,headers(("x-request-id"=String))),(status=503,body=ErrorResponse,headers(("x-request-id"=String)))))]
// Keep the shared API error envelope in DTO conversion closures.
#[allow(clippy::result_large_err)]
pub(crate) async fn catalog(
    State(db): State<Database>,
    Extension(id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    query: Result<Query<PageQuery>, QueryRejection>,
) -> Reply<RedemptionCatalog> {
    let (session, _) = authenticate_session(&db, &runtime, &headers, id).await?;
    let (cursor, limit) = page(query, id)?;
    let mut rows = db
        .list_redemption_products(Some(session.user.id), false, cursor, limit + 1)
        .await
        .map_err(|e| error(e, id))?;
    let next_cursor = if rows.len() > limit as usize {
        rows.truncate(limit as usize);
        rows.last().map(|p| p.id)
    } else {
        None
    };
    let products = rows
        .into_iter()
        .map(|r| map_product(r, id))
        .collect::<Result<Vec<_>, _>>()?;
    let enabled = db.redemption_enabled().await.map_err(|e| error(e, id))?;
    reply(
        RedemptionCatalog {
            enabled,
            products,
            next_cursor,
        },
        id,
    )
}
#[utoipa::path(get,path="/api/v1/admin/redemption-products",operation_id="listAdminRedemptionProducts",tag="membership",
params(("cursor"=Option<Uuid>,Query),("limit"=Option<i64>,Query)),
responses((status=200,body=ApiResponse<RedemptionCatalog>,headers(("x-request-id"=String))),
(status=401,body=ErrorResponse,headers(("x-request-id"=String))),(status=403,body=ErrorResponse,headers(("x-request-id"=String))),(status=404,body=ErrorResponse,headers(("x-request-id"=String))),(status=409,body=ErrorResponse,headers(("x-request-id"=String))),(status=413,body=ErrorResponse,headers(("x-request-id"=String))),(status=422,body=ErrorResponse,headers(("x-request-id"=String))),(status=503,body=ErrorResponse,headers(("x-request-id"=String)))))]
// Keep the shared API error envelope in DTO conversion closures.
#[allow(clippy::result_large_err)]
pub(crate) async fn admin_catalog(
    State(db): State<Database>,
    Extension(id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    query: Result<Query<PageQuery>, QueryRejection>,
) -> Reply<RedemptionCatalog> {
    let (session, _) = authenticate_session(&db, &runtime, &headers, id).await?;
    let (cursor, limit) = page(query, id)?;
    let mut rows = db
        .list_redemption_products(Some(session.user.id), true, cursor, limit + 1)
        .await
        .map_err(|e| error(e, id))?;
    let next_cursor = if rows.len() > limit as usize {
        rows.truncate(limit as usize);
        rows.last().map(|p| p.id)
    } else {
        None
    };
    let products = rows
        .into_iter()
        .map(|r| map_product(r, id))
        .collect::<Result<Vec<_>, _>>()?;
    let enabled = db.redemption_enabled().await.map_err(|e| error(e, id))?;
    reply(
        RedemptionCatalog {
            enabled,
            products,
            next_cursor,
        },
        id,
    )
}
#[utoipa::path(get,path="/api/v1/users/me/redemptions",operation_id="listMyRedemptions",tag="membership",
params(("cursor"=Option<Uuid>,Query),("limit"=Option<i64>,Query)),
responses((status=200,body=ApiResponse<RedemptionHistory>,headers(("x-request-id"=String))),
(status=401,body=ErrorResponse,headers(("x-request-id"=String))),(status=403,body=ErrorResponse,headers(("x-request-id"=String))),(status=404,body=ErrorResponse,headers(("x-request-id"=String))),(status=409,body=ErrorResponse,headers(("x-request-id"=String))),(status=413,body=ErrorResponse,headers(("x-request-id"=String))),(status=422,body=ErrorResponse,headers(("x-request-id"=String))),(status=503,body=ErrorResponse,headers(("x-request-id"=String)))))]
// Keep the shared API error envelope in DTO conversion closures.
#[allow(clippy::result_large_err)]
pub(crate) async fn history(
    State(db): State<Database>,
    Extension(id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    query: Result<Query<PageQuery>, QueryRejection>,
) -> Reply<RedemptionHistory> {
    let (session, _) = authenticate_session(&db, &runtime, &headers, id).await?;
    let (cursor, limit) = page(query, id)?;
    let mut rows = db
        .list_redemptions(session.user.id, cursor, limit + 1)
        .await
        .map_err(|e| error(e, id))?;
    let next_cursor = if rows.len() > limit as usize {
        rows.truncate(limit as usize);
        rows.last().map(|p| p.id)
    } else {
        None
    };
    let records = rows
        .into_iter()
        .map(|r| map_receipt(r, id))
        .collect::<Result<Vec<_>, _>>()?;
    reply(
        RedemptionHistory {
            records,
            next_cursor,
        },
        id,
    )
}
#[utoipa::path(put,path="/api/v1/admin/redemption-products/{product_id}",operation_id="putRedemptionProduct",tag="membership",
request_body=PutRedemptionProductRequest,params(("product_id"=Uuid,Path),("x-csrf-token"=String,Header)),
responses((status=200,body=ApiResponse<RedemptionProduct>,headers(("x-request-id"=String))),
(status=401,body=ErrorResponse,headers(("x-request-id"=String))),(status=403,body=ErrorResponse,headers(("x-request-id"=String))),(status=404,body=ErrorResponse,headers(("x-request-id"=String))),(status=409,body=ErrorResponse,headers(("x-request-id"=String))),(status=413,body=ErrorResponse,headers(("x-request-id"=String))),(status=422,body=ErrorResponse,headers(("x-request-id"=String))),(status=503,body=ErrorResponse,headers(("x-request-id"=String)))))]
pub(crate) async fn save_product(
    State(db): State<Database>,
    Extension(id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
    body: Result<Json<PutRedemptionProductRequest>, JsonRejection>,
) -> Reply<RedemptionProduct> {
    let session = authenticate_state_change(&db, &runtime, &headers, id).await?;
    let Path(product_id) = path.map_err(|_| error(RedemptionError::InvalidInput, id))?;
    let input = body_value(body, id)?;
    let row = db
        .put_redemption_product(
            session.user.id,
            PutRedemptionProduct {
                id: product_id,
                name: input.name,
                entitlement_type_id: input.entitlement_type_id,
                type_version: input.type_version,
                price: input.price,
                duration_days: input.duration_days,
                per_user_limit: input.per_user_limit,
                enabled: input.enabled,
                expected_revision: input.expected_revision,
            },
        )
        .await
        .map_err(|e| error(e, id))?;
    reply(map_product(row, id)?, id)
}
#[utoipa::path(post,path="/api/v1/users/me/redemptions",operation_id="redeemPoints",tag="membership",
request_body=RedeemPointsRequest,params(("x-csrf-token"=String,Header)),
responses((status=200,body=ApiResponse<RedemptionReceipt>,headers(("x-request-id"=String))),
(status=401,body=ErrorResponse,headers(("x-request-id"=String))),(status=403,body=ErrorResponse,headers(("x-request-id"=String))),(status=404,body=ErrorResponse,headers(("x-request-id"=String))),(status=409,body=ErrorResponse,headers(("x-request-id"=String))),(status=413,body=ErrorResponse,headers(("x-request-id"=String))),(status=422,body=ErrorResponse,headers(("x-request-id"=String))),(status=503,body=ErrorResponse,headers(("x-request-id"=String)))))]
pub(crate) async fn redeem(
    State(db): State<Database>,
    Extension(id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    body: Result<Json<RedeemPointsRequest>, JsonRejection>,
) -> Reply<RedemptionReceipt> {
    let session = authenticate_state_change(&db, &runtime, &headers, id).await?;
    let input = body_value(body, id)?;
    let (row, _) = db
        .redeem_points(
            session.user.id,
            input.product_id,
            input.expected_revision,
            &input.idempotency_key,
        )
        .await
        .map_err(|e| error(e, id))?;
    reply(map_receipt(row, id)?, id)
}

#[allow(clippy::result_large_err)]
fn reply<T>(data: T, id: RequestId) -> Reply<T> {
    Ok((private_headers(), Json(ApiResponse::new(data, id))))
}
fn private_headers() -> HeaderMap {
    let mut h = HeaderMap::new();
    h.insert(CACHE_CONTROL, HeaderValue::from_static("private, no-store"));
    h.insert(VARY, HeaderValue::from_static("Cookie"));
    h
}
#[allow(clippy::result_large_err)]
fn page(
    query: Result<Query<PageQuery>, QueryRejection>,
    id: RequestId,
) -> Result<(Option<Uuid>, i64), ApiError> {
    let Query(q) = query.map_err(|_| error(RedemptionError::InvalidInput, id))?;
    let limit = q.limit.unwrap_or(20);
    if !(1..=100).contains(&limit) {
        return Err(error(RedemptionError::InvalidInput, id));
    }
    Ok((q.cursor, limit))
}
#[allow(clippy::result_large_err)]
fn body_value<T>(body: Result<Json<T>, JsonRejection>, id: RequestId) -> Result<T, ApiError> {
    body.map(|Json(v)| v).map_err(|e| {
        if e.status() == StatusCode::PAYLOAD_TOO_LARGE {
            api_error(
                StatusCode::PAYLOAD_TOO_LARGE,
                "request.body_too_large",
                "请求体过大",
                id,
            )
        } else {
            error(RedemptionError::InvalidInput, id)
        }
    })
}
#[allow(clippy::result_large_err)]
fn map_product(r: RedemptionProductRecord, id: RequestId) -> Result<RedemptionProduct, ApiError> {
    Ok(RedemptionProduct {
        id: r.id,
        name: r.name,
        entitlement_type_id: r.entitlement_type_id,
        type_version: r.type_version,
        price: r.price,
        duration_days: r.duration_days,
        per_user_limit: r.per_user_limit,
        enabled: r.enabled,
        revision: r.revision,
        permission_keys: r.permission_keys,
        quotas: serde_json::from_value(r.quotas).map_err(|_| unavailable(id))?,
        unavailable_reason: r.unavailable_reason,
    })
}
#[allow(clippy::result_large_err)]
fn map_receipt(r: RedemptionRecord, id: RequestId) -> Result<RedemptionReceipt, ApiError> {
    Ok(RedemptionReceipt {
        id: r.id,
        product_id: r.product_id,
        product_revision: r.product_revision,
        product_name: r.product_name,
        price: r.price,
        balance_after: r.balance_after,
        entitlement_id: r.entitlement_id,
        created_at: r.created_at.format(&Rfc3339).map_err(|_| unavailable(id))?,
        ends_at: r.ends_at.format(&Rfc3339).map_err(|_| unavailable(id))?,
    })
}
fn error(e: RedemptionError, id: RequestId) -> ApiError {
    let (status, code, message) = match e {
        RedemptionError::NotFound => (
            StatusCode::NOT_FOUND,
            "redemption.not_found",
            "兑换商品不存在",
        ),
        RedemptionError::Forbidden => (
            StatusCode::FORBIDDEN,
            "redemption.forbidden",
            "当前账号无权执行此操作",
        ),
        RedemptionError::Disabled => (
            StatusCode::CONFLICT,
            "redemption.disabled",
            "兑换已停用或商品已下架",
        ),
        RedemptionError::Conflict => (
            StatusCode::CONFLICT,
            "redemption.conflict",
            "商品已变更或请求冲突，请刷新后重新确认",
        ),
        RedemptionError::InvalidInput => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "request.validation_failed",
            "兑换参数无效",
        ),
        RedemptionError::InsufficientBalance => (
            StatusCode::CONFLICT,
            "redemption.insufficient_balance",
            "积分不足",
        ),
        RedemptionError::AlreadyEntitled => (
            StatusCode::CONFLICT,
            "redemption.already_entitled",
            "已有同类有效或待生效权益",
        ),
        RedemptionError::LimitReached => (
            StatusCode::CONFLICT,
            "redemption.limit_reached",
            "已达到兑换上限",
        ),
        RedemptionError::Database(_) => {
            tracing::warn!(request_id=%id,"Redemption database operation failed");
            return unavailable(id);
        }
    };
    api_error(status, code, message, id)
}
fn unavailable(id: RequestId) -> ApiError {
    api_error(
        StatusCode::SERVICE_UNAVAILABLE,
        "system.internal_error",
        "兑换服务暂时不可用",
        id,
    )
}
fn api_error(status: StatusCode, code: &'static str, message: &str, id: RequestId) -> ApiError {
    (
        status,
        private_headers(),
        Json(ErrorResponse::new(
            ErrorBody::new(ErrorCode::from_static(code), message),
            id,
        )),
    )
}
