use axum::{
    body::{Body, to_bytes},
    http::{Method, Request, StatusCode},
};
use infrastructure::Database;
use serde_json::{Value, json};
use sqlx::{PgPool, Row};
use std::path::Path;
use tower::ServiceExt;
use uuid::Uuid;

const ONE_BY_ONE_PNG: &[u8] = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x04\x00\x00\x00\xb5\x1c\x0c\x02\x00\x00\x00\x0bIDATx\xda\x63d\xf8\x0f\x00\x01\x05\x01\x01'\x18\xe3f\x00\x00\x00\x00IEND\xaeB`\x82";

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
    for kind in ["topic", "reply", "reply"] {
        sqlx::query(
            "INSERT INTO posts (id, topic_id, author_id, kind, status, content)
             VALUES ($1, $2, $3, $4, 'published', '内容')",
        )
        .bind(Uuid::now_v7())
        .bind(topic_id)
        .bind(owner_id)
        .bind(kind)
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
