use axum::{
    body::{Body, to_bytes},
    http::{Method, Request, StatusCode},
};
use infrastructure::Database;
use serde_json::{Value, json};
use sqlx::{PgPool, Row};
use std::{
    path::Path,
    sync::{Arc, Mutex},
};
use tower::ServiceExt;
use uuid::Uuid;

const ONE_BY_ONE_PNG: &[u8] = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x04\x00\x00\x00\xb5\x1c\x0c\x02\x00\x00\x00\x0bIDATx\xda\x63d\xf8\x0f\x00\x01\x05\x01\x01'\x18\xe3f\x00\x00\x00\x00IEND\xaeB`\x82";

#[derive(Default)]
struct RecordingEmailSender {
    recipients: Mutex<Vec<String>>,
}

impl daoyun_api::EmailSender for RecordingEmailSender {
    fn send<'a>(
        &'a self,
        _settings: daoyun_api::SmtpConnectionSettings,
        email: daoyun_api::OutboundEmail,
    ) -> daoyun_api::EmailSenderFuture<'a> {
        self.recipients
            .lock()
            .expect("recording email sender lock must be available")
            .push(email.recipient_email);
        Box::pin(async { Ok(()) })
    }
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn smtp_settings_require_admin_csrf_and_never_return_the_password(pool: PgPool) {
    let sender = Arc::new(RecordingEmailSender::default());
    let email = daoyun_api::EmailRuntime::from_key_and_sender([17_u8; 32], sender.clone());
    let app = daoyun_api::app_with_email_runtime(
        Database::from_pool(pool.clone()),
        daoyun_api::AuthConfig::default().with_secure_cookies(false),
        email,
    );
    initialize(&app).await;
    let (cookies, csrf) = login_owner(&app).await;

    let without_csrf = app
        .clone()
        .oneshot(json_request(
            Method::PATCH,
            "/api/v1/admin/smtp-settings",
            json!({}),
            &cookies,
            None,
        ))
        .await
        .expect("SMTP update without CSRF must respond");
    assert_eq!(without_csrf.status(), StatusCode::FORBIDDEN);

    let updated = app
        .clone()
        .oneshot(json_request(
            Method::PATCH,
            "/api/v1/admin/smtp-settings",
            json!({
                "host": "smtp.example.com",
                "port": 587,
                "username": "mailer",
                "password": "super-secret",
                "clear_password": false,
                "tls_mode": "starttls",
                "from_email": "noreply@example.com",
                "from_name": "DaoYun",
                "enabled": true,
                "registration_email_verification_enabled": true
            }),
            &cookies,
            Some(&csrf),
        ))
        .await
        .expect("SMTP update must respond");
    assert_eq!(updated.status(), StatusCode::OK);
    let updated_body = response_json(updated).await;
    assert_eq!(updated_body["data"]["password_configured"], true);
    assert!(!updated_body.to_string().contains("super-secret"));
    assert!(!updated_body.to_string().contains("ciphertext"));

    let read = app
        .clone()
        .oneshot(get_request("/api/v1/admin/smtp-settings", &cookies))
        .await
        .expect("SMTP settings read must respond");
    assert_eq!(read.status(), StatusCode::OK);
    let read_body = response_json(read).await;
    assert_eq!(read_body["data"]["tls_mode"], "starttls");
    assert_eq!(read_body["data"]["password_configured"], true);
    assert!(!read_body.to_string().contains("super-secret"));

    let tested = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/smtp-settings/test",
            json!({"recipient_email": "owner@example.com"}),
            &cookies,
            Some(&csrf),
        ))
        .await
        .expect("SMTP test send must respond");
    assert_eq!(tested.status(), StatusCode::OK);
    assert_eq!(
        sender
            .recipients
            .lock()
            .expect("recorded recipients must be readable")
            .as_slice(),
        ["owner@example.com"]
    );

    let ciphertext = sqlx::query_scalar::<_, Vec<u8>>(
        "SELECT password_ciphertext FROM smtp_configuration WHERE singleton",
    )
    .fetch_one(&pool)
    .await
    .expect("encrypted SMTP password must exist");
    assert!(!String::from_utf8_lossy(&ciphertext).contains("super-secret"));

    let openapi = app
        .oneshot(get_request("/api/v1/openapi.json", ""))
        .await
        .expect("OpenAPI document must respond");
    let document = response_json(openapi).await;
    assert!(document["paths"]["/api/v1/admin/smtp-settings"]["get"].is_object());
    assert!(document["paths"]["/api/v1/admin/smtp-settings"]["patch"].is_object());
    assert!(document["paths"]["/api/v1/admin/smtp-settings/test"]["post"].is_object());
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn branding_asset_upload_rejects_active_content_and_serves_safe_same_origin_bytes(
    pool: PgPool,
) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool.clone()), config);
    initialize(&app).await;
    let (cookies, csrf) = login_owner(&app).await;

    let svg = app
        .clone()
        .oneshot(asset_request(
            Method::PUT,
            "logo",
            b"<svg><script>alert(1)</script></svg>",
            "image/svg+xml",
            &cookies,
            Some(&csrf),
        ))
        .await
        .expect("SVG upload must respond");
    assert_eq!(svg.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let uploaded = app
        .clone()
        .oneshot(asset_request(
            Method::PUT,
            "logo",
            ONE_BY_ONE_PNG,
            "image/png",
            &cookies,
            Some(&csrf),
        ))
        .await
        .expect("PNG logo upload must respond");
    assert_eq!(uploaded.status(), StatusCode::OK);
    let uploaded = response_json(uploaded).await;
    assert_eq!(
        uploaded["data"]["logo_url"],
        "/api/v1/site-branding/assets/logo"
    );

    let first_storage_key = sqlx::query_scalar::<_, String>(
        "SELECT storage_key FROM site_branding_assets WHERE kind = 'logo'",
    )
    .fetch_one(&pool)
    .await
    .expect("first logo storage key must exist");
    let replaced = app
        .clone()
        .oneshot(asset_request(
            Method::PUT,
            "logo",
            ONE_BY_ONE_PNG,
            "image/png",
            &cookies,
            Some(&csrf),
        ))
        .await
        .expect("replacement PNG logo upload must respond");
    assert_eq!(replaced.status(), StatusCode::OK);
    let second_storage_key = sqlx::query_scalar::<_, String>(
        "SELECT storage_key FROM site_branding_assets WHERE kind = 'logo'",
    )
    .fetch_one(&pool)
    .await
    .expect("replacement logo storage key must exist");
    assert_ne!(first_storage_key, second_storage_key);
    assert!(
        tokio::fs::metadata(Path::new("target/daoyun-attachments").join(&first_storage_key))
            .await
            .is_err(),
        "replaced logo object must be removed"
    );

    let public = app
        .clone()
        .oneshot(get_request("/api/v1/site-branding/assets/logo", ""))
        .await
        .expect("public logo read must respond");
    assert_eq!(public.status(), StatusCode::OK);
    assert_eq!(public.headers()["content-type"], "image/png");
    assert_eq!(public.headers()["x-content-type-options"], "nosniff");
    assert!(
        public.headers()["cache-control"]
            .to_str()
            .expect("cache control must be text")
            .contains("public")
    );
    assert_eq!(
        to_bytes(public.into_body(), 2 * 1024 * 1024)
            .await
            .expect("logo body must be readable"),
        ONE_BY_ONE_PNG
    );

    let audit = sqlx::query_as::<_, (String, Value)>(
        "SELECT action, summary FROM admin_audit_log
         WHERE action = 'branding.asset.upload' ORDER BY created_at DESC LIMIT 1",
    )
    .fetch_one(&pool)
    .await
    .expect("brand asset audit must exist");
    assert_eq!(audit.0, "branding.asset.upload");
    assert_eq!(audit.1["kind"], "logo");
    assert_eq!(audit.1["mime_type"], "image/png");
    assert_eq!(audit.1["size_bytes"], ONE_BY_ONE_PNG.len());
    assert!(!audit.1.to_string().contains("storage_key"));

    for _ in 0..2 {
        let deleted = app
            .clone()
            .oneshot(asset_request(
                Method::DELETE,
                "logo",
                &[],
                "application/octet-stream",
                &cookies,
                Some(&csrf),
            ))
            .await
            .expect("logo delete must respond");
        assert_eq!(deleted.status(), StatusCode::OK);
        assert!(response_json(deleted).await["data"]["logo_url"].is_null());
    }

    let missing = app
        .oneshot(get_request("/api/v1/site-branding/assets/logo", ""))
        .await
        .expect("deleted logo read must respond");
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);
    assert!(
        tokio::fs::metadata(Path::new("target/daoyun-attachments").join(&second_storage_key))
            .await
            .is_err(),
        "deleted logo object must be removed"
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn admin_configuration_enforces_roles_and_records_changes(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool.clone()), config);
    initialize(&app).await;

    let public = app
        .clone()
        .oneshot(get_request("/api/v1/site-branding", ""))
        .await
        .expect("public branding must respond");
    assert_eq!(public.status(), StatusCode::OK);
    assert_eq!(response_json(public).await["data"]["site_name"], "刀云");

    let unauthenticated = app
        .clone()
        .oneshot(get_request("/api/v1/admin/boards", ""))
        .await
        .expect("admin boards must respond");
    assert_eq!(unauthenticated.status(), StatusCode::UNAUTHORIZED);
    let unauthenticated_access = app
        .clone()
        .oneshot(get_request("/api/v1/admin/access", ""))
        .await
        .expect("admin access catalog must require authentication");
    assert_eq!(unauthenticated_access.status(), StatusCode::UNAUTHORIZED);

    let member = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/auth/register",
            json!({
                "username": "member",
                "email": "member@example.com",
                "display_name": "成员",
                "password": "correct horse battery staple"
            }),
            "",
            None,
        ))
        .await
        .expect("member registration must respond");
    let (member_cookies, member_csrf) = session_cookies(&member).await;
    let member_access = app
        .clone()
        .oneshot(get_request("/api/v1/admin/access", &member_cookies))
        .await
        .expect("member access catalog must respond");
    assert_eq!(member_access.status(), StatusCode::OK);
    let member_access_request_id = member_access
        .headers()
        .get("x-request-id")
        .expect("member access request id header must exist")
        .to_str()
        .expect("request id header must be text")
        .to_owned();
    let member_access = response_json(member_access).await;
    assert_eq!(
        member_access["meta"]["request_id"],
        member_access_request_id
    );
    assert!(
        member_access["data"]["capability_keys"]
            .as_array()
            .is_some_and(|keys| keys.iter().any(|key| key == "attachment.create"))
    );
    assert!(
        !member_access["data"]["capability_keys"]
            .as_array()
            .is_some_and(|keys| keys.iter().any(|key| key == "governance.reports.read"))
    );
    let forbidden = app
        .clone()
        .oneshot(get_request("/api/v1/admin/boards", &member_cookies))
        .await
        .expect("member admin request must respond");
    assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        response_json(forbidden).await["error"]["code"],
        "admin.forbidden"
    );

    let member_id = sqlx::query_scalar::<_, Uuid>("SELECT id FROM users WHERE username = 'member'")
        .fetch_one(&pool)
        .await
        .expect("member id must be queryable");
    let owner_id = sqlx::query_scalar::<_, Uuid>("SELECT id FROM users WHERE username = 'owner'")
        .fetch_one(&pool)
        .await
        .expect("owner id must be queryable");
    let report_reader_role_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO roles (id, key, name, scope, is_system)
         VALUES ($1, 'report_reader', 'Report reader', 'instance', FALSE)",
    )
    .bind(report_reader_role_id)
    .execute(&pool)
    .await
    .expect("report reader role must be insertable");
    let report_read_permission_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM permissions WHERE permission_key = 'governance.reports.read'",
    )
    .fetch_one(&pool)
    .await
    .expect("report read permission must be seeded");
    sqlx::query("INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)")
        .bind(report_reader_role_id)
        .bind(report_read_permission_id)
        .execute(&pool)
        .await
        .expect("report reader capability must be grantable");
    sqlx::query(
        "INSERT INTO role_assignments (id, user_id, role_id, assigned_by)
         VALUES ($1, $2, $3, $4)",
    )
    .bind(Uuid::now_v7())
    .bind(member_id)
    .bind(report_reader_role_id)
    .bind(owner_id)
    .execute(&pool)
    .await
    .expect("report reader assignment must be insertable");

    let report_reader_access = app
        .clone()
        .oneshot(get_request("/api/v1/admin/access", &member_cookies))
        .await
        .expect("report reader access catalog must respond");
    assert_eq!(report_reader_access.status(), StatusCode::OK);
    assert!(
        response_json(report_reader_access).await["data"]["capability_keys"]
            .as_array()
            .is_some_and(|keys| keys.iter().any(|key| key == "governance.reports.read"))
    );

    let reports = app
        .clone()
        .oneshot(get_request("/api/v1/admin/reports", &member_cookies))
        .await
        .expect("report reader request must respond");
    assert_eq!(reports.status(), StatusCode::OK);
    let forbidden_write = app
        .clone()
        .oneshot(json_request(
            Method::PATCH,
            "/api/v1/admin/site-branding",
            json!({}),
            &member_cookies,
            Some(&member_csrf),
        ))
        .await
        .expect("member admin write must respond");
    assert_eq!(forbidden_write.status(), StatusCode::FORBIDDEN);

    let (owner_cookies, owner_csrf) = login_owner(&app).await;
    let boards = app
        .clone()
        .oneshot(get_request("/api/v1/admin/boards", &owner_cookies))
        .await
        .expect("owner admin boards must respond");
    assert_eq!(boards.status(), StatusCode::OK);
    assert_eq!(response_json(boards).await["data"][0]["slug"], "general");

    let branding = app
        .clone()
        .oneshot(json_request(
            Method::PATCH,
            "/api/v1/admin/site-branding",
            json!({
                "site_name": "刀云开发者社区",
                "logo_url": null,
                "favicon_url": null,
                "primary_color": "#123456",
                "accent_color": "#abcdef",
                "theme_preset": "compact",
                "list_density": "compact",
                "home_mode": "hot"
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("branding update must respond");
    assert_eq!(branding.status(), StatusCode::OK);
    assert_eq!(
        response_json(branding).await["data"]["theme_preset"],
        "compact"
    );
    let cache_invalidation = sqlx::query(
        "SELECT status, aggregate_type, payload
         FROM outbox_events
         WHERE event_type = 'cache.site_branding_invalidated'",
    )
    .fetch_one(&pool)
    .await
    .expect("branding update must enqueue cache invalidation");
    assert_eq!(cache_invalidation.get::<String, _>("status"), "pending");
    assert_eq!(
        cache_invalidation.get::<String, _>("aggregate_type"),
        "site_branding"
    );
    assert_eq!(
        cache_invalidation.get::<Value, _>("payload"),
        json!({ "cache_key": "site_branding" })
    );

    let created = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/boards",
            json!({
                "slug": "engineering",
                "name": "工程实践",
                "description": "工程讨论",
                "icon": "code",
                "tone": "blue",
                "position": 10,
                "visibility": "hidden",
                "parent_id": null
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("board creation must respond");
    assert_eq!(created.status(), StatusCode::CREATED);
    let created_payload = response_json(created).await;
    let board_id = created_payload["data"]["id"]
        .as_str()
        .expect("created board id must be present");
    let update = app
        .clone()
        .oneshot(json_request(
            Method::PATCH,
            &format!("/api/v1/admin/boards/{board_id}"),
            json!({
                "slug": "engineering",
                "name": "工程实践",
                "description": "公开工程讨论",
                "icon": "layout",
                "tone": "green",
                "position": 1,
                "visibility": "public",
                "parent_id": null,
                "expected_revision": 1
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("board update must respond");
    assert_eq!(update.status(), StatusCode::OK);
    assert_eq!(response_json(update).await["data"]["visibility"], "public");

    let deleted = app
        .clone()
        .oneshot(json_request(
            Method::DELETE,
            &format!("/api/v1/admin/boards/{board_id}"),
            json!(null),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("board delete must respond");
    assert_eq!(deleted.status(), StatusCode::OK);
    assert_eq!(response_json(deleted).await["data"], true);

    let audit = app
        .clone()
        .oneshot(get_request(
            "/api/v1/admin/audit?resource_type=board&limit=2",
            &owner_cookies,
        ))
        .await
        .expect("audit list must respond");
    assert_eq!(audit.status(), StatusCode::OK);
    let audit_payload = response_json(audit).await;
    assert_eq!(audit_payload["data"].as_array().map(Vec::len), Some(2));
    assert!(audit_payload["meta"]["next_cursor"].is_string());

    let audit_count = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM admin_audit_log WHERE actor_id = (SELECT id FROM users WHERE username = 'owner')",
    )
    .fetch_one(&pool)
    .await
    .expect("audit rows must be queryable");
    assert_eq!(audit_count, 4);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn audit_filters_related_resources_with_scoped_cursors_and_server_authorization(
    pool: PgPool,
) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool.clone()), config);
    initialize(&app).await;
    let (owner_cookies, _) = login_owner(&app).await;
    let owner_id = sqlx::query_scalar::<_, Uuid>("SELECT id FROM users WHERE username = 'owner'")
        .fetch_one(&pool)
        .await
        .expect("owner id must exist");
    let user_id = Uuid::now_v7();
    let report_id = Uuid::now_v7();
    let unrelated_id = Uuid::now_v7();

    for (action, resource_type, resource_id, summary, seconds_ago) in [
        (
            "user.status.update",
            "user",
            user_id,
            json!({"status": "restricted"}),
            3,
        ),
        (
            "report.user_action",
            "user",
            user_id,
            json!({"report_id": report_id}),
            2,
        ),
        (
            "report.moderate",
            "content_report",
            report_id,
            json!({"disposition": "resolved"}),
            1,
        ),
        (
            "board.update",
            "board",
            unrelated_id,
            json!({"visibility": "hidden"}),
            0,
        ),
    ] {
        sqlx::query(
            "INSERT INTO admin_audit_log
                 (id, actor_id, action, resource_type, resource_id, summary, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP - make_interval(secs => $7))",
        )
        .bind(Uuid::now_v7())
        .bind(owner_id)
        .bind(action)
        .bind(resource_type)
        .bind(resource_id)
        .bind(summary)
        .bind(seconds_ago)
        .execute(&pool)
        .await
        .expect("audit fixture must insert");
    }

    let resource = app
        .clone()
        .oneshot(get_request(
            &format!("/api/v1/admin/audit?resource_id={user_id}&limit=10"),
            &owner_cookies,
        ))
        .await
        .expect("resource audit query must respond");
    assert_eq!(resource.status(), StatusCode::OK);
    assert_eq!(
        response_json(resource).await["data"]
            .as_array()
            .map(Vec::len),
        Some(2)
    );

    let first_user_page = app
        .clone()
        .oneshot(get_request(
            &format!("/api/v1/admin/audit?user_id={user_id}&limit=1"),
            &owner_cookies,
        ))
        .await
        .expect("user audit first page must respond");
    assert_eq!(first_user_page.status(), StatusCode::OK);
    let first_user_page = response_json(first_user_page).await;
    let user_cursor = first_user_page["meta"]["next_cursor"]
        .as_str()
        .expect("user audit next cursor must exist");
    let second_user_page = app
        .clone()
        .oneshot(get_request(
            &format!("/api/v1/admin/audit?user_id={user_id}&cursor={user_cursor}&limit=1"),
            &owner_cookies,
        ))
        .await
        .expect("user audit second page must respond");
    assert_eq!(second_user_page.status(), StatusCode::OK);
    assert_eq!(
        response_json(second_user_page).await["data"]
            .as_array()
            .map(Vec::len),
        Some(1)
    );

    let report = app
        .clone()
        .oneshot(get_request(
            &format!("/api/v1/admin/audit?report_id={report_id}&limit=10"),
            &owner_cookies,
        ))
        .await
        .expect("report audit query must respond");
    assert_eq!(report.status(), StatusCode::OK);
    assert_eq!(
        response_json(report).await["data"].as_array().map(Vec::len),
        Some(2)
    );

    let unrelated = app
        .clone()
        .oneshot(get_request(
            &format!("/api/v1/admin/audit?resource_id={unrelated_id}&limit=1"),
            &owner_cookies,
        ))
        .await
        .expect("unrelated audit query must respond");
    let unrelated_cursor = response_json(unrelated).await["data"][0]["id"]
        .as_str()
        .expect("unrelated audit id must exist")
        .to_owned();
    let invalid_cursor = app
        .clone()
        .oneshot(get_request(
            &format!("/api/v1/admin/audit?report_id={report_id}&cursor={unrelated_cursor}&limit=1"),
            &owner_cookies,
        ))
        .await
        .expect("cross-filter cursor must respond");
    assert_eq!(invalid_cursor.status(), StatusCode::UNPROCESSABLE_ENTITY);

    sqlx::query(
        "DELETE FROM role_permissions
         WHERE role_id = (SELECT id FROM roles WHERE key = 'super_admin')
           AND permission_id = (SELECT id FROM permissions WHERE permission_key = 'audit.read')",
    )
    .execute(&pool)
    .await
    .expect("audit permission must be removable for authorization test");
    let forbidden = app
        .clone()
        .oneshot(get_request(
            &format!("/api/v1/admin/audit?user_id={user_id}"),
            &owner_cookies,
        ))
        .await
        .expect("audit request without capability must respond");
    assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);

    let openapi = app
        .oneshot(get_request("/api/v1/openapi.json", ""))
        .await
        .expect("OpenAPI document must respond");
    let document = response_json(openapi).await;
    let parameters = document["paths"]["/api/v1/admin/audit"]["get"]["parameters"]
        .as_array()
        .expect("audit query parameters must be documented")
        .iter()
        .filter_map(|parameter| parameter["name"].as_str())
        .collect::<Vec<_>>();
    assert!(parameters.contains(&"resource_id"));
    assert!(parameters.contains(&"user_id"));
    assert!(parameters.contains(&"report_id"));
    assert!(
        document["paths"]["/api/v1/admin/audit/alerts"]["get"]["responses"]["401"]
            ["headers"]["x-request-id"]
            .is_object()
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn board_hierarchy_enforces_depth_cycles_revisions_and_safe_deletion(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool), config);
    initialize(&app).await;
    let (owner_cookies, owner_csrf) = login_owner(&app).await;

    let parent = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/boards",
            json!({
                "slug": "parent-board",
                "name": "父版块",
                "description": "第一层",
                "icon": "folder",
                "tone": "green",
                "position": 1,
                "visibility": "public",
                "parent_id": null
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("parent board creation must respond");
    assert_eq!(parent.status(), StatusCode::CREATED);
    let parent = response_json(parent).await;
    assert_eq!(parent["data"]["parent_id"], Value::Null);
    assert_eq!(parent["data"]["revision"], 1);
    let parent_id = parent["data"]["id"]
        .as_str()
        .expect("parent board id must exist");

    let inserted_first = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/boards",
            json!({
                "slug": "inserted-first",
                "name": "置顶版块",
                "description": "稳定排序",
                "icon": "pin",
                "tone": "rose",
                "position": 0,
                "visibility": "public",
                "parent_id": null
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("first root board creation must respond");
    assert_eq!(inserted_first.status(), StatusCode::CREATED);
    let inserted_first = response_json(inserted_first).await;
    let inserted_first_id = inserted_first["data"]["id"]
        .as_str()
        .expect("first root board id must exist");
    let ordered = app
        .clone()
        .oneshot(get_request("/api/v1/admin/boards", &owner_cookies))
        .await
        .expect("ordered board list must respond");
    let ordered = response_json(ordered).await;
    let root_boards = ordered["data"]
        .as_array()
        .expect("board list data must be an array")
        .iter()
        .filter(|board| board["parent_id"].is_null())
        .collect::<Vec<_>>();
    let roots = root_boards
        .iter()
        .map(|board| board["slug"].as_str().expect("board slug must exist"))
        .collect::<Vec<_>>();
    assert_eq!(roots, vec!["inserted-first", "general", "parent-board"]);
    assert_eq!(root_boards[0]["revision"], 1);
    assert_eq!(root_boards[1]["revision"], 2);
    assert_eq!(root_boards[2]["revision"], 2);

    let child = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/boards",
            json!({
                "slug": "child-board",
                "name": "子版块",
                "description": "第二层",
                "icon": "folder",
                "tone": "blue",
                "position": 0,
                "visibility": "public",
                "parent_id": parent_id
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("child board creation must respond");
    assert_eq!(child.status(), StatusCode::CREATED);
    let child = response_json(child).await;
    assert_eq!(child["data"]["parent_id"], parent_id);
    assert_eq!(child["data"]["revision"], 1);
    let child_id = child["data"]["id"]
        .as_str()
        .expect("child board id must exist");

    let grandchild = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/boards",
            json!({
                "slug": "grandchild-board",
                "name": "孙版块",
                "description": "第三层",
                "icon": "folder",
                "tone": "amber",
                "position": 0,
                "visibility": "hidden",
                "parent_id": child_id
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("grandchild board creation must respond");
    assert_eq!(grandchild.status(), StatusCode::CREATED);
    let grandchild = response_json(grandchild).await;
    let grandchild_id = grandchild["data"]["id"]
        .as_str()
        .expect("grandchild board id must exist");

    let too_deep = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/boards",
            json!({
                "slug": "too-deep",
                "name": "第四层",
                "description": "不允许",
                "icon": "folder",
                "tone": "rose",
                "position": 0,
                "visibility": "public",
                "parent_id": grandchild_id
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("fourth-level board creation must respond");
    assert_eq!(too_deep.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        response_json(too_deep).await["error"]["code"],
        "admin.board_depth_exceeded"
    );

    let move_subtree_too_deep = app
        .clone()
        .oneshot(json_request(
            Method::PATCH,
            &format!("/api/v1/admin/boards/{parent_id}"),
            json!({
                "slug": "parent-board",
                "name": "父版块",
                "description": "第一层",
                "icon": "folder",
                "tone": "green",
                "position": 0,
                "visibility": "public",
                "parent_id": inserted_first_id,
                "expected_revision": 2
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("over-depth subtree move must respond");
    assert_eq!(
        move_subtree_too_deep.status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        response_json(move_subtree_too_deep).await["error"]["code"],
        "admin.board_depth_exceeded"
    );

    let cycle = app
        .clone()
        .oneshot(json_request(
            Method::PATCH,
            &format!("/api/v1/admin/boards/{parent_id}"),
            json!({
                "slug": "parent-board",
                "name": "父版块",
                "description": "第一层",
                "icon": "folder",
                "tone": "green",
                "position": 1,
                "visibility": "public",
                "parent_id": child_id,
                "expected_revision": 2
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("cyclic board move must respond");
    assert_eq!(cycle.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        response_json(cycle).await["error"]["code"],
        "admin.board_parent_invalid"
    );

    let updated = app
        .clone()
        .oneshot(json_request(
            Method::PATCH,
            &format!("/api/v1/admin/boards/{parent_id}"),
            json!({
                "slug": "parent-board",
                "name": "父版块（已改名）",
                "description": "第一层",
                "icon": "folder",
                "tone": "green",
                "position": 1,
                "visibility": "public",
                "parent_id": null,
                "expected_revision": 2
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("board update must respond");
    assert_eq!(updated.status(), StatusCode::OK);
    assert_eq!(response_json(updated).await["data"]["revision"], 3);

    let stale = app
        .clone()
        .oneshot(json_request(
            Method::PATCH,
            &format!("/api/v1/admin/boards/{parent_id}"),
            json!({
                "slug": "parent-board",
                "name": "过期更新",
                "description": "第一层",
                "icon": "folder",
                "tone": "green",
                "position": 1,
                "visibility": "public",
                "parent_id": null,
                "expected_revision": 2
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("stale board update must respond");
    assert_eq!(stale.status(), StatusCode::CONFLICT);
    assert_eq!(
        response_json(stale).await["error"]["code"],
        "admin.board_conflict"
    );

    let delete_parent = app
        .clone()
        .oneshot(json_request(
            Method::DELETE,
            &format!("/api/v1/admin/boards/{parent_id}"),
            json!(null),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("parent board deletion must respond");
    assert_eq!(delete_parent.status(), StatusCode::CONFLICT);
    assert_eq!(
        response_json(delete_parent).await["error"]["code"],
        "admin.board_has_children"
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn board_deletion_impact_counts_topics_and_replies_before_rejecting_deletion(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool.clone()), config);
    initialize(&app).await;
    let (owner_cookies, owner_csrf) = login_owner(&app).await;
    let owner_id = sqlx::query_scalar::<_, Uuid>("SELECT id FROM users WHERE username = 'owner'")
        .fetch_one(&pool)
        .await
        .expect("owner id must exist");
    let board_id = sqlx::query_scalar::<_, Uuid>("SELECT id FROM boards WHERE slug = 'general'")
        .fetch_one(&pool)
        .await
        .expect("general board id must exist");
    let topic_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO topics
             (id, board_id, author_id, title, excerpt, content, status, published_at, last_activity_at)
         VALUES ($1, $2, $3, '删除影响测试', '', '正文', 'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
    )
    .bind(topic_id)
    .bind(board_id)
    .bind(owner_id)
    .execute(&pool)
    .await
    .expect("topic fixture must insert");
    for (index, kind) in ["topic", "reply", "reply"].into_iter().enumerate() {
        sqlx::query(
            "INSERT INTO posts (id, topic_id, author_id, kind, status, content, floor_number)
             VALUES ($1, $2, $3, $4, 'published', '内容', $5)",
        )
        .bind(Uuid::now_v7())
        .bind(topic_id)
        .bind(owner_id)
        .bind(kind)
        .bind((kind == "reply").then(|| i64::try_from(index).expect("fixture floor must fit i64")))
        .execute(&pool)
        .await
        .expect("post fixture must insert");
    }
    sqlx::query("UPDATE boards SET topic_count = 1 WHERE id = $1")
        .bind(board_id)
        .execute(&pool)
        .await
        .expect("board topic counter must update");

    let impact = app
        .clone()
        .oneshot(get_request(
            &format!("/api/v1/admin/boards/{board_id}/deletion-impact"),
            &owner_cookies,
        ))
        .await
        .expect("board deletion impact must respond");
    assert_eq!(impact.status(), StatusCode::OK);
    let impact = response_json(impact).await;
    assert_eq!(impact["data"]["board_id"], board_id.to_string());
    assert_eq!(impact["data"]["child_count"], 0);
    assert_eq!(impact["data"]["topic_count"], 1);
    assert_eq!(impact["data"]["reply_count"], 2);
    assert_eq!(impact["data"]["can_delete"], false);

    let deleted = app
        .oneshot(json_request(
            Method::DELETE,
            &format!("/api/v1/admin/boards/{board_id}"),
            json!(null),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("board deletion with topics must respond");
    assert_eq!(deleted.status(), StatusCode::CONFLICT);
    assert_eq!(
        response_json(deleted).await["error"]["code"],
        "admin.board_conflict"
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn authorization_catalog_requires_capabilities_and_preserves_public_contract(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool), config);
    initialize(&app).await;

    let member = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/auth/register",
            json!({
                "username": "catalog_member",
                "email": "catalog_member@example.com",
                "display_name": "Catalog member",
                "password": "correct horse battery staple"
            }),
            "",
            None,
        ))
        .await
        .expect("member registration must respond");
    let (member_cookies, _) = session_cookies(&member).await;
    let forbidden = app
        .clone()
        .oneshot(get_request(
            "/api/v1/admin/authorization/roles",
            &member_cookies,
        ))
        .await
        .expect("member authorization catalog request must respond");
    assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);

    let (owner_cookies, _) = login_owner(&app).await;
    let permissions = app
        .clone()
        .oneshot(get_request(
            "/api/v1/admin/authorization/permissions",
            &owner_cookies,
        ))
        .await
        .expect("permission catalog must respond");
    assert_eq!(permissions.status(), StatusCode::OK);
    let permission_request_id = permissions
        .headers()
        .get("x-request-id")
        .expect("permission catalog request id header must exist")
        .to_str()
        .expect("request id header must be text")
        .to_owned();
    let permission_payload = response_json(permissions).await;
    assert_eq!(
        permission_payload["meta"]["request_id"],
        permission_request_id
    );
    assert!(permission_payload["data"].as_array().is_some_and(|items| {
        items
            .iter()
            .any(|item| item["key"] == "authorization.roles.read")
    }));

    let roles = app
        .clone()
        .oneshot(get_request(
            "/api/v1/admin/authorization/roles",
            &owner_cookies,
        ))
        .await
        .expect("role catalog must respond");
    assert_eq!(roles.status(), StatusCode::OK);
    let role_payload = response_json(roles).await;
    let super_admin = role_payload["data"]
        .as_array()
        .and_then(|roles| roles.iter().find(|role| role["key"] == "super_admin"))
        .expect("super administrator role must be present");
    assert_eq!(super_admin["revision"], 1);

    let assignments = app
        .clone()
        .oneshot(get_request(
            "/api/v1/admin/authorization/assignments?username=owner&limit=10",
            &owner_cookies,
        ))
        .await
        .expect("assignment catalog must respond");
    assert_eq!(assignments.status(), StatusCode::OK);
    let assignment_payload = response_json(assignments).await;
    assert_eq!(assignment_payload["data"][0]["user"]["username"], "owner");
    assert_eq!(assignment_payload["data"][0]["role"]["key"], "super_admin");
    assert!(
        assignment_payload
            .to_string()
            .find("owner@example.com")
            .is_none()
    );

    let openapi = app
        .oneshot(get_request("/api/v1/openapi.json", ""))
        .await
        .expect("OpenAPI document must respond");
    assert_eq!(openapi.status(), StatusCode::OK);
    let document = response_json(openapi).await;
    assert!(document["paths"]["/api/v1/admin/access"]["get"].is_object());
    assert!(document["paths"]["/api/v1/admin/authorization/permissions"]["get"].is_object());
    assert!(document["paths"]["/api/v1/admin/authorization/roles"]["get"].is_object());
    assert!(document["paths"]["/api/v1/admin/authorization/assignments"]["get"].is_object());
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn privileged_admin_write_does_not_require_recent_authentication(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool), config);
    initialize(&app).await;
    let login = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/auth/login",
            json!({"identifier": "owner", "password": "correct horse battery staple"}),
            "",
            None,
        ))
        .await
        .expect("owner login must respond");
    assert_eq!(login.status(), StatusCode::OK);
    let (owner_cookies, owner_csrf) = session_cookies(&login).await;

    let created = app
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/authorization/roles",
            json!({
                "key": "without_recent_auth",
                "name": "Without recent auth",
                "scope": "instance",
                "permission_keys": ["authorization.roles.read"]
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("privileged write without recent auth must respond");
    assert_eq!(created.status(), StatusCode::CREATED);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn custom_role_api_validates_csrf_revisions_system_roles_and_permissions(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool), config);
    initialize(&app).await;
    let (owner_cookies, owner_csrf) = login_owner(&app).await;

    let created = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/authorization/roles",
            json!({
                "key": "api_board_helper",
                "name": "API board helper",
                "scope": "board",
                "permission_keys": ["moderation.topic"]
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("role creation must respond");
    assert_eq!(created.status(), StatusCode::CREATED);
    let created_payload = response_json(created).await;
    let role_id = created_payload["data"]["id"]
        .as_str()
        .expect("created role id must exist");
    assert_eq!(created_payload["data"]["revision"], 1);

    let missing_csrf = app
        .clone()
        .oneshot(json_request(
            Method::PATCH,
            &format!("/api/v1/admin/authorization/roles/{role_id}"),
            json!({
                "name": "Missing CSRF",
                "permission_keys": ["moderation.topic"],
                "expected_revision": 1
            }),
            &owner_cookies,
            None,
        ))
        .await
        .expect("missing CSRF update must respond");
    assert_eq!(missing_csrf.status(), StatusCode::FORBIDDEN);

    let updated = app
        .clone()
        .oneshot(json_request(
            Method::PATCH,
            &format!("/api/v1/admin/authorization/roles/{role_id}"),
            json!({
                "name": "API board reviewer",
                "permission_keys": ["governance.reports.read", "moderation.topic"],
                "expected_revision": 1
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("role update must respond");
    assert_eq!(updated.status(), StatusCode::OK);
    assert_eq!(response_json(updated).await["data"]["revision"], 2);

    let stale = app
        .clone()
        .oneshot(json_request(
            Method::PATCH,
            &format!("/api/v1/admin/authorization/roles/{role_id}"),
            json!({
                "name": "Stale role",
                "permission_keys": ["moderation.topic"],
                "expected_revision": 1
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("stale role update must respond");
    assert_eq!(stale.status(), StatusCode::CONFLICT);
    assert_eq!(
        response_json(stale).await["error"]["code"],
        "authorization.role_conflict"
    );

    let invalid_permission = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/authorization/roles",
            json!({
                "key": "invalid_permission_role",
                "name": "Invalid permission role",
                "scope": "instance",
                "permission_keys": ["unknown.capability"]
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("invalid permission creation must respond");
    assert_eq!(
        invalid_permission.status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        response_json(invalid_permission).await["error"]["code"],
        "authorization.permission_invalid"
    );

    let roles = app
        .clone()
        .oneshot(get_request(
            "/api/v1/admin/authorization/roles",
            &owner_cookies,
        ))
        .await
        .expect("role catalog must respond");
    let roles_payload = response_json(roles).await;
    let system_role_id = roles_payload["data"]
        .as_array()
        .and_then(|roles| roles.iter().find(|role| role["key"] == "super_admin"))
        .and_then(|role| role["id"].as_str())
        .expect("system role id must exist");
    let system_update = app
        .clone()
        .oneshot(json_request(
            Method::PATCH,
            &format!("/api/v1/admin/authorization/roles/{system_role_id}"),
            json!({
                "name": "Changed root",
                "permission_keys": ["authorization.roles.read"],
                "expected_revision": 1
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("system role update must respond");
    assert_eq!(system_update.status(), StatusCode::CONFLICT);
    assert_eq!(
        response_json(system_update).await["error"]["code"],
        "authorization.role_system_managed"
    );

    let deleted = app
        .clone()
        .oneshot(json_request(
            Method::DELETE,
            &format!("/api/v1/admin/authorization/roles/{role_id}"),
            json!(null),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("custom role deletion must respond");
    assert_eq!(deleted.status(), StatusCode::OK);
    assert_eq!(response_json(deleted).await["data"], true);

    let openapi = app
        .oneshot(get_request("/api/v1/openapi.json", ""))
        .await
        .expect("OpenAPI document must respond");
    let document = response_json(openapi).await;
    assert!(document["paths"]["/api/v1/admin/authorization/roles"]["post"].is_object());
    assert!(document["paths"]["/api/v1/admin/authorization/roles/{role_id}"]["patch"].is_object());
    assert!(document["paths"]["/api/v1/admin/authorization/roles/{role_id}"]["delete"].is_object());
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn role_assignment_api_exposes_scope_mode_uniqueness_and_revocation(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool), config);
    initialize(&app).await;
    let member = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/auth/register",
            json!({
                "username": "assignment_member",
                "email": "assignment_member@example.com",
                "display_name": "Assignment member",
                "password": "correct horse battery staple"
            }),
            "",
            None,
        ))
        .await
        .expect("member registration must respond");
    assert_eq!(member.status(), StatusCode::CREATED);
    let (owner_cookies, owner_csrf) = login_owner(&app).await;
    let boards = app
        .clone()
        .oneshot(get_request("/api/v1/admin/boards", &owner_cookies))
        .await
        .expect("board list must respond");
    let board_id = response_json(boards).await["data"][0]["id"]
        .as_str()
        .expect("default board id must exist")
        .to_owned();
    let role = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/authorization/roles",
            json!({
                "key": "assignment_api_moderator",
                "name": "Assignment API moderator",
                "scope": "board",
                "permission_keys": ["moderation.topic"]
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("role creation must respond");
    let role_id = response_json(role).await["data"]["id"]
        .as_str()
        .expect("role id must exist")
        .to_owned();

    let created = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/authorization/assignments",
            json!({
                "username": "assignment_member",
                "role_id": role_id,
                "scope_id": board_id,
                "scope_mode": "subtree"
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("assignment creation must respond");
    assert_eq!(created.status(), StatusCode::CREATED);
    let assignment_payload = response_json(created).await;
    let assignment_id = assignment_payload["data"]["id"]
        .as_str()
        .expect("assignment id must exist");
    assert_eq!(
        assignment_payload["data"]["user"]["username"],
        "assignment_member"
    );
    assert_eq!(assignment_payload["data"]["scope_id"], board_id);
    assert_eq!(assignment_payload["data"]["scope_mode"], "subtree");

    let duplicate = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/authorization/assignments",
            json!({
                "username": "assignment_member",
                "role_id": role_id,
                "scope_id": board_id
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("duplicate assignment must respond");
    assert_eq!(duplicate.status(), StatusCode::CONFLICT);
    assert_eq!(
        response_json(duplicate).await["error"]["code"],
        "authorization.assignment_conflict"
    );

    let invalid_scope = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/authorization/assignments",
            json!({
                "username": "assignment_member",
                "role_id": role_id,
                "scope_id": null
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("invalid scope assignment must respond");
    assert_eq!(invalid_scope.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        response_json(invalid_scope).await["error"]["code"],
        "authorization.scope_invalid"
    );

    let deleted = app
        .clone()
        .oneshot(json_request(
            Method::DELETE,
            &format!("/api/v1/admin/authorization/assignments/{assignment_id}"),
            json!(null),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("assignment deletion must respond");
    assert_eq!(deleted.status(), StatusCode::OK);
    assert_eq!(response_json(deleted).await["data"], true);

    let openapi = app
        .oneshot(get_request("/api/v1/openapi.json", ""))
        .await
        .expect("OpenAPI document must respond");
    let document = response_json(openapi).await;
    assert!(document["paths"]["/api/v1/admin/authorization/assignments"]["post"].is_object());
    let create_parameters =
        document["paths"]["/api/v1/admin/authorization/assignments"]["post"]["parameters"]
            .as_array()
            .expect("assignment creation parameters must be documented");
    assert!(
        create_parameters.iter().any(|parameter| {
            parameter["name"] == "x-csrf-token" && parameter["in"] == "header"
        })
    );
    assert!(
        document["paths"]["/api/v1/admin/authorization/assignments/{assignment_id}"]["delete"]
            .is_object()
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn standard_entitlement_api_publishes_grants_replays_revokes_and_documents(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool), config);
    initialize(&app).await;
    let member = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/auth/register",
            json!({
                "username": "entitlement_member",
                "email": "entitlement_member@example.com",
                "display_name": "Entitlement member",
                "password": "correct horse battery staple"
            }),
            "",
            None,
        ))
        .await
        .expect("member registration must respond");
    assert_eq!(member.status(), StatusCode::CREATED);
    let member_id = response_json(member).await["data"]["user"]["id"]
        .as_str()
        .expect("member id must exist")
        .to_owned();
    let (owner_cookies, owner_csrf) = login_owner(&app).await;

    let entitlement_type = app
        .clone()
        .oneshot(json_request(
            Method::PUT,
            "/api/v1/admin/entitlements/types/gold_vip",
            json!({
                "display_name": "Gold VIP",
                "permission_keys": ["topic.poll.create"],
                "quotas": {"attachment.file.bytes": 20971520},
                "expected_revision": null
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("entitlement type publication must respond");
    assert_eq!(entitlement_type.status(), StatusCode::OK);
    let entitlement_type_payload = response_json(entitlement_type).await;
    let entitlement_type_id = entitlement_type_payload["data"]["id"]
        .as_str()
        .expect("entitlement type id must exist")
        .to_owned();
    assert_eq!(entitlement_type_payload["data"]["current_version"], 1);

    let grant_body = json!({
        "user_id": member_id,
        "entitlement_type_id": entitlement_type_id,
        "source": "admin",
        "source_reference_id": null,
        "reason": "Manual VIP grant",
        "starts_at": "2020-01-01T00:00:00Z",
        "ends_at": "2030-01-01T00:00:00Z",
        "idempotency_key": "api-grant-gold-vip"
    });
    let granted = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/entitlements",
            grant_body.clone(),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("entitlement grant must respond");
    assert_eq!(granted.status(), StatusCode::OK);
    let granted_payload = response_json(granted).await;
    let entitlement_id = granted_payload["data"]["entitlement"]["id"]
        .as_str()
        .expect("entitlement id must exist")
        .to_owned();
    assert_eq!(granted_payload["data"]["replayed"], false);
    assert_eq!(
        granted_payload["data"]["entitlement"]["entitlement_key"],
        "gold_vip"
    );

    let replayed = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/entitlements",
            grant_body,
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("entitlement replay must respond");
    assert_eq!(replayed.status(), StatusCode::OK);
    assert_eq!(response_json(replayed).await["data"]["replayed"], true);

    let revoked = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            &format!("/api/v1/admin/entitlements/{entitlement_id}/revoke"),
            json!({
                "expected_revision": 1,
                "reason": "Refund",
                "idempotency_key": "api-revoke-gold-vip"
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("entitlement revocation must respond");
    assert_eq!(revoked.status(), StatusCode::OK);
    let revoked_payload = response_json(revoked).await;
    assert_eq!(revoked_payload["data"]["entitlement"]["revision"], 2);
    assert!(revoked_payload["data"]["entitlement"]["revoked_at"].is_string());

    let openapi = app
        .oneshot(get_request("/api/v1/openapi.json", ""))
        .await
        .expect("OpenAPI document must respond");
    let document = response_json(openapi).await;
    assert!(
        document["paths"]["/api/v1/admin/entitlements/types/{internal_key}"]["put"].is_object()
    );
    assert!(document["paths"]["/api/v1/admin/entitlements"]["post"].is_object());
    assert!(
        document["paths"]["/api/v1/admin/entitlements/{entitlement_id}/revoke"]["post"].is_object()
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn public_branding_fails_open_when_redis_is_unavailable(pool: PgPool) {
    let cache = daoyun_api::CacheConfig::from_redis_url("redis://127.0.0.1:1/0", false)
        .expect("loopback Redis configuration must be valid")
        .build()
        .expect("Redis cache must initialize lazily");
    let app = daoyun_api::app_with_runtime(
        Database::from_pool(pool),
        daoyun_api::AuthConfig::default().with_secure_cookies(false),
        cache,
    );
    initialize(&app).await;

    let response = app
        .oneshot(get_request("/api/v1/site-branding", ""))
        .await
        .expect("public branding must respond despite cache failure");
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response_json(response).await["data"]["site_name"], "刀云");
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn board_permission_matrix_explains_entitlement_upload_without_consuming_quota(pool: PgPool) {
    let app = daoyun_api::app_with_config(
        Database::from_pool(pool.clone()),
        daoyun_api::AuthConfig::default().with_secure_cookies(false),
    );
    initialize(&app).await;
    let registered = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/auth/register",
            json!({
                "username": "matrix_member", "email": "matrix_member@example.com",
                "display_name": "矩阵会员", "password": "correct horse battery staple"
            }),
            "",
            None,
        ))
        .await
        .unwrap();
    assert_eq!(registered.status(), StatusCode::CREATED);
    let (member_cookies, _) = session_cookies(&registered).await;
    let user_id = response_json(registered).await["data"]["user"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    sqlx::query(
        "DELETE FROM community_group_permissions WHERE permission_key = 'attachment.upload'",
    )
    .execute(&pool)
    .await
    .unwrap();
    let (cookies, csrf) = login_owner(&app).await;
    let board = app.clone().oneshot(json_request(Method::POST, "/api/v1/admin/boards", json!({
        "name": "权限矩阵", "slug": "matrix-board", "description": "", "position": 1,
        "parent_id": null, "visibility": "public", "status": "open", "icon": "messages", "tone": "green"
    }), &cookies, Some(&csrf))).await.unwrap();
    assert_eq!(board.status(), StatusCode::CREATED);
    let board_id = response_json(board).await["data"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let published = app
        .clone()
        .oneshot(json_request(
            Method::PUT,
            "/api/v1/admin/entitlements/types/matrix_upload",
            json!({
                "display_name": "上传权益", "permission_keys": ["attachment.upload"],
                "quotas": {"attachment.upload.daily": 20, "attachment.file.bytes": 20971520},
                "expected_revision": null
            }),
            &cookies,
            Some(&csrf),
        ))
        .await
        .unwrap();
    assert_eq!(published.status(), StatusCode::OK);
    let entitlement_type_id = response_json(published).await["data"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let granted = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/entitlements",
            json!({
                "user_id": user_id, "entitlement_type_id": entitlement_type_id, "source": "admin",
                "source_reference_id": null, "reason": "只读矩阵来源测试",
                "starts_at": "2020-01-01T00:00:00Z", "ends_at": "2030-01-01T00:00:00Z",
                "idempotency_key": "matrix-upload-grant"
            }),
            &cookies,
            Some(&csrf),
        ))
        .await
        .unwrap();
    assert_eq!(granted.status(), StatusCode::OK);
    let before: i64 = sqlx::query_scalar("SELECT count(*) FROM community_quota_usage")
        .fetch_one(&pool)
        .await
        .unwrap();
    for _ in 0..2 {
        let response = app
            .clone()
            .oneshot(get_request(
                &format!("/api/v1/admin/boards/{board_id}/permission-matrix?user_id={user_id}"),
                &cookies,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let request_id = response.headers()["x-request-id"]
            .to_str()
            .unwrap()
            .to_owned();
        let payload = response_json(response).await;
        assert_eq!(payload["meta"]["request_id"], request_id);
        assert_eq!(payload["data"]["board_id"], board_id);
        assert!(payload["data"]["evaluated_at"].is_string());
        let scenario = &payload["data"]["scenarios"][0];
        assert_eq!(scenario["kind"], "user");
        let upload = scenario["actions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|action| action["action"] == "attachment_upload")
            .unwrap();
        assert_eq!(upload["decision"], "missing_context");
        assert_eq!(upload["permission_provided"], true);
        assert!(upload["source_ids"].as_array().unwrap().iter().any(|id| {
            scenario["sources"]
                .as_array()
                .unwrap()
                .iter()
                .any(|source| {
                    source["id"] == *id
                        && source["kind"] == "entitlement"
                        && source["key"] == "matrix_upload"
                })
        }));
        let quota = scenario["quotas"]
            .as_array()
            .unwrap()
            .iter()
            .find(|quota| quota["key"] == "attachment.upload.daily")
            .unwrap();
        assert_eq!(quota["limit"], 20);
        assert_eq!(quota["used"], 0);
    }
    let after: i64 = sqlx::query_scalar("SELECT count(*) FROM community_quota_usage")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        after, before,
        "matrix reads must never create quota consumption rows"
    );
    let denied = app
        .clone()
        .oneshot(get_request(
            &format!("/api/v1/admin/boards/{board_id}/permission-matrix?user_id={user_id}"),
            "",
        ))
        .await
        .unwrap();
    assert_eq!(denied.status(), StatusCode::UNAUTHORIZED);

    let forbidden = app
        .clone()
        .oneshot(get_request(
            &format!("/api/v1/admin/boards/{board_id}/permission-matrix?user_id={user_id}"),
            &member_cookies,
        ))
        .await
        .unwrap();
    assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);
    let forbidden_id = forbidden.headers()["x-request-id"]
        .to_str()
        .unwrap()
        .to_owned();
    let forbidden_body = response_json(forbidden).await;
    assert_eq!(forbidden_body["meta"]["request_id"], forbidden_id);
    assert!(forbidden_body.get("data").is_none());
    for query in ["", "?group_ids=invalid", "?unexpected=true"] {
        let invalid = app
            .clone()
            .oneshot(get_request(
                &format!("/api/v1/admin/boards/{board_id}/permission-matrix{query}"),
                &cookies,
            ))
            .await
            .unwrap();
        assert_eq!(invalid.status(), StatusCode::UNPROCESSABLE_ENTITY);
        let id = invalid.headers()["x-request-id"]
            .to_str()
            .unwrap()
            .to_owned();
        assert_eq!(response_json(invalid).await["meta"]["request_id"], id);
    }
    let invalid_path = app
        .clone()
        .oneshot(get_request(
            "/api/v1/admin/boards/invalid/permission-matrix?group_ids=invalid",
            &cookies,
        ))
        .await
        .unwrap();
    assert_eq!(invalid_path.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let invalid_path_id = invalid_path.headers()["x-request-id"]
        .to_str()
        .unwrap()
        .to_owned();
    assert_eq!(
        response_json(invalid_path).await["meta"]["request_id"],
        invalid_path_id
    );

    let group_id: Uuid = sqlx::query_scalar("SELECT group_id FROM community_group_memberships WHERE user_id = $1 AND revoked_at IS NULL LIMIT 1")
        .bind(Uuid::parse_str(&user_id).unwrap()).fetch_one(&pool).await.unwrap();
    let group_read = app
        .clone()
        .oneshot(get_request(
            &format!("/api/v1/admin/boards/{board_id}/permission-matrix?group_ids={group_id}"),
            &cookies,
        ))
        .await
        .unwrap();
    assert_eq!(group_read.status(), StatusCode::OK);
    let group_data = response_json(group_read).await;
    assert_eq!(group_data["data"]["scenarios"][0]["complete"], false);
    let group_upload = group_data["data"]["scenarios"][0]["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|action| action["action"] == "attachment_upload")
        .unwrap();
    assert_eq!(group_upload["decision"], "not_provided");
    for ids in [
        format!("{group_id},{group_id}"),
        std::iter::repeat_n(group_id.to_string(), 5)
            .collect::<Vec<_>>()
            .join(","),
    ] {
        let invalid = app
            .clone()
            .oneshot(get_request(
                &format!("/api/v1/admin/boards/{board_id}/permission-matrix?group_ids={ids}"),
                &cookies,
            ))
            .await
            .unwrap();
        assert_eq!(invalid.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }
    sqlx::query("INSERT INTO community_quota_usage(user_id, quota_key, window_start, used) VALUES ($1, 'attachment.upload.daily', $2, 19)")
        .bind(Uuid::parse_str(&user_id).unwrap()).bind(time::OffsetDateTime::now_utc().date()).execute(&pool).await.unwrap();
    for _ in 0..2 {
        let response = app
            .clone()
            .oneshot(get_request(
                &format!("/api/v1/admin/boards/{board_id}/permission-matrix?user_id={user_id}"),
                &cookies,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let payload = response_json(response).await;
        let quota = payload["data"]["scenarios"][0]["quotas"]
            .as_array()
            .unwrap()
            .iter()
            .find(|quota| quota["key"] == "attachment.upload.daily")
            .unwrap();
        assert_eq!(quota["limit"], 20);
        assert_eq!(quota["used"], 19);
    }
    let usage: (i64, i64) = sqlx::query_as("SELECT used, revision FROM community_quota_usage WHERE user_id = $1 AND quota_key = 'attachment.upload.daily'")
        .bind(Uuid::parse_str(&user_id).unwrap()).fetch_one(&pool).await.unwrap();
    assert_eq!(
        usage,
        (19, 1),
        "read-only checks must not consume or revise existing usage"
    );
    let policy_response = app.clone().oneshot(json_request(Method::PUT,
        &format!("/api/v1/admin/content-access-policies/board/{board_id}"),
        json!({"operator": "any_of", "subjects": [{"subject_type": "governance", "subject_key": "moderation.topic", "community_group_id": null}], "expected_revision": null}),
        &cookies, Some(&csrf)
    )).await.unwrap();
    assert_eq!(policy_response.status(), StatusCode::OK);
    let child = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/boards",
            json!({
                "name": "独立子版", "slug": "matrix-child", "description": "", "position": 0,
                "parent_id": board_id, "visibility": "public", "icon": "messages", "tone": "green"
            }),
            &cookies,
            Some(&csrf),
        ))
        .await
        .unwrap();
    assert_eq!(child.status(), StatusCode::CREATED);
    let child_id = response_json(child).await["data"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    for (id, slug, expected_status, expected_decision) in [
        (&board_id, "matrix-board", StatusCode::FORBIDDEN, "denied"),
        (&child_id, "matrix-child", StatusCode::OK, "allowed"),
    ] {
        let actual = app
            .clone()
            .oneshot(get_request(
                &format!("/api/v1/boards/{slug}"),
                &member_cookies,
            ))
            .await
            .unwrap();
        assert_eq!(actual.status(), expected_status);
        let matrix = app
            .clone()
            .oneshot(get_request(
                &format!("/api/v1/admin/boards/{id}/permission-matrix?user_id={user_id}"),
                &cookies,
            ))
            .await
            .unwrap();
        assert_eq!(matrix.status(), StatusCode::OK);
        let payload = response_json(matrix).await;
        assert_eq!(
            payload["data"]["scenarios"][0]["actions"][0]["decision"],
            expected_decision
        );
    }
    sqlx::query(
        "UPDATE user_standard_entitlements SET ends_at = CURRENT_TIMESTAMP WHERE user_id = $1",
    )
    .bind(Uuid::parse_str(&user_id).unwrap())
    .execute(&pool)
    .await
    .unwrap();
    let expired = app
        .clone()
        .oneshot(get_request(
            &format!("/api/v1/admin/boards/{child_id}/permission-matrix?user_id={user_id}"),
            &cookies,
        ))
        .await
        .unwrap();
    assert_eq!(expired.status(), StatusCode::OK);
    let payload = response_json(expired).await;
    let expired_upload = payload["data"]["scenarios"][0]["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|action| action["action"] == "attachment_upload")
        .unwrap();
    assert_eq!(expired_upload["permission_provided"], false);
    assert_eq!(expired_upload["decision"], "denied");
    assert!(
        payload["data"]["scenarios"][0]["sources"]
            .as_array()
            .unwrap()
            .iter()
            .all(|source| source["kind"] != "entitlement")
    );

    let openapi = response_json(
        app.oneshot(get_request("/api/v1/openapi.json", ""))
            .await
            .unwrap(),
    )
    .await;
    let operation = &openapi["paths"]["/api/v1/admin/boards/{board_id}/permission-matrix"]["get"];
    for code in ["200", "401", "403", "404", "422", "503"] {
        assert!(operation["responses"][code]["headers"]["x-request-id"].is_object());
    }
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn team_last_administrator_revoke_is_denied_and_audited(pool: PgPool) {
    let app = daoyun_api::app_with_config(
        Database::from_pool(pool.clone()),
        daoyun_api::AuthConfig::default().with_secure_cookies(false),
    );
    initialize(&app).await;
    let (cookies, csrf) = login_owner(&app).await;
    let assignment_id: Uuid = sqlx::query_scalar(
        "SELECT assignment.id FROM role_assignments AS assignment
         JOIN roles AS role ON role.id = assignment.role_id
         JOIN users AS account ON account.id = assignment.user_id
         WHERE role.key = 'super_admin' AND account.username = 'owner'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let response = app
        .clone()
        .oneshot(json_request(
            Method::DELETE,
            &format!("/api/v1/admin/authorization/assignments/{assignment_id}"),
            json!(null),
            &cookies,
            Some(&csrf),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CONFLICT);
    let request_id = response.headers()["x-request-id"]
        .to_str()
        .unwrap()
        .to_owned();
    let body = response_json(response).await;
    assert_eq!(body["meta"]["request_id"], request_id);
    assert_eq!(body["error"]["code"], "authorization.role_system_managed");
    let retained: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM role_assignments WHERE id = $1)")
            .bind(assignment_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(retained);
    let denied: Value = sqlx::query_scalar(
        "SELECT summary FROM admin_audit_log
         WHERE action = 'authorization.assignment.delete.denied' AND resource_id = $1",
    )
    .bind(assignment_id)
    .fetch_one(&pool)
    .await
    .expect("protected administrator refusal must be audited");
    assert_eq!(denied["reason"], "authorization.role_system_managed");
    assert_eq!(denied["role_key"], "super_admin");
    assert_eq!(denied["target_username"], "owner");
    let permissions = app
        .oneshot(get_request(
            "/api/v1/admin/authorization/permissions",
            &cookies,
        ))
        .await
        .unwrap();
    assert_eq!(permissions.status(), StatusCode::OK);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn team_scoped_appointment_limits_real_governance_actions(pool: PgPool) {
    let app = daoyun_api::app_with_config(
        Database::from_pool(pool.clone()),
        daoyun_api::AuthConfig::default().with_secure_cookies(false),
    );
    initialize(&app).await;
    let registered = app.clone().oneshot(json_request(
        Method::POST, "/api/v1/auth/register",
        json!({"username": "team_moderator", "email": "team_moderator@example.com", "display_name": "团队版主", "password": "correct horse battery staple"}),
        "", None,
    )).await.unwrap();
    assert_eq!(registered.status(), StatusCode::CREATED);
    let (member_cookies, member_csrf) = session_cookies(&registered).await;
    let (cookies, csrf) = login_owner(&app).await;
    let boards = app
        .clone()
        .oneshot(get_request("/api/v1/admin/boards", &cookies))
        .await
        .unwrap();
    let assigned_board_id = response_json(boards).await["data"][0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut board_ids = vec![assigned_board_id.clone()];
    for (slug, parent_id) in [
        ("team-other", None),
        ("team-child", Some(assigned_board_id.as_str())),
    ] {
        let board = app.clone().oneshot(json_request(
            Method::POST, "/api/v1/admin/boards",
            json!({"name": slug, "slug": slug, "description": "", "position": 1, "parent_id": parent_id, "visibility": "public", "status": "open", "icon": "messages", "tone": "green"}),
            &cookies, Some(&csrf),
        )).await.unwrap();
        assert_eq!(board.status(), StatusCode::CREATED);
        board_ids.push(
            response_json(board).await["data"]["id"]
                .as_str()
                .unwrap()
                .to_owned(),
        );
    }
    let role = app.clone().oneshot(json_request(
        Method::POST, "/api/v1/admin/authorization/roles",
        json!({"key": "team_scoped_moderator", "name": "团队版主", "scope": "board", "permission_keys": ["moderation.topic", "moderation.topic.pin"]}),
        &cookies, Some(&csrf),
    )).await.unwrap();
    assert_eq!(role.status(), StatusCode::CREATED);
    let role_id = response_json(role).await["data"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let assigned = app.clone().oneshot(json_request(
        Method::POST, "/api/v1/admin/authorization/assignments",
        json!({"username": "team_moderator", "role_id": role_id, "scope_id": assigned_board_id, "scope_mode": "exact"}),
        &cookies, Some(&csrf),
    )).await.unwrap();
    assert_eq!(assigned.status(), StatusCode::CREATED);
    let assignment_id = response_json(assigned).await["data"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut topic_ids = Vec::new();
    for (index, board_id) in board_ids.iter().enumerate() {
        let mut request = json_request(
            Method::POST,
            "/api/v1/topics",
            json!({"board_id": board_id, "title": format!("团队作用域 {index}"), "content": "验证真实治理入口的版块边界"}),
            &cookies,
            Some(&csrf),
        );
        request.headers_mut().insert(
            "idempotency-key",
            format!("team-scope-topic-{index}").parse().unwrap(),
        );
        let topic = app.clone().oneshot(request).await.unwrap();
        assert_eq!(topic.status(), StatusCode::CREATED);
        topic_ids.push(
            response_json(topic).await["data"]["id"]
                .as_str()
                .unwrap()
                .to_owned(),
        );
    }
    for (index, topic_id) in topic_ids.iter().enumerate() {
        let response = app
            .clone()
            .oneshot(json_request(
                Method::PATCH,
                &format!("/api/v1/topics/{topic_id}/governance"),
                json!({"action": "pin", "expected_revision": 1, "reason": "核验任命范围"}),
                &member_cookies,
                Some(&member_csrf),
            ))
            .await
            .unwrap();
        let expected = if index == 0 {
            StatusCode::OK
        } else {
            StatusCode::FORBIDDEN
        };
        assert_eq!(
            response.status(),
            expected,
            "exact appointment must exclude sibling and child boards"
        );
        let request_id = response.headers()["x-request-id"]
            .to_str()
            .unwrap()
            .to_owned();
        let body = response_json(response).await;
        assert_eq!(body["meta"]["request_id"], request_id);
        if index == 0 {
            assert_eq!(body["data"]["is_pinned"], true);
        }
    }
    let revoked = app
        .clone()
        .oneshot(json_request(
            Method::DELETE,
            &format!("/api/v1/admin/authorization/assignments/{assignment_id}"),
            json!(null),
            &cookies,
            Some(&csrf),
        ))
        .await
        .unwrap();
    assert_eq!(revoked.status(), StatusCode::OK);
    let assigned = app.clone().oneshot(json_request(
        Method::POST, "/api/v1/admin/authorization/assignments",
        json!({"username": "team_moderator", "role_id": role_id, "scope_id": assigned_board_id, "scope_mode": "subtree"}),
        &cookies, Some(&csrf),
    )).await.unwrap();
    assert_eq!(assigned.status(), StatusCode::CREATED);
    assert_eq!(
        response_json(assigned).await["data"]["scope_mode"],
        "subtree"
    );
    for (index, expected) in [(2, StatusCode::OK), (1, StatusCode::FORBIDDEN)] {
        let response = app
            .clone()
            .oneshot(json_request(
                Method::PATCH,
                &format!("/api/v1/topics/{}/governance", topic_ids[index]),
                json!({"action": "pin", "expected_revision": 1, "reason": "核验子版任命范围"}),
                &member_cookies,
                Some(&member_csrf),
            ))
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            expected,
            "subtree appointment must still exclude unrelated boards"
        );
    }
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn team_delegated_assigner_cannot_elevate_its_own_permissions(pool: PgPool) {
    let app = daoyun_api::app_with_config(
        Database::from_pool(pool.clone()),
        daoyun_api::AuthConfig::default().with_secure_cookies(false),
    );
    initialize(&app).await;
    let registered = app.clone().oneshot(json_request(
        Method::POST, "/api/v1/auth/register",
        json!({"username": "team_assigner", "email": "team_assigner@example.com", "display_name": "有限任命者", "password": "correct horse battery staple"}),
        "", None,
    )).await.unwrap();
    assert_eq!(registered.status(), StatusCode::CREATED);
    let (member_cookies, member_csrf) = session_cookies(&registered).await;
    let (cookies, csrf) = login_owner(&app).await;
    let mut role_ids = Vec::new();
    for (key, scope, permissions) in [
        (
            "team_assignment_delegate",
            "instance",
            vec![
                "authorization.assignments.read",
                "authorization.assignments.write",
            ],
        ),
        ("team_unheld_moderation", "board", vec!["moderation.topic"]),
    ] {
        let response = app
            .clone()
            .oneshot(json_request(
                Method::POST,
                "/api/v1/admin/authorization/roles",
                json!({"key": key, "name": key, "scope": scope, "permission_keys": permissions}),
                &cookies,
                Some(&csrf),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
        role_ids.push(
            response_json(response).await["data"]["id"]
                .as_str()
                .unwrap()
                .to_owned(),
        );
    }
    let assigned = app.clone().oneshot(json_request(
        Method::POST, "/api/v1/admin/authorization/assignments",
        json!({"username": "team_assigner", "role_id": role_ids[0], "scope_id": null, "scope_mode": "exact"}),
        &cookies, Some(&csrf),
    )).await.unwrap();
    assert_eq!(assigned.status(), StatusCode::CREATED);
    let board_id: Uuid = sqlx::query_scalar("SELECT id FROM boards WHERE slug = 'general'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let before: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM role_assignments WHERE user_id = (SELECT id FROM users WHERE username = 'team_assigner')",
    ).fetch_one(&pool).await.unwrap();
    let response = app.oneshot(json_request(
        Method::POST, "/api/v1/admin/authorization/assignments",
        json!({"username": "team_assigner", "role_id": role_ids[1], "scope_id": board_id, "scope_mode": "subtree"}),
        &member_cookies, Some(&member_csrf),
    )).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let request_id = response.headers()["x-request-id"]
        .to_str()
        .unwrap()
        .to_owned();
    let body = response_json(response).await;
    assert_eq!(body["meta"]["request_id"], request_id);
    assert_eq!(body["error"]["code"], "authorization.permission_invalid");
    let after: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM role_assignments WHERE user_id = (SELECT id FROM users WHERE username = 'team_assigner')",
    ).fetch_one(&pool).await.unwrap();
    assert_eq!(after, before);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn permission_check_is_read_only_and_never_authorizes_a_later_upload(pool: PgPool) {
    let app = daoyun_api::app_with_config(
        Database::from_pool(pool.clone()),
        daoyun_api::AuthConfig::default().with_secure_cookies(false),
    );
    initialize(&app).await;
    let registered = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/auth/register",
            json!({
                "username": "check_member", "email": "check_member@example.com",
                "display_name": "检查会员", "password": "correct horse battery staple"
            }),
            "",
            None,
        ))
        .await
        .unwrap();
    assert_eq!(registered.status(), StatusCode::CREATED);
    let (member_cookies, member_csrf) = session_cookies(&registered).await;
    let user_id: Uuid = response_json(registered).await["data"]["user"]["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let (cookies, csrf) = login_owner(&app).await;
    let board = app.clone().oneshot(json_request(Method::POST, "/api/v1/admin/boards", json!({
        "name": "权限检查", "slug": "permission-check-board", "description": "", "position": 1,
        "parent_id": null, "visibility": "public", "status": "open", "icon": "messages", "tone": "green"
    }), &cookies, Some(&csrf))).await.unwrap();
    assert_eq!(board.status(), StatusCode::CREATED);
    let board_id: Uuid = response_json(board).await["data"]["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let mut topic_request = json_request(
        Method::POST,
        "/api/v1/topics",
        json!({
            "board_id": board_id, "title": "检查不能代替授权", "content": "真实主题正文"
        }),
        &member_cookies,
        Some(&member_csrf),
    );
    topic_request
        .headers_mut()
        .insert("idempotency-key", "permission-check-topic".parse().unwrap());
    let topic = app.clone().oneshot(topic_request).await.unwrap();
    assert_eq!(topic.status(), StatusCode::CREATED);
    let topic_id: Uuid = response_json(topic).await["data"]["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    sqlx::query(
        "DELETE FROM community_group_permissions WHERE permission_key = 'attachment.upload'",
    )
    .execute(&pool)
    .await
    .unwrap();
    let group_id = Uuid::now_v7();
    let membership_id = Uuid::now_v7();
    sqlx::query("INSERT INTO community_groups(id,internal_key,display_name,display_order) VALUES ($1,'check_upload','检查上传组',100)")
        .bind(group_id).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO community_group_permissions(group_id,permission_key) VALUES ($1,'attachment.upload')")
        .bind(group_id).execute(&pool).await.unwrap();
    for (key, amount) in [
        ("attachment.upload.daily", 20_i64),
        ("attachment.file.bytes", 100),
        ("attachment.storage.bytes", 100),
    ] {
        sqlx::query("INSERT INTO community_group_quota_rules(group_id,quota_key,quota_value) VALUES ($1,$2,$3)")
            .bind(group_id).bind(key).bind(amount).execute(&pool).await.unwrap();
    }
    sqlx::query("INSERT INTO community_group_memberships(id,user_id,group_id,membership_kind,source,reason,idempotency_key) VALUES ($1,$2,$3,'additional','admin','只读检查测试','permission-check-membership')")
        .bind(membership_id).bind(user_id).bind(group_id).execute(&pool).await.unwrap();
    // 使全局 MAX 的文件／存储额度与本测试边界一致。
    sqlx::query("UPDATE community_group_quota_rules SET quota_value=100 WHERE quota_key IN ('attachment.file.bytes','attachment.storage.bytes')").execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO community_quota_usage(user_id,quota_key,window_start,used,revision) VALUES ($1,'attachment.upload.daily',(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date,19,1)")
        .bind(user_id).execute(&pool).await.unwrap();
    let uri = format!(
        "/api/v1/admin/permission-check?board_id={board_id}&user_id={user_id}&action=attachment_upload&topic_id={topic_id}&file_bytes=68"
    );
    let before = check_side_effect_counts(&pool, user_id).await;
    for _ in 0..10 {
        let response = app
            .clone()
            .oneshot(get_request(&uri, &cookies))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()["cache-control"], "no-store");
        let request_id = response.headers()["x-request-id"]
            .to_str()
            .unwrap()
            .to_owned();
        let payload = response_json(response).await;
        assert_eq!(payload["meta"]["request_id"], request_id);
        assert_eq!(
            payload["data"]["scenario"]["actions"][0]["decision"],
            "allowed"
        );
        let sources = payload["data"]["scenario"]["sources"].as_array().unwrap();
        assert_eq!(sources.iter().filter(|s| s["kind"] == "group").count(), 2);
        assert_eq!(sources.iter().filter(|s| s["kind"] == "role").count(), 1);
        let action_sources = payload["data"]["scenario"]["actions"][0]["source_ids"]
            .as_array()
            .unwrap();
        assert!(
            sources
                .iter()
                .filter(|s| s["kind"] == "role")
                .all(|s| !action_sources.contains(&s["id"]))
        );
        assert_eq!(payload["data"]["file_bytes"], 68);
    }
    assert_eq!(check_side_effect_counts(&pool, user_id).await, before);
    for query in [
        "file_bytes=101",
        "file_bytes=52428801",
        "file_bytes=0",
        "at=2099-01-01",
        "action=governance_delete",
        "user_id=invalid",
    ] {
        let response = app.clone().oneshot(get_request(&format!("/api/v1/admin/permission-check?board_id={board_id}&user_id={user_id}&action=attachment_upload&topic_id={topic_id}&{query}"), &cookies)).await.unwrap();
        if query == "file_bytes=101" {
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(
                response_json(response).await["data"]["scenario"]["actions"][0]["decision"],
                "denied"
            );
        } else {
            assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
            let request_id = response.headers()["x-request-id"]
                .to_str()
                .unwrap()
                .to_owned();
            assert_eq!(
                response_json(response).await["meta"]["request_id"],
                request_id
            );
        }
    }
    let missing = app.clone().oneshot(get_request(&format!("/api/v1/admin/permission-check?board_id={board_id}&user_id={user_id}&action=attachment_upload"), &cookies)).await.unwrap();
    assert_eq!(
        response_json(missing).await["data"]["scenario"]["actions"][0]["decision"],
        "missing_context"
    );
    let owner_id: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE username='owner'")
        .fetch_one(&pool)
        .await
        .unwrap();
    for subject in [owner_id, user_id, Uuid::now_v7()] {
        let response = app.clone().oneshot(get_request(&format!("/api/v1/admin/permission-check?board_id={board_id}&user_id={subject}&action=browse"), &member_cookies)).await.unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        let payload = response_json(response).await;
        assert!(payload.get("data").is_none());
        assert!(!payload.to_string().contains("source_ids"));
        assert!(!payload.to_string().contains("permission_keys"));
    }
    // 撤销唯一来源之后，实际上传重新鉴权，先前诊断不能放行。
    sqlx::query("UPDATE community_group_memberships SET revoked_at=CURRENT_TIMESTAMP,revocation_reason='撤销测试来源',revoke_idempotency_key='check-revoke' WHERE id=$1")
        .bind(membership_id).execute(&pool).await.unwrap();
    let png: &[u8] = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x04\x00\x00\x00\xb5\x1c\x0c\x02\x00\x00\x00\x0bIDATx\xda\x63d\xf8\x0f\x00\x01\x05\x01\x01'\x18\xe3f\x00\x00\x00\x00IEND\xaeB\x60\x82";
    let upload = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v1/topics/{topic_id}/attachments"))
                .header("cookie", &member_cookies)
                .header("x-csrf-token", &member_csrf)
                .header("content-type", "image/png")
                .header("x-file-name", "check.png")
                .body(Body::from(png))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(upload.status(), StatusCode::FORBIDDEN);
    assert_eq!(check_side_effect_counts(&pool, user_id).await, before);
    let denied = app
        .clone()
        .oneshot(get_request(&uri, &cookies))
        .await
        .unwrap();
    assert_eq!(
        response_json(denied).await["data"]["scenario"]["actions"][0]["reason"],
        "community.permission_not_provided"
    );
    let openapi = serde_json::to_value(daoyun_api::openapi_document()).unwrap();
    let operation = &openapi["paths"]["/api/v1/admin/permission-check"]["get"];
    assert_eq!(operation["operationId"], "getPermissionCheck");
    for status in ["200", "401", "403", "404", "422", "503"] {
        assert!(operation["responses"][status]["headers"]["x-request-id"].is_object());
    }
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn permission_check_matches_resource_states_sizes_and_real_attachment_reads(pool: PgPool) {
    let app = daoyun_api::app_with_config(
        Database::from_pool(pool.clone()),
        daoyun_api::AuthConfig::default().with_secure_cookies(false),
    );
    initialize(&app).await;
    let registered = app.clone().oneshot(json_request(Method::POST, "/api/v1/auth/register", json!({
        "username": "check_resource", "email": "check_resource@example.com", "display_name": "资源检查会员", "password": "correct horse battery staple"
    }), "", None)).await.unwrap();
    assert_eq!(registered.status(), StatusCode::CREATED);
    let (member_cookies, member_csrf) = session_cookies(&registered).await;
    let user_id: Uuid = response_json(registered).await["data"]["user"]["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let (cookies, csrf) = login_owner(&app).await;
    let board = app.clone().oneshot(json_request(Method::POST, "/api/v1/admin/boards", json!({
        "name": "资源条件检查", "slug": "check-resources", "description": "", "position": 1,
        "parent_id": null, "visibility": "public", "status": "open", "icon": "messages", "tone": "green"
    }), &cookies, Some(&csrf))).await.unwrap();
    assert_eq!(board.status(), StatusCode::CREATED);
    let board_id: Uuid = response_json(board).await["data"]["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let mut request = json_request(
        Method::POST,
        "/api/v1/topics",
        json!({"board_id": board_id, "title": "检查资源状态", "content": "资源状态正文"}),
        &member_cookies,
        Some(&member_csrf),
    );
    request
        .headers_mut()
        .insert("idempotency-key", "check-resource-topic".parse().unwrap());
    let topic = app.clone().oneshot(request).await.unwrap();
    assert_eq!(topic.status(), StatusCode::CREATED);
    let topic_id: Uuid = response_json(topic).await["data"]["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let uri = format!("/api/v1/admin/permission-check?board_id={board_id}&user_id={user_id}");
    for action in ["browse", "topic_create", "reply_create"] {
        let context = if action == "topic_create" {
            String::new()
        } else {
            format!("&topic_id={topic_id}")
        };
        let response = app
            .clone()
            .oneshot(get_request(
                &format!("{uri}&action={action}{context}"),
                &cookies,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response_json(response).await["data"]["scenario"]["actions"][0]["decision"],
            "allowed"
        );
    }
    sqlx::query("UPDATE topics SET locked_at=CURRENT_TIMESTAMP,locked_by=author_id WHERE id=$1")
        .bind(topic_id)
        .execute(&pool)
        .await
        .unwrap();
    let locked = app
        .clone()
        .oneshot(get_request(
            &format!("{uri}&action=reply_create&topic_id={topic_id}"),
            &cookies,
        ))
        .await
        .unwrap();
    assert_eq!(
        response_json(locked).await["data"]["scenario"]["actions"][0]["reason"],
        "topic.locked"
    );
    sqlx::query("UPDATE topics SET locked_at=NULL,locked_by=NULL WHERE id=$1")
        .bind(topic_id)
        .execute(&pool)
        .await
        .unwrap();
    let owner_id: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE username='owner'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let not_owner = app.clone().oneshot(get_request(&format!("/api/v1/admin/permission-check?board_id={board_id}&user_id={owner_id}&action=attachment_upload&topic_id={topic_id}&file_bytes=68"), &cookies)).await.unwrap();
    assert_eq!(
        response_json(not_owner).await["data"]["scenario"]["actions"][0]["reason"],
        "attachment.owner_required"
    );
    let other_board: Uuid =
        sqlx::query_scalar("SELECT id FROM boards WHERE id<>$1 AND deleted_at IS NULL LIMIT 1")
            .bind(board_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let mismatch = app.clone().oneshot(get_request(&format!("/api/v1/admin/permission-check?board_id={other_board}&user_id={user_id}&action=reply_create&topic_id={topic_id}"), &cookies)).await.unwrap();
    assert_eq!(mismatch.status(), StatusCode::UNPROCESSABLE_ENTITY);
    sqlx::query("UPDATE boards SET visibility='hidden' WHERE id=$1")
        .bind(board_id)
        .execute(&pool)
        .await
        .unwrap();
    let hidden_upload = app
        .clone()
        .oneshot(get_request(
            &format!("{uri}&action=attachment_upload&topic_id={topic_id}&file_bytes=68"),
            &cookies,
        ))
        .await
        .unwrap();
    assert_eq!(
        response_json(hidden_upload).await["data"]["scenario"]["actions"][0]["decision"],
        "allowed"
    );
    let png: &[u8] = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x04\x00\x00\x00\xb5\x1c\x0c\x02\x00\x00\x00\x0bIDATx\xda\x63d\xf8\x0f\x00\x01\x05\x01\x01'\x18\xe3f\x00\x00\x00\x00IEND\xaeB\x60\x82";
    let upload = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v1/topics/{topic_id}/attachments"))
                .header("cookie", &member_cookies)
                .header("x-csrf-token", &member_csrf)
                .header("content-type", "image/png")
                .header("x-file-name", "state.png")
                .body(Body::from(png))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(upload.status(), StatusCode::CREATED);
    let attachment_id: Uuid = response_json(upload).await["data"]["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    sqlx::query("UPDATE boards SET visibility='public' WHERE id=$1")
        .bind(board_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE community_group_quota_rules SET quota_value=150 WHERE quota_key='attachment.download.bytes.daily'").execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO community_quota_usage(user_id,quota_key,window_start,used,revision) VALUES ($1,'attachment.download.bytes.daily',(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date,100,1)").bind(user_id).execute(&pool).await.unwrap();
    let download_uri = format!("{uri}&action=attachment_download&attachment_id={attachment_id}");
    let too_big = app
        .clone()
        .oneshot(get_request(&download_uri, &cookies))
        .await
        .unwrap();
    assert_eq!(
        response_json(too_big).await["data"]["scenario"]["actions"][0]["reason"],
        "community.quota_exhausted"
    );
    let actual = app
        .clone()
        .oneshot(get_request(
            &format!("/api/v1/attachments/{attachment_id}"),
            &member_cookies,
        ))
        .await
        .unwrap();
    assert_eq!(actual.status(), StatusCode::TOO_MANY_REQUESTS);
    sqlx::query("UPDATE community_quota_usage SET used=82 WHERE user_id=$1 AND quota_key='attachment.download.bytes.daily'").bind(user_id).execute(&pool).await.unwrap();
    let exact = app
        .clone()
        .oneshot(get_request(&download_uri, &cookies))
        .await
        .unwrap();
    assert_eq!(
        response_json(exact).await["data"]["scenario"]["actions"][0]["decision"],
        "allowed"
    );
    let actual = app
        .clone()
        .oneshot(get_request(
            &format!("/api/v1/attachments/{attachment_id}"),
            &member_cookies,
        ))
        .await
        .unwrap();
    assert_eq!(actual.status(), StatusCode::OK);
    let used: i64 = sqlx::query_scalar("SELECT used FROM community_quota_usage WHERE user_id=$1 AND quota_key='attachment.download.bytes.daily'").bind(user_id).fetch_one(&pool).await.unwrap();
    assert_eq!(used, 150);
    sqlx::query("UPDATE community_quota_usage SET used=0 WHERE user_id=$1 AND quota_key='attachment.download.bytes.daily'").bind(user_id).execute(&pool).await.unwrap();
    for (scan, deleted) in [
        ("infected", false),
        ("pending", false),
        ("error", false),
        ("clean", true),
    ] {
        sqlx::query("UPDATE topic_attachments SET scan_status=$2,deleted_at=CASE WHEN $3 THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id=$1")
            .bind(attachment_id).bind(scan).bind(deleted).execute(&pool).await.unwrap();
        let checked = app
            .clone()
            .oneshot(get_request(&download_uri, &cookies))
            .await
            .unwrap();
        assert_eq!(
            response_json(checked).await["data"]["scenario"]["actions"][0]["reason"],
            "resource.unavailable",
            "state {scan}, deleted {deleted}"
        );
        let actual = app
            .clone()
            .oneshot(get_request(
                &format!("/api/v1/attachments/{attachment_id}"),
                &member_cookies,
            ))
            .await
            .unwrap();
        assert_eq!(actual.status(), StatusCode::NOT_FOUND);
        let thumbnail = app
            .clone()
            .oneshot(get_request(
                &format!("/api/v1/attachments/{attachment_id}/thumbnail"),
                &member_cookies,
            ))
            .await
            .unwrap();
        assert_eq!(thumbnail.status(), StatusCode::NOT_FOUND);
        let listed = app
            .clone()
            .oneshot(get_request(
                &format!("/api/v1/topics/{topic_id}/attachments"),
                &member_cookies,
            ))
            .await
            .unwrap();
        assert_eq!(listed.status(), StatusCode::OK);
        assert!(
            response_json(listed).await["data"]
                .as_array()
                .unwrap()
                .is_empty()
        );
    }
    let used: i64 = sqlx::query_scalar("SELECT used FROM community_quota_usage WHERE user_id=$1 AND quota_key='attachment.download.bytes.daily'").bind(user_id).fetch_one(&pool).await.unwrap();
    assert_eq!(used, 0);
    // 最高管理身份只豁免上传额度，仍须拥有上传能力并上传到自己的主题。
    let mut request = json_request(
        Method::POST,
        "/api/v1/topics",
        json!({"board_id": board_id, "title": "管理者上传", "content": "管理者正文"}),
        &cookies,
        Some(&csrf),
    );
    request
        .headers_mut()
        .insert("idempotency-key", "check-owner-topic".parse().unwrap());
    let topic = app.clone().oneshot(request).await.unwrap();
    assert_eq!(topic.status(), StatusCode::CREATED);
    let owner_topic: Uuid = response_json(topic).await["data"]["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    sqlx::query("UPDATE community_group_quota_rules SET quota_value=0 WHERE quota_key IN ('attachment.upload.daily','attachment.file.bytes','attachment.storage.bytes')").execute(&pool).await.unwrap();
    let checked = app.clone().oneshot(get_request(&format!("/api/v1/admin/permission-check?board_id={board_id}&user_id={owner_id}&action=attachment_upload&topic_id={owner_topic}&file_bytes=68"), &cookies)).await.unwrap();
    assert_eq!(
        response_json(checked).await["data"]["scenario"]["actions"][0]["decision"],
        "allowed"
    );
    let upload = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v1/topics/{owner_topic}/attachments"))
                .header("cookie", &cookies)
                .header("x-csrf-token", &csrf)
                .header("content-type", "image/png")
                .header("x-file-name", "owner.png")
                .body(Body::from(png))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(upload.status(), StatusCode::CREATED);
}

async fn check_side_effect_counts(pool: &PgPool, user_id: Uuid) -> (i64, i64, i64, i64, i64) {
    sqlx::query_as("SELECT
        (SELECT used FROM community_quota_usage WHERE user_id=$1 AND quota_key='attachment.upload.daily'),
        (SELECT revision FROM community_quota_usage WHERE user_id=$1 AND quota_key='attachment.upload.daily'),
        (SELECT count(*) FROM point_ledger_entries),
        (SELECT count(*) FROM admin_audit_log),
        (SELECT COALESCE(sum(size_bytes),0)::bigint FROM topic_attachments WHERE uploader_id=$1 AND deleted_at IS NULL)")
        .bind(user_id).fetch_one(pool).await.unwrap()
}

async fn initialize(app: &axum::Router) {
    let response = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/installation",
            json!({
                "username": "owner",
                "email": "owner@example.com",
                "display_name": "管理员",
                "password": "correct horse battery staple"
            }),
            "",
            None,
        ))
        .await
        .expect("installation must respond");
    assert_eq!(response.status(), StatusCode::CREATED);
}

async fn login_owner(app: &axum::Router) -> (String, String) {
    let response = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/auth/login",
            json!({"identifier": "owner", "password": "correct horse battery staple"}),
            "",
            None,
        ))
        .await
        .expect("owner login must respond");
    assert_eq!(response.status(), StatusCode::OK);
    let (cookies, csrf) = session_cookies(&response).await;
    (cookies, csrf)
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

fn get_request(uri: &str, cookies: &str) -> Request<Body> {
    Request::builder()
        .uri(uri)
        .header("cookie", cookies)
        .body(Body::empty())
        .expect("GET request must be valid")
}

fn json_request(
    method: Method,
    uri: &str,
    value: Value,
    cookies: &str,
    csrf: Option<&str>,
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
    builder
        .body(Body::from(value.to_string()))
        .expect("JSON request must be valid")
}

fn asset_request(
    method: Method,
    kind: &str,
    bytes: &[u8],
    content_type: &str,
    cookies: &str,
    csrf: Option<&str>,
) -> Request<Body> {
    let mut request = Request::builder()
        .method(method)
        .uri(format!("/api/v1/admin/site-branding/assets/{kind}"))
        .header("content-type", content_type)
        .header("cookie", cookies);
    if let Some(csrf) = csrf {
        request = request.header("x-csrf-token", csrf);
    }
    request
        .body(Body::from(bytes.to_vec()))
        .expect("brand asset request must build")
}

async fn response_json(response: axum::response::Response) -> Value {
    let body = to_bytes(response.into_body(), 1024 * 1024)
        .await
        .expect("response body must be readable");
    serde_json::from_slice(&body).expect("response must be JSON")
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn governance_permission_check_requires_role_read_and_matches_move_resources(pool: PgPool) {
    let app = daoyun_api::app_with_config(
        Database::from_pool(pool.clone()),
        daoyun_api::AuthConfig::default().with_secure_cookies(false),
    );
    initialize(&app).await;
    let (cookies, _) = login_owner(&app).await;
    let owner: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE username='owner'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let root: Uuid = sqlx::query_scalar("SELECT id FROM boards WHERE slug='general'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let target = Uuid::now_v7();
    let topic = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO boards(id,slug,name) VALUES ($1,'move-destination','Move destination')",
    )
    .bind(target)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO topics(id,board_id,author_id,title,content,status,published_at,governance_revision) VALUES ($1,$2,$3,'Governance check','Body','published',CURRENT_TIMESTAMP,1)")
        .bind(topic).bind(root).bind(owner).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO community_quota_usage(user_id,quota_key,window_start,used,revision) VALUES ($1,'attachment.upload.daily',(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date,0,1)").bind(owner).execute(&pool).await.unwrap();
    let before = check_side_effect_counts(&pool, owner).await;
    let revision: i64 = sqlx::query_scalar("SELECT governance_revision FROM topics WHERE id=$1")
        .bind(topic)
        .fetch_one(&pool)
        .await
        .unwrap();
    for (action, context, decision, reason) in [
        (
            "topic_pin",
            String::new(),
            "missing_context",
            "resource.context_required",
        ),
        (
            "topic_pin",
            format!("&topic_id={topic}"),
            "allowed",
            "governance.conditions_matched",
        ),
        (
            "topic_feature",
            format!("&topic_id={topic}"),
            "allowed",
            "governance.conditions_matched",
        ),
        (
            "topic_lock",
            format!("&topic_id={topic}"),
            "allowed",
            "governance.conditions_matched",
        ),
        (
            "topic_move",
            format!("&topic_id={topic}"),
            "missing_context",
            "resource.context_required",
        ),
        (
            "topic_move",
            format!("&topic_id={topic}&target_board_id={target}"),
            "allowed",
            "governance.conditions_matched",
        ),
        (
            "topic_move",
            format!("&topic_id={topic}&target_board_id={root}"),
            "not_applicable",
            "governance.same_board",
        ),
        (
            "moderation_browse",
            format!("&topic_id={topic}"),
            "allowed",
            "governance.conditions_matched",
        ),
    ] {
        let response = app.clone().oneshot(get_request(&format!("/api/v1/admin/permission-check?board_id={root}&user_id={owner}&action={action}{context}"), &cookies)).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK, "{action} {context}");
        assert_eq!(response.headers()["cache-control"], "no-store");
        let request_id = response.headers()["x-request-id"]
            .to_str()
            .unwrap()
            .to_owned();
        let payload = response_json(response).await;
        assert_eq!(payload["meta"]["request_id"], request_id);
        assert_eq!(payload["data"]["scenario"]["account_status"], "active");
        let result = &payload["data"]["scenario"]["actions"][0];
        assert_eq!(result["decision"], decision);
        assert_eq!(result["reason"], reason);
        assert!(
            payload["data"]["scenario"]["sources"]
                .as_array()
                .unwrap()
                .iter()
                .any(|s| s["kind"] == "role" && s["role"]["scope"] == "instance")
        );
        if action == "topic_move" && context.contains("target_board_id") {
            assert_eq!(
                payload["data"]["target_board_id"],
                if context.ends_with(&target.to_string()) {
                    target.to_string()
                } else {
                    root.to_string()
                }
            );
        }
    }
    assert_eq!(check_side_effect_counts(&pool, owner).await, before);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT governance_revision FROM topics WHERE id=$1")
            .bind(topic)
            .fetch_one(&pool)
            .await
            .unwrap(),
        revision
    );
    // Removing role-read permission must hide all user/assignment capability details.
    sqlx::query("DELETE FROM role_permissions WHERE permission_id=(SELECT id FROM permissions WHERE permission_key='authorization.roles.read')").execute(&pool).await.unwrap();
    for uri in [
        format!("/api/v1/admin/permission-check?board_id={root}&user_id={owner}&action=browse"),
        format!("/api/v1/admin/boards/{root}/permission-matrix?user_id={owner}"),
    ] {
        let response = app
            .clone()
            .oneshot(get_request(&uri, &cookies))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        let request_id = response.headers()["x-request-id"]
            .to_str()
            .unwrap()
            .to_owned();
        let payload = response_json(response).await;
        assert_eq!(payload["meta"]["request_id"], request_id);
        assert!(payload.get("data").is_none());
        assert!(!payload.to_string().contains("source_ids"));
    }
    let group: Uuid = sqlx::query_scalar("SELECT id FROM community_groups LIMIT 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        app.clone()
            .oneshot(get_request(
                &format!("/api/v1/admin/boards/{root}/permission-matrix?group_ids={group}"),
                &cookies
            ))
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    let schema = serde_json::to_value(daoyun_api::openapi_document()).unwrap();
    assert!(
        schema["paths"]["/api/v1/admin/permission-check"]["get"]["parameters"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p["name"] == "target_board_id")
    );
}
