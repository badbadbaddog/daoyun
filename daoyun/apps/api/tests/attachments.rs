use axum::{
    body::{Body, to_bytes},
    http::{Method, Request, StatusCode},
};
use infrastructure::Database;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;

const ONE_BY_ONE_PNG: &[u8] = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x04\x00\x00\x00\xb5\x1c\x0c\x02\x00\x00\x00\x0bIDATx\xda\x63d\xf8\x0f\x00\x01\x05\x01\x01'\x18\xe3f\x00\x00\x00\x00IEND\xaeB`\x82";

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn attachment_upload_validates_signature_persists_metadata_and_lists_publicly(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool.clone()), config);
    let (cookies, csrf) = register_member(&app).await;
    let topic = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/topics",
            json!({"title": "附件主题", "content": "正文"}),
            &cookies,
            &csrf,
        ))
        .await
        .expect("topic request must respond");
    assert_eq!(topic.status(), StatusCode::CREATED);
    let topic_id = response_json(topic).await["data"]["id"]
        .as_str()
        .expect("topic id must be present")
        .to_owned();

    let invalid = app
        .clone()
        .oneshot(upload_request(
            &topic_id,
            b"not an image",
            "image/png",
            "avatar.png",
            &cookies,
            &csrf,
        ))
        .await
        .expect("invalid upload must respond");
    assert_eq!(invalid.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        response_json(invalid).await["error"]["code"],
        "attachment.invalid"
    );

    let eicar = app
        .clone()
        .oneshot(upload_request(
            &topic_id,
            b"X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
            "text/plain",
            "sample.txt",
            &cookies,
            &csrf,
        ))
        .await
        .expect("malware upload must respond");
    assert_eq!(eicar.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        response_json(eicar).await["error"]["message"],
        "附件请求无效"
    );

    let valid = app
        .clone()
        .oneshot(upload_request(
            &topic_id,
            ONE_BY_ONE_PNG,
            "image/png",
            "avatar.png",
            &cookies,
            &csrf,
        ))
        .await
        .expect("valid upload must respond");
    assert_eq!(valid.status(), StatusCode::CREATED);
    let payload = response_json(valid).await;
    let attachment_id = payload["data"]["id"]
        .as_str()
        .expect("attachment id must be present")
        .to_owned();
    assert_eq!(payload["data"]["mime_type"], "image/png");
    assert_eq!(payload["data"]["status"], "ready");
    assert_eq!(payload["data"]["scan_status"], "clean");
    assert_eq!(payload["data"]["size_bytes"], ONE_BY_ONE_PNG.len());
    assert!(payload["data"]["download_url"].as_str().is_some());
    assert!(payload["data"]["thumbnail_url"].as_str().is_some());

    let uploader_id =
        sqlx::query_scalar::<_, uuid::Uuid>("SELECT id FROM users WHERE username = 'uploader'")
            .fetch_one(&pool)
            .await
            .expect("uploader id must be readable");
    sqlx::query(
        "INSERT INTO board_user_restrictions
            (id, board_id, user_id, actions, starts_at, ends_at, reason, created_by, updated_by)
         SELECT daoyun_uuid_v7(), topic.board_id, $1,
                ARRAY['attachment.upload']::varchar[],
                CURRENT_TIMESTAMP - INTERVAL '1 hour', CURRENT_TIMESTAMP + INTERVAL '1 hour',
                'temporary', $1, $1
         FROM topics AS topic WHERE topic.id = $2",
    )
    .bind(uploader_id)
    .bind(uuid::Uuid::parse_str(&topic_id).expect("topic id must be valid"))
    .execute(&pool)
    .await
    .expect("attachment restriction fixture must insert");
    let board_restricted = app
        .clone()
        .oneshot(upload_request(
            &topic_id,
            b"plain text",
            "text/plain",
            "restricted.txt",
            &cookies,
            &csrf,
        ))
        .await
        .expect("board-restricted upload must respond");
    assert_eq!(board_restricted.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        response_json(board_restricted).await["error"]["code"],
        "board.posting_restricted"
    );
    sqlx::query(
        "UPDATE board_user_restrictions
         SET ends_at = CURRENT_TIMESTAMP - INTERVAL '1 second'
         WHERE user_id = $1",
    )
    .bind(uploader_id)
    .execute(&pool)
    .await
    .expect("attachment restriction fixture must expire");

    sqlx::query(
        "DELETE FROM community_group_permissions
         WHERE group_id = (
             SELECT id FROM community_groups WHERE internal_key = 'registered_member'
         ) AND permission_key = 'attachment.upload'",
    )
    .execute(&pool)
    .await
    .expect("attachment permission fixture must update");
    let forbidden_upload = app
        .clone()
        .oneshot(upload_request(
            &topic_id,
            b"plain text",
            "text/plain",
            "forbidden.txt",
            &cookies,
            &csrf,
        ))
        .await
        .expect("forbidden upload must respond");
    assert_eq!(forbidden_upload.status(), StatusCode::FORBIDDEN);
    sqlx::query(
        "INSERT INTO community_group_permissions (group_id, permission_key)
         SELECT id, 'attachment.upload' FROM community_groups
         WHERE internal_key = 'registered_member'",
    )
    .execute(&pool)
    .await
    .expect("attachment permission fixture must restore");
    sqlx::query(
        "UPDATE community_quota_usage SET used = 5
         WHERE user_id = (SELECT id FROM users WHERE username = 'uploader')
           AND quota_key = 'attachment.upload.daily'",
    )
    .execute(&pool)
    .await
    .expect("attachment quota fixture must update");
    let quota_upload = app
        .clone()
        .oneshot(upload_request(
            &topic_id,
            b"plain text",
            "text/plain",
            "quota.txt",
            &cookies,
            &csrf,
        ))
        .await
        .expect("quota upload must respond");
    assert_eq!(quota_upload.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(
        response_json(quota_upload).await["error"]["code"],
        "community.quota_exceeded"
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM topic_attachments WHERE topic_id = $1")
            .bind(uuid::Uuid::parse_str(&topic_id).expect("topic id must be valid"))
            .fetch_one(&pool)
            .await
            .expect("attachment row count must be readable"),
        1
    );

    let guest_download = app
        .clone()
        .oneshot(get_request(&format!("/api/v1/attachments/{attachment_id}")))
        .await
        .expect("guest attachment download must respond");
    assert_eq!(guest_download.status(), StatusCode::FORBIDDEN);

    let download = app
        .clone()
        .oneshot(get_request_with_cookies(
            &format!("/api/v1/attachments/{attachment_id}"),
            &cookies,
        ))
        .await
        .expect("attachment download must respond");
    assert_eq!(download.status(), StatusCode::OK);
    assert_eq!(download.headers()["content-type"], "image/png");
    assert_eq!(
        to_bytes(download.into_body(), 1024 * 1024).await.unwrap(),
        ONE_BY_ONE_PNG
    );

    sqlx::query(
        "DELETE FROM community_group_permissions
         WHERE group_id = (
             SELECT id FROM community_groups WHERE internal_key = 'registered_member'
         ) AND permission_key = 'attachment.download'",
    )
    .execute(&pool)
    .await
    .expect("download permission fixture must update");
    let forbidden_download = app
        .clone()
        .oneshot(get_request_with_cookies(
            &format!("/api/v1/attachments/{attachment_id}"),
            &cookies,
        ))
        .await
        .expect("forbidden attachment download must respond");
    assert_eq!(forbidden_download.status(), StatusCode::FORBIDDEN);
    sqlx::query(
        "INSERT INTO community_group_permissions (group_id, permission_key)
         SELECT id, 'attachment.download' FROM community_groups
         WHERE internal_key = 'registered_member'",
    )
    .execute(&pool)
    .await
    .expect("download permission fixture must restore");
    sqlx::query(
        "UPDATE community_group_quota_rules
         SET quota_value = $1
         WHERE group_id = (
             SELECT id FROM community_groups WHERE internal_key = 'registered_member'
         ) AND quota_key = 'attachment.download.bytes.daily'",
    )
    .bind(i64::try_from(ONE_BY_ONE_PNG.len()).expect("fixture length must fit i64"))
    .execute(&pool)
    .await
    .expect("download quota fixture must update");
    let quota_download = app
        .clone()
        .oneshot(get_request_with_cookies(
            &format!("/api/v1/attachments/{attachment_id}"),
            &cookies,
        ))
        .await
        .expect("quota attachment download must respond");
    assert_eq!(quota_download.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(
        response_json(quota_download).await["error"]["code"],
        "community.quota_exceeded"
    );

    let thumbnail = app
        .clone()
        .oneshot(get_request(&format!(
            "/api/v1/attachments/{attachment_id}/thumbnail"
        )))
        .await
        .expect("attachment thumbnail must respond");
    assert_eq!(thumbnail.status(), StatusCode::OK);
    assert_eq!(thumbnail.headers()["content-type"], "image/webp");

    let listed = app
        .clone()
        .oneshot(get_request(&format!(
            "/api/v1/topics/{topic_id}/attachments"
        )))
        .await
        .expect("attachment list must respond");
    assert_eq!(listed.status(), StatusCode::OK);
    assert_eq!(
        response_json(listed).await["data"].as_array().map(Vec::len),
        Some(1)
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM topic_attachments WHERE topic_id = $1")
            .bind(uuid::Uuid::parse_str(&topic_id).expect("topic id must be valid"))
            .fetch_one(&pool)
            .await
            .expect("attachment row count must be readable"),
        1
    );
    let attachment_audit = sqlx::query_as::<_, (String, String, uuid::Uuid, Value)>(
        "SELECT action, resource_type, resource_id, summary FROM admin_audit_log
         WHERE actor_id = $1 AND action = 'attachment.create'",
    )
    .bind(uploader_id)
    .fetch_one(&pool)
    .await
    .expect("attachment audit must be readable");
    assert_eq!(
        attachment_audit,
        (
            "attachment.create".to_owned(),
            "attachment".to_owned(),
            uuid::Uuid::parse_str(&attachment_id).expect("attachment id must be valid"),
            json!({
                "mime_type": "image/png",
                "topic_id": uuid::Uuid::parse_str(&topic_id).expect("topic id must be valid")
            }),
        )
    );
    let serialized_audit =
        serde_json::to_string(&attachment_audit).expect("attachment audit must serialize");
    assert!(!serialized_audit.contains("avatar.png"));
    assert!(!serialized_audit.contains("topics/"));

    let (owner_cookies, owner_csrf) = login_owner(&app).await;
    sqlx::query(
        "UPDATE topic_attachments
         SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 day'
         WHERE id = $1",
    )
    .bind(uuid::Uuid::parse_str(&attachment_id).expect("attachment id must be valid"))
    .execute(&pool)
    .await
    .expect("attachment expiration fixture must update");
    let cleanup = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v1/admin/attachments/cleanup?limit=10")
                .header("cookie", owner_cookies)
                .header("x-csrf-token", owner_csrf)
                .body(Body::empty())
                .expect("cleanup request must be valid"),
        )
        .await
        .expect("cleanup request must respond");
    assert_eq!(cleanup.status(), StatusCode::OK);
    assert_eq!(response_json(cleanup).await["data"]["deleted_records"], 1);
}

