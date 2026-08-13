use axum::{
    body::{Body, to_bytes},
    http::{Method, Request, StatusCode},
};
use infrastructure::Database;
use serde_json::Value;
use sqlx::PgPool;
use tower::ServiceExt;

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn conversation_routes_enforce_auth_csrf_validation_and_participant_privacy(pool: PgPool) {
    let app = test_app(pool.clone());
    initialize(&app).await;
    let first = register(&app, "first").await;
    let second = register(&app, "second").await;
    let outsider = register(&app, "outsider").await;

    let anonymous = app
        .clone()
        .oneshot(get_request("/api/v1/conversations", ""))
        .await
        .expect("anonymous conversation request must respond");
    assert_eq!(anonymous.status(), StatusCode::UNAUTHORIZED);

    let missing_csrf = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/conversations",
            serde_json::json!({ "recipient_id": second.user_id }),
            &first.cookies,
            None,
            None,
        ))
        .await
        .expect("missing CSRF request must respond");
    assert_eq!(missing_csrf.status(), StatusCode::FORBIDDEN);

    let invalid_body = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/conversations",
            serde_json::json!({ "recipient_id": "not-a-uuid" }),
            &first.cookies,
            Some(&first.csrf),
            None,
        ))
        .await
        .expect("invalid recipient request must respond");
    assert_eq!(invalid_body.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        response_json(invalid_body).await["error"]["code"],
        "request.validation_failed"
    );

    let self_conversation = create_conversation(&app, &first, &first.user_id).await;
    assert_eq!(self_conversation.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        response_json(self_conversation).await["error"]["code"],
        "conversation.not_found"
    );

    let created = create_conversation(&app, &first, &second.user_id).await;
    assert_eq!(created.status(), StatusCode::OK);
    let created_payload = response_json(created).await;
    let conversation_id = created_payload["data"]["id"]
        .as_str()
        .expect("created conversation id must be text")
        .to_owned();
    assert_eq!(created_payload["data"]["other_user"]["username"], "second");
    assert!(created_payload["data"]["last_message"].is_null());

    let repeated = create_conversation(&app, &second, &first.user_id).await;
    assert_eq!(repeated.status(), StatusCode::OK);
    assert_eq!(response_json(repeated).await["data"]["id"], conversation_id);

    let listed = app
        .clone()
        .oneshot(get_request("/api/v1/conversations", &first.cookies))
        .await
        .expect("conversation list request must respond");
    assert_eq!(listed.status(), StatusCode::OK);
    assert_eq!(
        response_json(listed).await["data"]
            .as_array()
            .unwrap()
            .len(),
        1
    );

    let outsider_read = app
        .clone()
        .oneshot(get_request(
            &format!("/api/v1/conversations/{conversation_id}/messages"),
            &outsider.cookies,
        ))
        .await
        .expect("outsider message request must respond");
    assert_eq!(outsider_read.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        response_json(outsider_read).await["error"]["code"],
        "conversation.not_found"
    );

    let invalid_path = app
        .oneshot(get_request(
            "/api/v1/conversations/not-a-uuid/messages",
            &first.cookies,
        ))
        .await
        .expect("invalid conversation path must respond");
    assert_eq!(invalid_path.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(invalid_path).await["error"]["code"],
        "request.path_invalid"
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn message_routes_send_page_read_archive_restore_and_replay(pool: PgPool) {
    let app = test_app(pool);
    initialize(&app).await;
    let first = register(&app, "first").await;
    let second = register(&app, "second").await;
    let created = create_conversation(&app, &first, &second.user_id).await;
    let conversation_id = response_json(created).await["data"]["id"]
        .as_str()
        .expect("conversation id must be text")
        .to_owned();
    let messages_path = format!("/api/v1/conversations/{conversation_id}/messages");

    let blank = send_message(&app, &first, &messages_path, "   ", None).await;
    assert_eq!(blank.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert!(response_json(blank).await["error"]["fields"]["content"].is_array());

    let sent = send_message(&app, &first, &messages_path, "  hello  ", Some("retry-key")).await;
    assert_eq!(sent.status(), StatusCode::CREATED);
    let sent_payload = response_json(sent).await;
    let first_message_id = sent_payload["data"]["id"]
        .as_str()
        .expect("message id must be text")
        .to_owned();
    assert_eq!(sent_payload["data"]["content"], "hello");

    let replay = send_message(&app, &first, &messages_path, "hello", Some("retry-key")).await;
    assert_eq!(replay.status(), StatusCode::CREATED);
    assert_eq!(response_json(replay).await["data"]["id"], first_message_id);
    let conflict = send_message(&app, &first, &messages_path, "changed", Some("retry-key")).await;
    assert_eq!(conflict.status(), StatusCode::CONFLICT);
    assert_eq!(
        response_json(conflict).await["error"]["code"],
        "request.idempotency_conflict"
    );

    let reply = send_message(&app, &second, &messages_path, "reply", None).await;
    assert_eq!(reply.status(), StatusCode::CREATED);
    let reply_id = response_json(reply).await["data"]["id"]
        .as_str()
        .expect("reply id must be text")
        .to_owned();

    let first_page = app
        .clone()
        .oneshot(get_request(
            &format!("{messages_path}?limit=1"),
            &first.cookies,
        ))
        .await
        .expect("first message page must respond");
    assert_eq!(first_page.status(), StatusCode::OK);
    let first_page_payload = response_json(first_page).await;
    assert_eq!(first_page_payload["data"][0]["id"], reply_id);
    let cursor = first_page_payload["meta"]["next_cursor"]
        .as_str()
        .expect("full message page must expose a cursor");
    let older_page = app
        .clone()
        .oneshot(get_request(
            &format!("{messages_path}?limit=1&cursor={cursor}"),
            &first.cookies,
        ))
        .await
        .expect("older message page must respond");
    assert_eq!(
        response_json(older_page).await["data"][0]["id"],
        first_message_id
    );

    let read = app
        .clone()
        .oneshot(json_request(
            Method::PATCH,
            &format!("/api/v1/conversations/{conversation_id}/read"),
            serde_json::json!({ "last_read_message_id": reply_id }),
            &first.cookies,
            Some(&first.csrf),
            None,
        ))
        .await
        .expect("read state request must respond");
    assert_eq!(read.status(), StatusCode::OK);
    assert_eq!(response_json(read).await["data"]["unread_count"], 0);

    let archived = app
        .clone()
        .oneshot(state_change_request(
            Method::DELETE,
            &format!("/api/v1/conversations/{conversation_id}"),
            &first,
        ))
        .await
        .expect("archive request must respond");
    assert_eq!(archived.status(), StatusCode::OK);
    assert_eq!(response_json(archived).await["data"], true);
    let hidden = app
        .clone()
        .oneshot(get_request("/api/v1/conversations", &first.cookies))
        .await
        .expect("archived list request must respond");
    assert!(
        response_json(hidden).await["data"]
            .as_array()
            .unwrap()
            .is_empty()
    );

    let restored_message = send_message(&app, &second, &messages_path, "restore", None).await;
    assert_eq!(restored_message.status(), StatusCode::CREATED);
    let restored = app
        .oneshot(get_request("/api/v1/conversations", &first.cookies))
        .await
        .expect("restored list request must respond");
    assert_eq!(
        response_json(restored).await["data"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn message_send_enforces_header_body_and_per_user_rate_limits(pool: PgPool) {
    let app = test_app(pool);
    initialize(&app).await;
    let first = register(&app, "first").await;
    let second = register(&app, "second").await;
    let created = create_conversation(&app, &first, &second.user_id).await;
    let conversation_id = response_json(created).await["data"]["id"]
        .as_str()
        .expect("conversation id must be text")
        .to_owned();
    let path = format!("/api/v1/conversations/{conversation_id}/messages");

    let invalid_key = send_message(&app, &first, &path, "hello", Some(&"x".repeat(129))).await;
    assert_eq!(invalid_key.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert!(response_json(invalid_key).await["error"]["fields"]["idempotency_key"].is_array());

    let oversized = send_message(&app, &first, &path, &"x".repeat(60_000), None).await;
    assert_eq!(oversized.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert!(response_json(oversized).await["error"]["fields"]["body"].is_array());

    for index in 0..30 {
        let response = send_message(&app, &first, &path, &format!("message {index}"), None).await;
        assert_eq!(response.status(), StatusCode::CREATED, "message {index}");
    }
    let limited = send_message(&app, &first, &path, "message 31", None).await;
    assert_eq!(limited.status(), StatusCode::TOO_MANY_REQUESTS);
    assert!(limited.headers().get("retry-after").is_some());
    assert_eq!(
        response_json(limited).await["error"]["code"],
        "message.rate_limited"
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn message_openapi_registers_paths_and_schemas(pool: PgPool) {
    let response = test_app(pool)
        .oneshot(get_request("/api/v1/openapi.json", ""))
        .await
        .expect("OpenAPI request must respond");
    assert_eq!(response.status(), StatusCode::OK);
    let document = response_json(response).await;
    assert!(document["paths"]["/api/v1/conversations"]["post"].is_object());
    assert!(document["paths"]["/api/v1/conversations"]["get"].is_object());
    assert!(
        document["paths"]["/api/v1/conversations/{conversation_id}/messages"]["post"].is_object()
    );
    assert!(
        document["paths"]["/api/v1/conversations/{conversation_id}/messages"]["get"].is_object()
    );
    for schema in [
        "ConversationSummary",
        "ConversationLastMessage",
        "DirectMessage",
        "ConversationReadState",
        "CreateConversationRequest",
        "SendDirectMessageRequest",
        "MarkConversationReadRequest",
    ] {
        assert!(
            document["components"]["schemas"][schema].is_object(),
            "{schema}"
        );
    }
}

fn test_app(pool: PgPool) -> axum::Router {
    daoyun_api::app_with_config(
        Database::from_pool(pool),
        daoyun_api::AuthConfig::default().with_secure_cookies(false),
    )
}

struct SessionFixture {
    user_id: String,
    cookies: String,
    csrf: String,
}

async fn initialize(app: &axum::Router) {
    let response = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/installation",
            serde_json::json!({
                "username": "owner",
                "email": "owner@example.com",
                "display_name": "管理员",
                "password": "correct horse battery staple"
            }),
            "",
            None,
            None,
        ))
        .await
        .expect("installation request must respond");
    assert_eq!(response.status(), StatusCode::CREATED);
}

async fn register(app: &axum::Router, username: &str) -> SessionFixture {
    let response = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/auth/register",
            serde_json::json!({
                "username": username,
                "email": format!("{username}@example.com"),
                "display_name": username,
                "password": "correct horse battery staple"
            }),
            "",
            None,
            None,
        ))
        .await
        .expect("registration request must respond");
    assert_eq!(response.status(), StatusCode::CREATED);
    session_fixture(response).await
}

async fn create_conversation(
    app: &axum::Router,
    session: &SessionFixture,
    recipient_id: &str,
) -> axum::response::Response {
    app.clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/conversations",
            serde_json::json!({ "recipient_id": recipient_id }),
            &session.cookies,
            Some(&session.csrf),
            None,
        ))
        .await
        .expect("conversation create request must respond")
}

async fn send_message(
    app: &axum::Router,
    session: &SessionFixture,
    path: &str,
    content: &str,
    idempotency_key: Option<&str>,
) -> axum::response::Response {
    app.clone()
        .oneshot(json_request(
            Method::POST,
            path,
            serde_json::json!({ "content": content }),
            &session.cookies,
            Some(&session.csrf),
            idempotency_key,
        ))
        .await
        .expect("message send request must respond")
}

async fn session_fixture(response: axum::response::Response) -> SessionFixture {
    let csrf_cookie = response
        .headers()
        .get_all("set-cookie")
        .iter()
        .find_map(|value| {
            let value = value.to_str().ok()?;
            let (pair, _) = value.split_once(';')?;
            pair.starts_with("daoyun_csrf=").then(|| pair.to_owned())
        })
        .expect("CSRF cookie must be set");
    let session_cookie = response
        .headers()
        .get_all("set-cookie")
        .iter()
        .find_map(|value| {
            let value = value.to_str().ok()?;
            let (pair, _) = value.split_once(';')?;
            pair.starts_with("daoyun_session=").then(|| pair.to_owned())
        })
        .expect("session cookie must be set");
    let csrf = csrf_cookie.split_once('=').unwrap().1.to_owned();
    let payload = response_json(response).await;
    SessionFixture {
        user_id: payload["data"]["user"]["id"].as_str().unwrap().to_owned(),
        cookies: format!("{session_cookie}; {csrf_cookie}"),
        csrf,
    }
}

fn get_request(uri: &str, cookies: &str) -> Request<Body> {
    let mut builder = Request::builder().uri(uri);
    if !cookies.is_empty() {
        builder = builder.header("cookie", cookies);
    }
    builder
        .body(Body::empty())
        .expect("GET request must be valid")
}

fn json_request(
    method: Method,
    uri: &str,
    value: Value,
    cookies: &str,
    csrf: Option<&str>,
    idempotency_key: Option<&str>,
) -> Request<Body> {
    let mut builder = Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json");
    if !cookies.is_empty() {
        builder = builder.header("cookie", cookies);
    }
    if let Some(csrf) = csrf {
        builder = builder.header("x-csrf-token", csrf);
    }
    if let Some(key) = idempotency_key {
        builder = builder.header("idempotency-key", key);
    }
    builder
        .body(Body::from(value.to_string()))
        .expect("JSON request must be valid")
}

fn state_change_request(method: Method, uri: &str, session: &SessionFixture) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header("cookie", &session.cookies)
        .header("x-csrf-token", &session.csrf)
        .body(Body::empty())
        .expect("state change request must be valid")
}

async fn response_json(response: axum::response::Response) -> Value {
    let body = to_bytes(response.into_body(), 1024 * 1024)
        .await
        .expect("response body must be readable");
    serde_json::from_slice(&body).expect("response body must be JSON")
}
