use api_contract::{ErrorBody, ErrorCode, ErrorResponse, RequestId, error_codes};
use axum::{Extension, Json, http::StatusCode};

pub(crate) async fn not_found(
    Extension(request_id): Extension<RequestId>,
) -> (StatusCode, Json<ErrorResponse>) {
    error_response(
        StatusCode::NOT_FOUND,
        error_codes::ROUTE_NOT_FOUND,
        "请求的接口不存在",
        request_id,
    )
}

pub(crate) async fn method_not_allowed(
    Extension(request_id): Extension<RequestId>,
) -> (StatusCode, Json<ErrorResponse>) {
    error_response(
        StatusCode::METHOD_NOT_ALLOWED,
        error_codes::METHOD_NOT_ALLOWED,
        "请求方法不受支持",
        request_id,
    )
}

fn error_response(
    status: StatusCode,
    code: &'static str,
    message: &'static str,
    request_id: RequestId,
) -> (StatusCode, Json<ErrorResponse>) {
    (
        status,
        Json(ErrorResponse::new(
            ErrorBody::new(ErrorCode::from_static(code), message),
            request_id,
        )),
    )
}