async fn register_member(app: &axum::Router) -> (String, String) {
    let installation = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/installation",
            json!({
                "username": "owner",
                "email": "owner@example.com",
                "display_name": "Owner",
                "password": "correct horse battery staple"
            }),
            "",
            "",
        ))
        .await
        .expect("registration must respond");
    assert_eq!(installation.status(), StatusCode::CREATED);
    let response = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/auth/register",
            json!({
                "username": "uploader",
                "email": "uploader@example.com",
                "display_name": "Uploader",
                "password": "correct horse battery staple"
            }),
            "",
            "",
        ))
        .await
        .expect("login must respond");
    assert_eq!(response.status(), StatusCode::CREATED);
    session_cookies(&response).await
}

async fn login_owner(app: &axum::Router) -> (String, String) {
    let response = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/auth/login",
            json!({
                "identifier": "owner",
                "password": "correct horse battery staple"
            }),
            "",
            "",
        ))
        .await
        .expect("owner login must respond");
    assert_eq!(response.status(), StatusCode::OK);
    session_cookies(&response).await
}

fn upload_request(
    topic_id: &str,
    body: &[u8],
    mime: &str,
    name: &str,
    cookies: &str,
    csrf: &str,
) -> Request<Body> {
    Request::builder()
        .method(Method::POST)
        .uri(format!("/api/v1/topics/{topic_id}/attachments"))
        .header("cookie", cookies)
        .header("x-csrf-token", csrf)
        .header("content-type", mime)
        .header("x-file-name", name)
        .body(Body::from(body.to_vec()))
        .expect("upload request must be valid")
}

