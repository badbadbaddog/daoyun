use argon2::{
    Argon2,
    password_hash::{PasswordHash, PasswordVerifier},
};
use axum::{
    body::{Body, to_bytes},
    http::{Method, Request, StatusCode, header::CONTENT_TYPE},
};
use infrastructure::Database;
use serde_json::Value;
use sqlx::PgPool;
use std::time::Duration;
use tower::ServiceExt;

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn installation_status_returns_a_correlated_success_envelope(pool: PgPool) {
    let response = daoyun_api::app(Database::from_pool(pool))
        .oneshot(
            Request::builder()
                .uri("/api/v1/installation")
                .body(Body::empty())
                .expect("request must be valid"),
        )
        .await
        .expect("router must respond");

    assert_eq!(response.status(), StatusCode::OK);
    let request_id = response.headers()["x-request-id"]
        .to_str()
        .expect("request id must be text")
        .to_owned();
    let payload = response_json(response).await;

    assert_eq!(payload["data"]["is_initialized"], false);
    assert_eq!(payload["meta"]["request_id"], request_id);
}

#[tokio::test]
async fn installation_status_hides_database_errors() {
    let response = daoyun_api::app(unavailable_database())
        .oneshot(
            Request::builder()
                .uri("/api/v1/installation")
                .body(Body::empty())
                .expect("request must be valid"),
        )
        .await
        .expect("router must respond");

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let request_id = response.headers()["x-request-id"]
        .to_str()
        .expect("request id must be text")
        .to_owned();
    let payload = response_json(response).await;

    assert_eq!(payload["error"]["code"], "system.database_unavailable");
    assert_eq!(payload["error"]["message"], "安装状态暂时无法读取");
    assert_eq!(payload["meta"]["request_id"], request_id);
    assert!(!payload.to_string().contains("sqlx"));
    assert!(!payload.to_string().contains("connection"));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn installation_initialization_creates_a_correlated_super_administrator(pool: PgPool) {
    let response = daoyun_api::app(Database::from_pool(pool.clone()))
        .oneshot(initialization_request("owner"))
        .await
        .expect("router must respond");

    assert_eq!(response.status(), StatusCode::CREATED);
    let request_id = response.headers()["x-request-id"]
        .to_str()
        .expect("request id must be text")
        .to_owned();
    let payload = response_json(response).await;

    assert_eq!(payload["data"]["is_initialized"], true);
    assert_eq!(payload["data"]["administrator"]["username"], "owner");
    assert_eq!(payload["meta"]["request_id"], request_id);
    assert!(!payload.to_string().contains("password"));

    let password_hash =
        sqlx::query_scalar::<_, String>("SELECT password_hash FROM password_credentials")
            .fetch_one(&pool)
            .await
            .expect("password credential must exist");
    let password_hash =
        PasswordHash::new(&password_hash).expect("stored credential must be a PHC hash");
    assert_eq!(password_hash.algorithm.as_str(), "argon2id");
    assert!(password_hash.salt.is_some());
    assert!(
        Argon2::default()
            .verify_password(b"correct horse battery staple", &password_hash)
            .is_ok()
    );

    let default_board = sqlx::query_as::<_, (String, String, String, i32, String)>(
        "SELECT slug, name, icon, position, visibility FROM boards",
    )
    .fetch_one(&pool)
    .await
    .expect("initialization must create the default public board");
    assert_eq!(
        default_board,
        (
            "general".to_owned(),
            "社区广场".to_owned(),
            "messages".to_owned(),
            0,
            "public".to_owned(),
        )
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn installation_accepts_a_six_character_password(pool: PgPool) {
    let response = daoyun_api::app(Database::from_pool(pool))
        .oneshot(initialization_request_with_password("owner", "123456"))
        .await
        .expect("router must respond");

    assert_eq!(response.status(), StatusCode::CREATED);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn installation_initialization_returns_all_field_validation_errors(pool: PgPool) {
    let body = serde_json::json!({
        "username": "Owner!",
        "email": "not-an-email",
        "display_name": "   ",
        "password": "short"
    });
    let response = daoyun_api::app(Database::from_pool(pool.clone()))
        .oneshot(json_request(body.to_string()))
        .await
        .expect("router must respond");

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let payload = response_json(response).await;

    assert_eq!(payload["error"]["code"], "request.validation_failed");
    for field in ["username", "email", "display_name", "password"] {
        assert!(
            payload["error"]["fields"][field].is_array(),
            "{field} must have a field error"
        );
    }
    let users = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users")
        .fetch_one(&pool)
        .await
        .expect("user count must be readable");
    assert_eq!(users, 0);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn installation_initialization_rejects_control_characters_in_display_name(pool: PgPool) {
    let body = serde_json::json!({
        "username": "owner",
        "email": "owner@example.com",
        "display_name": "admin\nname",
        "password": "correct horse battery staple"
    });
    let response = daoyun_api::app(Database::from_pool(pool))
        .oneshot(json_request(body.to_string()))
        .await
        .expect("router must respond");

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let payload = response_json(response).await;
    assert!(payload["error"]["fields"]["display_name"].is_array());
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn installation_initialization_rejects_malformed_json(pool: PgPool) {
    let response = daoyun_api::app(Database::from_pool(pool))
        .oneshot(json_request("{".to_owned()))
        .await
        .expect("router must respond");

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let payload = response_json(response).await;
    assert_eq!(payload["error"]["code"], "request.validation_failed");
    assert!(payload["error"]["fields"]["body"].is_array());
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn installation_initialization_rejects_bodies_over_four_kibibytes(pool: PgPool) {
    let body = serde_json::json!({
        "username": "owner",
        "email": "owner@example.com",
        "display_name": "x".repeat(5_000),
        "password": "correct horse battery staple"
    });
    let response = daoyun_api::app(Database::from_pool(pool))
        .oneshot(json_request(body.to_string()))
        .await
        .expect("router must respond");

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let payload = response_json(response).await;
    assert_eq!(payload["error"]["code"], "request.validation_failed");
    assert!(payload["error"]["fields"]["body"].is_array());
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn installation_initialization_returns_conflict_after_success(pool: PgPool) {
    let app = daoyun_api::app(Database::from_pool(pool));
    let first = app
        .clone()
        .oneshot(initialization_request("first_owner"))
        .await
        .expect("first request must complete");
    assert_eq!(first.status(), StatusCode::CREATED);

    let second = app
        .oneshot(initialization_request("second_owner"))
        .await
        .expect("second request must complete");

    assert_eq!(second.status(), StatusCode::CONFLICT);
    let payload = response_json(second).await;
    assert_eq!(payload["error"]["code"], "installation.already_initialized");
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn concurrent_installation_requests_have_exactly_one_winner(pool: PgPool) {
    let app = daoyun_api::app(Database::from_pool(pool.clone()));
    let first = app.clone().oneshot(initialization_request("first_owner"));
    let second = app.oneshot(initialization_request("second_owner"));

    let (first, second) = tokio::join!(first, second);
    let statuses = [
        first.expect("first request must complete").status(),
        second.expect("second request must complete").status(),
    ];

    assert_eq!(
        statuses
            .iter()
            .filter(|status| **status == StatusCode::CREATED)
            .count(),
        1
    );
    assert_eq!(
        statuses
            .iter()
            .filter(|status| **status == StatusCode::CONFLICT)
            .count(),
        1
    );
    let users = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users")
        .fetch_one(&pool)
        .await
        .expect("user count must be readable");
    assert_eq!(users, 1);
}

#[tokio::test]
async fn installation_initialization_hides_database_errors() {
    let response = daoyun_api::app(unavailable_database())
        .oneshot(initialization_request("owner"))
        .await
        .expect("router must respond");

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let request_id = response.headers()["x-request-id"]
        .to_str()
        .expect("request id must be text")
        .to_owned();
    let payload = response_json(response).await;

    assert_eq!(payload["error"]["code"], "system.database_unavailable");
    assert_eq!(payload["meta"]["request_id"], request_id);
    assert!(!payload.to_string().contains("sqlx"));
    assert!(!payload.to_string().contains("connection"));
}

#[tokio::test]
async fn openapi_documents_the_installation_status() {
    let response = daoyun_api::app(unavailable_database())
        .oneshot(
            Request::builder()
                .uri("/api/v1/openapi.json")
                .body(Body::empty())
                .expect("request must be valid"),
        )
        .await
        .expect("router must respond");

    assert_eq!(response.status(), StatusCode::OK);
    let document = response_json(response).await;
    let operation = &document["paths"]["/api/v1/installation"]["get"];

    assert!(operation.is_object());
    for status in ["200", "503"] {
        assert!(operation["responses"][status]["headers"]["x-request-id"].is_object());
    }
    assert!(document["components"]["schemas"]["InstallationStatus"].is_object());

    let initialization = &document["paths"]["/api/v1/installation"]["post"];
    assert!(initialization.is_object());
    for status in ["201", "409", "422", "500", "503"] {
        assert!(
            initialization["responses"][status]["headers"]["x-request-id"].is_object(),
            "POST response {status} must document request correlation"
        );
    }
    assert!(initialization["requestBody"].is_object());
    assert!(document["components"]["schemas"]["InitializeInstallationRequest"].is_object());
    assert!(document["components"]["schemas"]["InstallationInitialization"].is_object());
    assert_eq!(
        document["components"]["schemas"]["InitializeInstallationRequest"]["properties"]["password"]
            ["minLength"],
        6
    );
    assert_eq!(
        document["components"]["schemas"]["InitializeInstallationRequest"]["properties"]["password"]
            ["maxLength"],
        128
    );
}

async fn response_json(response: axum::response::Response) -> Value {
    let body = to_bytes(response.into_body(), 1024 * 1024)
        .await
        .expect("response body must be readable");
    serde_json::from_slice(&body).expect("response body must be JSON")
}

fn unavailable_database() -> Database {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .acquire_timeout(Duration::from_millis(100))
        .connect_lazy("postgresql://daoyun@127.0.0.1:1/daoyun")
        .expect("the unavailable database URL must be valid");
    Database::from_pool(pool)
}

fn initialization_request(username: &str) -> Request<Body> {
    initialization_request_with_password(username, "correct horse battery staple")
}

fn initialization_request_with_password(username: &str, password: &str) -> Request<Body> {
    json_request(
        serde_json::json!({
            "username": username,
            "email": format!("{username}@example.com"),
            "display_name": "站点管理员",
            "password": password
        })
        .to_string(),
    )
}

fn json_request(body: String) -> Request<Body> {
    Request::builder()
        .method(Method::POST)
        .uri("/api/v1/installation")
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(body))
        .expect("request must be valid")
}
