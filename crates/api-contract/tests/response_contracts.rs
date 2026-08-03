use api_contract::{
    ApiResponse, BoardSummary, BoardTone, ErrorBody, ErrorCode, ErrorResponse, InstallationStatus,
    PageResponse, RequestId, error_codes,
};
use serde_json::json;
use uuid::Uuid;

#[test]
fn success_response_serializes_the_shared_meta_shape() {
    let request_id = fixed_request_id();
    let response = ApiResponse::new(json!({ "value": 7 }), request_id);

    assert_eq!(
        serde_json::to_value(response).expect("success response must serialize"),
        json!({
            "data": { "value": 7 },
            "meta": { "request_id": request_id }
        })
    );
}

#[test]
fn page_response_keeps_next_cursor_present_at_the_end_of_a_list() {
    let request_id = fixed_request_id();
    let response = PageResponse::<String>::new(Vec::new(), request_id, None);

    assert_eq!(
        serde_json::to_value(response).expect("page response must serialize"),
        json!({
            "data": [],
            "meta": {
                "request_id": request_id,
                "next_cursor": null
            }
        })
    );
}

#[test]
fn error_response_omits_fields_until_a_field_error_exists() {
    let request_id = fixed_request_id();
    let without_fields = ErrorResponse::new(
        ErrorBody::new(
            ErrorCode::from_static(error_codes::ROUTE_NOT_FOUND),
            "not found",
        ),
        request_id,
    );
    let with_fields = ErrorResponse::new(
        ErrorBody::new(
            ErrorCode::from_static("content.validation_failed"),
            "validation failed",
        )
        .with_field("title", "title is required"),
        request_id,
    );

    let without_fields =
        serde_json::to_value(without_fields).expect("error response must serialize");
    let with_fields = serde_json::to_value(with_fields).expect("error response must serialize");

    assert!(without_fields["error"].get("fields").is_none());
    assert_eq!(
        with_fields["error"]["fields"],
        json!({ "title": ["title is required"] })
    );
}

#[test]
fn not_ready_error_code_is_stable() {
    assert_eq!(error_codes::NOT_READY, "system.not_ready");
}

#[test]
fn board_summary_serializes_the_public_contract() {
    let board_id =
        Uuid::parse_str("019fc5d1-2b9e-7ca2-a539-4ee7b3ed1257").expect("fixture must be a UUID");
    let board = BoardSummary {
        id: board_id,
        slug: "engineering".to_owned(),
        name: "工程实践".to_owned(),
        description: "Rust、架构与部署".to_owned(),
        icon: "code".to_owned(),
        tone: BoardTone::Green,
        topic_count: 284,
    };

    assert_eq!(
        serde_json::to_value(board).expect("board summary must serialize"),
        json!({
            "id": board_id,
            "slug": "engineering",
            "name": "工程实践",
            "description": "Rust、架构与部署",
            "icon": "code",
            "tone": "green",
            "topic_count": 284
        })
    );
}

#[test]
fn installation_status_serializes_the_public_contract() {
    let status = InstallationStatus {
        is_initialized: false,
    };

    assert_eq!(
        serde_json::to_value(status).expect("installation status must serialize"),
        json!({ "is_initialized": false })
    );
}

fn fixed_request_id() -> RequestId {
    RequestId::from(
        Uuid::parse_str("019fc59d-f66c-7501-9e2a-3670d0904ea6").expect("fixture must be a UUID"),
    )
}