fn json_request(
    method: Method,
    uri: &str,
    value: Value,
    cookies: &str,
    csrf: &str,
) -> Request<Body> {
    let mut builder = Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json");
    if !cookies.is_empty() {
        builder = builder.header("cookie", cookies);
    }
    if !csrf.is_empty() {
        builder = builder.header("x-csrf-token", csrf);
    }
    builder
        .body(Body::from(value.to_string()))
        .expect("JSON request must be valid")
}

fn get_request(uri: &str) -> Request<Body> {
    Request::builder()
        .uri(uri)
        .body(Body::empty())
        .expect("GET request must be valid")
}

fn get_request_with_cookies(uri: &str, cookies: &str) -> Request<Body> {
    Request::builder()
        .uri(uri)
        .header("cookie", cookies)
        .body(Body::empty())
        .expect("authenticated GET request must be valid")
}

async fn session_cookies(response: &axum::response::Response) -> (String, String) {
    let mut csrf_cookie = String::new();
    let mut session_cookie = String::new();
    for value in response.headers().get_all("set-cookie").iter() {
        let value = value.to_str().expect("set-cookie must be text");
        let pair = value.split(';').next().expect("cookie pair must exist");
        if pair.starts_with("daoyun_csrf=") {
            csrf_cookie = pair.to_owned();
        } else if pair.starts_with("daoyun_session=") {
            session_cookie = pair.to_owned();
        }
    }
    let csrf = csrf_cookie
        .split_once('=')
        .expect("CSRF cookie value must exist")
        .1
        .to_owned();
    (format!("{session_cookie}; {csrf_cookie}"), csrf)
}

async fn response_json(response: axum::response::Response) -> Value {
    let body = to_bytes(response.into_body(), 1024 * 1024)
        .await
        .expect("response body must be readable");
    serde_json::from_slice(&body).expect("response must be JSON")
}
