#![forbid(unsafe_code)]

mod boards;
mod health;
mod rejection;

use api_contract::RequestId;
use axum::{
    Json, Router,
    extract::Request,
    http::{HeaderValue, header::HeaderName},
    middleware::{self, Next},
    response::Response,
    routing::get,
};
use infrastructure::Database;
use utoipa::OpenApi;
use uuid::Uuid;

const REQUEST_ID_HEADER: HeaderName = HeaderName::from_static("x-request-id");

// Source: https://docs.rs/utoipa/5.5.0/utoipa/derive.OpenApi.html
#[derive(OpenApi)]
#[openapi(
    paths(boards::list, health::live, health::ready),
    components(schemas(
        api_contract::ApiResponse<api_contract::HealthData>,
        api_contract::BoardSummary,
        api_contract::BoardTone,
        api_contract::HealthData,
        api_contract::HealthStatus,
        api_contract::ErrorBody,
        api_contract::ErrorCode,
        api_contract::ErrorResponse,
        api_contract::PageMeta,
        api_contract::PageResponse<api_contract::BoardSummary>,
        api_contract::RequestId,
        api_contract::ResponseMeta
    )),
    tags(
        (name = "boards", description = "Public community boards"),
        (name = "health", description = "Process health and dependency readiness")
    )
)]
struct ApiDoc;

pub fn app(database: Database) -> Router {
    Router::new()
        .merge(boards::router())
        .merge(health::router())
        .route("/api/v1/openapi.json", get(openapi))
        // Source: https://docs.rs/axum/0.8.9/axum/struct.Router.html#method.fallback
        .fallback(rejection::not_found)
        // Source: https://docs.rs/axum/0.8.9/axum/struct.Router.html#method.method_not_allowed_fallback
        .method_not_allowed_fallback(rejection::method_not_allowed)
        .with_state(database)
        // Source: https://docs.rs/axum/0.8.9/axum/middleware/fn.from_fn.html
        .layer(middleware::from_fn(assign_request_id))
}

async fn openapi() -> Json<utoipa::openapi::OpenApi> {
    Json(ApiDoc::openapi())
}

async fn assign_request_id(mut request: Request, next: Next) -> Response {
    // Source: https://docs.rs/uuid/1.24.0/uuid/struct.Uuid.html#method.now_v7
    let request_id = RequestId::from(Uuid::now_v7());
    request.extensions_mut().insert(request_id);

    let mut response = next.run(request).await;
    let header_value =
        HeaderValue::from_str(&request_id.to_string()).expect("UUIDs are valid HTTP header values");
    response
        .headers_mut()
        .insert(REQUEST_ID_HEADER, header_value);
    response
}
