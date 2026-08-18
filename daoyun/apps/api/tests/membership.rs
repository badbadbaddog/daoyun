use axum::{
    body::{Body, to_bytes},
    http::{Method, Request, StatusCode},
};
use infrastructure::Database;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn membership_catalog_returns_stable_keys_and_assets(pool: PgPool) {
    let response = daoyun_api::app(Database::from_pool(pool))
        .oneshot(
            Request::builder()
                .uri("/api/v1/membership/catalog")
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
    assert_eq!(payload["meta"]["request_id"], request_id);
    assert_eq!(payload["data"]["member_group"]["key"], "member");
    assert_eq!(payload["data"]["member_group"]["display_name"], "会员");

    let levels = payload["data"]["levels"]
        .as_array()
        .expect("levels must be an array");
    assert_eq!(levels.len(), 6);
    assert_eq!(levels[0]["key"], "lv_1");
    assert_eq!(levels[0]["level_number"], 1);
    assert_eq!(levels[0]["display_name"], "Lv1");
    assert_eq!(levels[5]["key"], "lv_6");
    assert_eq!(levels[5]["level_number"], 6);
    assert!(levels.iter().all(|level| {
        level["asset_url"]
            .as_str()
            .is_some_and(|url| url.starts_with("/assets/membership/levels/"))
    }));

    let medals = payload["data"]["medals"]
        .as_array()
        .expect("medals must be an array");
    assert_eq!(medals.len(), 17);
    assert_eq!(medals[0]["key"], "medal_01");
    assert_eq!(medals[16]["key"], "medal_17");
    assert_eq!(medals[0]["display_name"], "勋章 01");

    let manifest_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../public/assets/membership/manifest.json");
    let manifest: Value = serde_json::from_str(
        &std::fs::read_to_string(manifest_path).expect("membership manifest must be present"),
    )
    .expect("membership manifest must be valid JSON");
    for (catalog_entry, manifest_entry) in levels.iter().zip(
        manifest["levels"]
            .as_array()
            .expect("manifest levels must be an array"),
    ) {
        assert_eq!(catalog_entry["key"], manifest_entry["key"]);
        assert_eq!(catalog_entry["sha256"], manifest_entry["sha256"]);
    }
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn growth_levels_return_published_dynamic_configuration(pool: PgPool) {
    let response = daoyun_api::app(Database::from_pool(pool))
        .oneshot(
            Request::builder()
                .uri("/api/v1/membership/levels")
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
    assert_eq!(payload["meta"]["request_id"], request_id);
    let levels = payload["data"]
        .as_array()
        .expect("growth levels must be an array");
    assert_eq!(levels.len(), 6);
    assert!(Uuid::parse_str(levels[0]["id"].as_str().expect("level id must be text")).is_ok());
    assert_eq!(levels[0]["internal_key"], "lv_1");
    assert_eq!(levels[0]["level_order"], 1);
    assert_eq!(levels[0]["display_name"], "Lv1");
    assert_eq!(levels[0]["required_experience"], 0);
    assert_eq!(levels[5]["internal_key"], "lv_6");
}

#[tokio::test]
async fn openapi_documents_membership_catalog() {
    let response = daoyun_api::app(unavailable_database())
        .oneshot(
            Request::builder()
                .uri("/api/v1/openapi.json")
                .body(Body::empty())
                .expect("request must be valid"),
        )
        .await
        .expect("router must respond");
    let document = response_json(response).await;
    let operation = &document["paths"]["/api/v1/membership/catalog"]["get"];
    assert!(operation.is_object());
    assert!(document["components"]["schemas"]["MembershipCatalog"].is_object());
    assert!(document["components"]["schemas"]["MembershipLevel"].is_object());
    assert!(document["components"]["schemas"]["Medal"].is_object());
    assert!(document["paths"]["/api/v1/users/me/membership"]["get"].is_object());
    assert!(document["components"]["schemas"]["MembershipAccount"].is_object());
    assert!(document["paths"]["/api/v1/membership/levels"]["get"].is_object());
    assert!(document["paths"]["/api/v1/users/me/experience"]["get"].is_object());
    assert!(document["components"]["schemas"]["GrowthLevel"].is_object());
    assert!(document["components"]["schemas"]["ExperienceAccount"].is_object());
    assert!(document["paths"]["/api/v1/admin/membership/levels"]["get"].is_object());
    assert!(document["paths"]["/api/v1/admin/membership/levels"]["post"].is_object());
    assert!(document["paths"]["/api/v1/admin/membership/levels/{level_id}"]["patch"].is_object());
    assert!(document["components"]["schemas"]["AdminGrowthLevel"].is_object());
    assert!(document["paths"]["/api/v1/users/me/groups"]["get"].is_object());
    assert!(document["components"]["schemas"]["CurrentCommunityGroups"].is_object());
    assert!(document["paths"]["/api/v1/admin/community/groups"]["get"].is_object());
    assert!(document["paths"]["/api/v1/admin/community/groups"]["post"].is_object());
    assert!(document["paths"]["/api/v1/admin/community/groups/{group_id}"]["patch"].is_object());
    assert!(document["paths"]["/api/v1/admin/community/memberships"]["post"].is_object());
    assert!(
        document["paths"]["/api/v1/admin/community/memberships/{membership_id}/revoke"]["post"]
            .is_object()
    );
    assert!(document["components"]["schemas"]["AdminCommunityGroup"].is_object());
    assert!(document["components"]["schemas"]["CommunityGroupMembershipMutation"].is_object());
    assert!(
        document["paths"]["/api/v1/admin/content-access-policies/{target_type}/{target_id}"]["get"]
            .is_object()
    );
    assert!(
        document["paths"]["/api/v1/admin/content-access-policies/{target_type}/{target_id}"]["put"]
            .is_object()
    );
    assert!(document["components"]["schemas"]["ContentAccessPolicy"].is_object());
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn admin_growth_levels_use_uuid_revision_and_lifecycle(pool: PgPool) {
    let app = daoyun_api::app_with_config(
        Database::from_pool(pool),
        daoyun_api::AuthConfig::default().with_secure_cookies(false),
    );
    initialize(&app).await;
    let (cookies, csrf) = login(&app, "owner", "correct horse battery staple").await;

    let levels = app
        .clone()
        .oneshot(get_request("/api/v1/admin/membership/levels", &cookies))
        .await
        .expect("admin growth levels must respond");
    assert_eq!(levels.status(), StatusCode::OK);
    assert_eq!(
        response_json(levels).await["data"].as_array().map(Vec::len),
        Some(20)
    );

    let created = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/membership/levels",
            json!({
                "internal_key": "community_veteran",
                "level_order": 21,
                "display_name": "社区元老",
                "required_experience": 1_000_000,
                "icon_asset_id": null,
                "color": "#334455",
                "description": "长期参与社区建设的成员"
            }),
            &cookies,
            Some(&csrf),
        ))
        .await
        .expect("growth level create must respond");
    assert_eq!(created.status(), StatusCode::CREATED);
    let created = response_json(created).await;
    let level_id = created["data"]["id"]
        .as_str()
        .expect("created level id must be text");
    assert!(Uuid::parse_str(level_id).is_ok());
    assert_eq!(created["data"]["status"], "draft");
    assert_eq!(created["data"]["revision"], 1);

    let updated = app
        .clone()
        .oneshot(json_request(
            Method::PATCH,
            &format!("/api/v1/admin/membership/levels/{level_id}"),
            json!({
                "expected_revision": 1,
                "level_order": 21,
                "display_name": "社区元老",
                "required_experience": 1_000_000,
                "icon_asset_id": null,
                "color": "#334455",
                "description": "长期参与社区建设的成员",
                "status": "published"
            }),
            &cookies,
            Some(&csrf),
        ))
        .await
        .expect("growth level publish must respond");
    assert_eq!(updated.status(), StatusCode::OK);
    let updated = response_json(updated).await;
    assert_eq!(updated["data"]["status"], "published");
    assert_eq!(updated["data"]["revision"], 2);
    assert!(updated["data"]["published_at"].is_string());

    let stale = app
        .oneshot(json_request(
            Method::PATCH,
            &format!("/api/v1/admin/membership/levels/{level_id}"),
            json!({
                "expected_revision": 1,
                "level_order": 21,
                "display_name": "陈旧写入",
                "required_experience": 1_000_000,
                "icon_asset_id": null,
                "color": null,
                "description": "stale",
                "status": "published"
            }),
            &cookies,
            Some(&csrf),
        ))
        .await
        .expect("stale growth level update must respond");
    assert_eq!(stale.status(), StatusCode::CONFLICT);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn membership_account_requires_session_and_returns_private_balance(pool: PgPool) {
    let user_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO users (id, username, email, display_name)
         VALUES ($1, 'membership_user', 'membership@example.com', 'Membership User')",
    )
    .bind(user_id)
    .execute(&pool)
    .await
    .expect("user fixture must insert");
    sqlx::query("INSERT INTO membership_accounts (user_id) VALUES ($1)")
        .bind(user_id)
        .execute(&pool)
        .await
        .expect("membership account fixture must insert");
    sqlx::query(
        "INSERT INTO sessions
            (id, user_id, token_hash, csrf_token_hash, idle_expires_at, absolute_expires_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP + INTERVAL '1 hour',
                 CURRENT_TIMESTAMP + INTERVAL '1 day')",
    )
    .bind(Uuid::now_v7())
    .bind(user_id)
    .bind(hash_token("a".repeat(64)))
    .bind(hash_token("b".repeat(64)))
    .execute(&pool)
    .await
    .expect("session fixture must insert");

    let app = daoyun_api::app_with_config(
        Database::from_pool(pool),
        daoyun_api::AuthConfig::default().with_secure_cookies(false),
    );
    let anonymous = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/users/me/membership")
                .body(Body::empty())
                .expect("request must be valid"),
        )
        .await
        .expect("router must respond");
    assert_eq!(anonymous.status(), StatusCode::UNAUTHORIZED);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/users/me/membership")
                .header("cookie", "daoyun_session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; daoyun_csrf=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
                .body(Body::empty())
                .expect("request must be valid"),
        )
        .await
        .expect("router must respond");
    assert_eq!(response.status(), StatusCode::OK);
    let payload = response_json(response).await;
    assert_eq!(payload["data"]["user_id"], user_id.to_string());
    assert_eq!(payload["data"]["points_balance"], 0);
    assert_eq!(payload["data"]["level_key"], "lv_1");
    assert_eq!(payload["data"]["level_number"], 1);
    assert_eq!(payload["data"]["level_display_name"], "Lv1");

    let anonymous_experience = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/users/me/experience")
                .body(Body::empty())
                .expect("request must be valid"),
        )
        .await
        .expect("router must respond");
    assert_eq!(anonymous_experience.status(), StatusCode::UNAUTHORIZED);

    let experience = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/users/me/experience")
                .header("cookie", "daoyun_session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; daoyun_csrf=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
                .body(Body::empty())
                .expect("request must be valid"),
        )
        .await
        .expect("router must respond");
    assert_eq!(experience.status(), StatusCode::OK);
    assert_eq!(experience.headers()["cache-control"], "no-store");
    let payload = response_json(experience).await;
    assert_eq!(payload["data"]["user_id"], user_id.to_string());
    assert_eq!(payload["data"]["experience"], 0);
    assert_eq!(payload["data"]["current_level"]["internal_key"], "lv_1");
    assert_eq!(payload["data"]["current_level"]["level_order"], 1);

    let groups = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/users/me/groups")
                .header("cookie", "daoyun_session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; daoyun_csrf=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
                .body(Body::empty())
                .expect("request must be valid"),
        )
        .await
        .expect("router must respond");
    assert_eq!(groups.status(), StatusCode::OK);
    assert_eq!(groups.headers()["cache-control"], "no-store");
    let payload = response_json(groups).await;
    assert_eq!(
        payload["data"]["memberships"][0]["group"]["internal_key"],
        "registered_member"
    );
    assert_eq!(payload["data"]["access"]["account_status"], "active");
    assert!(
        payload["data"]["access"]["permission_keys"]
            .as_array()
            .is_some_and(|permissions| permissions.contains(&json!("topic.create")))
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn admin_membership_rules_and_points_require_capabilities_and_csrf(pool: PgPool) {
    let app = daoyun_api::app_with_config(
        Database::from_pool(pool.clone()),
        daoyun_api::AuthConfig::default().with_secure_cookies(false),
    );
    initialize(&app).await;
    let (owner_cookies, owner_csrf) = login(&app, "owner", "correct horse battery staple").await;
    let member = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/auth/register",
            json!({
                "username": "points_member",
                "email": "points-member@example.com",
                "display_name": "积分成员",
                "password": "correct horse battery staple"
            }),
            "",
            None,
        ))
        .await
        .expect("member registration must respond");
    assert_eq!(member.status(), StatusCode::CREATED);
    let (member_cookies, _) = session_cookies(&member).await;
    let member_id =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM users WHERE username = 'points_member'")
            .fetch_one(&pool)
            .await
            .expect("member id must be queryable");

    let rules = app
        .clone()
        .oneshot(get_request(
            "/api/v1/admin/membership/level-rules",
            &owner_cookies,
        ))
        .await
        .expect("membership rules must respond");
    assert_eq!(rules.status(), StatusCode::OK);
    assert_eq!(
        response_json(rules).await["data"].as_array().map(Vec::len),
        Some(6)
    );

    let l2 = app
        .clone()
        .oneshot(json_request(
            Method::PATCH,
            "/api/v1/admin/membership/level-rules/lv_2",
            json!({"enabled": true, "required_lifetime_points": 25, "display_name": "新会员"}),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("membership rule update must respond");
    assert_eq!(l2.status(), StatusCode::OK);

    let grant = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/membership/points",
            json!({
                "user_id": member_id,
                "amount": 25,
                "reason": "admin.grant",
                "idempotency_key": "points-api-1"
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("membership points grant must respond");
    assert_eq!(grant.status(), StatusCode::OK);
    let grant_payload = response_json(grant).await;
    assert_eq!(grant_payload["data"]["created"], true);
    assert_eq!(grant_payload["data"]["account"]["level_key"], "lv_2");
    assert_eq!(grant_payload["data"]["account"]["level_number"], 2);
    assert_eq!(
        grant_payload["data"]["account"]["level_display_name"],
        "新会员"
    );

    let replay = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/membership/points",
            json!({
                "user_id": member_id,
                "amount": 25,
                "reason": "admin.grant",
                "idempotency_key": "points-api-1"
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("membership points replay must respond");
    assert_eq!(replay.status(), StatusCode::OK);
    assert_eq!(response_json(replay).await["data"]["created"], false);

    let member_forbidden = app
        .clone()
        .oneshot(get_request(
            "/api/v1/admin/membership/level-rules",
            &member_cookies,
        ))
        .await
        .expect("member membership rules request must respond");
    assert_eq!(member_forbidden.status(), StatusCode::FORBIDDEN);

    let audit = app
        .oneshot(get_request(
            "/api/v1/admin/audit?resource_type=membership_account",
            &owner_cookies,
        ))
        .await
        .expect("membership audit request must respond");
    assert_eq!(audit.status(), StatusCode::OK);
    assert_eq!(
        response_json(audit).await["data"][0]["action"],
        "membership.points.grant"
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn admin_community_groups_and_memberships_are_revisioned_and_idempotent(pool: PgPool) {
    let app = daoyun_api::app_with_config(
        Database::from_pool(pool.clone()),
        daoyun_api::AuthConfig::default().with_secure_cookies(false),
    );
    initialize(&app).await;
    let (owner_cookies, owner_csrf) = login(&app, "owner", "correct horse battery staple").await;

    let member = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/auth/register",
            json!({
                "username": "event_member",
                "email": "event-member@example.com",
                "display_name": "活动成员",
                "password": "correct horse battery staple"
            }),
            "",
            None,
        ))
        .await
        .expect("member registration must respond");
    assert_eq!(member.status(), StatusCode::CREATED);
    let (member_cookies, _) = session_cookies(&member).await;
    let member_id =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM users WHERE username = 'event_member'")
            .fetch_one(&pool)
            .await
            .expect("member id must be queryable");

    let groups = app
        .clone()
        .oneshot(get_request(
            "/api/v1/admin/community/groups",
            &owner_cookies,
        ))
        .await
        .expect("community groups must respond");
    assert_eq!(groups.status(), StatusCode::OK);
    assert_eq!(
        response_json(groups).await["data"].as_array().map(Vec::len),
        Some(5)
    );

    let created = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/community/groups",
            json!({
                "internal_key": "event_member",
                "display_name": "活动成员",
                "description": "限时活动成员组",
                "is_base": false,
                "display_order": 100,
                "permission_keys": ["topic.lottery.join"],
                "quotas": {"reply.create.daily": 75}
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("community group create must respond");
    assert_eq!(created.status(), StatusCode::CREATED);
    let created = response_json(created).await;
    let group_id = created["data"]["id"]
        .as_str()
        .expect("group id must be text")
        .to_owned();
    assert_eq!(created["data"]["revision"], 1);

    let updated = app
        .clone()
        .oneshot(json_request(
            Method::PATCH,
            &format!("/api/v1/admin/community/groups/{group_id}"),
            json!({
                "expected_revision": 1,
                "display_name": "活动成员",
                "description": "限时活动成员组（已启用）",
                "status": "active",
                "display_order": 100,
                "permission_keys": ["topic.lottery.join"],
                "quotas": {"reply.create.daily": 75}
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("community group update must respond");
    assert_eq!(updated.status(), StatusCode::OK);
    assert_eq!(response_json(updated).await["data"]["revision"], 2);

    let grant = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/community/memberships",
            json!({
                "user_id": member_id,
                "group_id": group_id,
                "membership_kind": "additional",
                "source": "operator",
                "source_reference_id": null,
                "reason": "event.enrollment",
                "starts_at": "2020-01-01T00:00:00Z",
                "ends_at": null,
                "idempotency_key": "event-member-grant-1"
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("community membership grant must respond");
    assert_eq!(grant.status(), StatusCode::OK);
    let grant = response_json(grant).await;
    assert_eq!(grant["data"]["replayed"], false);
    let membership_id = grant["data"]["membership"]["id"]
        .as_str()
        .expect("membership id must be text")
        .to_owned();

    let visible = app
        .clone()
        .oneshot(get_request("/api/v1/users/me/groups", &member_cookies))
        .await
        .expect("member groups must respond");
    assert_eq!(visible.status(), StatusCode::OK);
    let visible = response_json(visible).await;
    assert!(
        visible["data"]["access"]["permission_keys"]
            .as_array()
            .is_some_and(|permissions| permissions.contains(&json!("topic.lottery.join")))
    );

    let revoked = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            &format!("/api/v1/admin/community/memberships/{membership_id}/revoke"),
            json!({
                "expected_revision": 1,
                "reason": "event.completed",
                "idempotency_key": "event-member-revoke-1"
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("community membership revoke must respond");
    assert_eq!(revoked.status(), StatusCode::OK);
    let revoked = response_json(revoked).await;
    assert_eq!(revoked["data"]["replayed"], false);
    assert_eq!(revoked["data"]["membership"]["revision"], 2);
    assert!(revoked["data"]["membership"]["revoked_at"].is_string());

    let replay = app
        .oneshot(json_request(
            Method::POST,
            &format!("/api/v1/admin/community/memberships/{membership_id}/revoke"),
            json!({
                "expected_revision": 1,
                "reason": "event.completed",
                "idempotency_key": "event-member-revoke-1"
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("community membership revoke replay must respond");
    assert_eq!(replay.status(), StatusCode::OK);
    assert_eq!(response_json(replay).await["data"]["replayed"], true);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn admin_content_access_policy_is_revisioned_and_enforced_on_topic_reads(pool: PgPool) {
    let app = daoyun_api::app_with_config(
        Database::from_pool(pool.clone()),
        daoyun_api::AuthConfig::default().with_secure_cookies(false),
    );
    initialize(&app).await;
    let (owner_cookies, owner_csrf) = login(&app, "owner", "correct horse battery staple").await;
    let member = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/auth/register",
            json!({
                "username": "policy_member",
                "email": "policy-member@example.com",
                "display_name": "策略成员",
                "password": "correct horse battery staple"
            }),
            "",
            None,
        ))
        .await
        .expect("policy member registration must respond");
    assert_eq!(member.status(), StatusCode::CREATED);
    let (member_cookies, _) = session_cookies(&member).await;
    let owner_id = sqlx::query_scalar::<_, Uuid>("SELECT id FROM users WHERE username = 'owner'")
        .fetch_one(&pool)
        .await
        .expect("owner id must be queryable");
    let board_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM boards WHERE visibility = 'public' AND deleted_at IS NULL LIMIT 1",
    )
    .fetch_one(&pool)
    .await
    .expect("public board must exist");
    let topic_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO topics (
            id, board_id, author_id, title, excerpt, content, status, published_at
         ) VALUES ($1, $2, $3, 'Policy API topic', '', 'Policy API body',
                   'published', CURRENT_TIMESTAMP)",
    )
    .bind(topic_id)
    .bind(board_id)
    .bind(owner_id)
    .execute(&pool)
    .await
    .expect("topic fixture must insert");
    sqlx::query(
        "INSERT INTO posts (id, topic_id, author_id, kind, content, status)
         VALUES ($1, $1, $2, 'topic', 'Policy API body', 'published')",
    )
    .bind(topic_id)
    .bind(owner_id)
    .execute(&pool)
    .await
    .expect("topic post fixture must insert");

    let policy_uri = format!("/api/v1/admin/content-access-policies/topic/{topic_id}");
    let created = app
        .clone()
        .oneshot(json_request(
            Method::PUT,
            &policy_uri,
            json!({
                "operator": "any_of",
                "subjects": [{
                    "subject_type": "authenticated",
                    "community_group_id": null,
                    "subject_key": null
                }],
                "expected_revision": null
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("content access policy create must respond");
    assert_eq!(created.status(), StatusCode::OK);
    assert_eq!(response_json(created).await["data"]["revision"], 1);

    let anonymous = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/topics/{topic_id}"))
                .body(Body::empty())
                .expect("anonymous topic request must be valid"),
        )
        .await
        .expect("anonymous topic detail must respond");
    assert_eq!(anonymous.status(), StatusCode::NOT_FOUND);
    let authenticated = app
        .clone()
        .oneshot(get_request(
            &format!("/api/v1/topics/{topic_id}"),
            &member_cookies,
        ))
        .await
        .expect("authenticated topic detail must respond");
    assert_eq!(authenticated.status(), StatusCode::OK);

    let policy = app
        .clone()
        .oneshot(get_request(&policy_uri, &owner_cookies))
        .await
        .expect("content access policy read must respond");
    assert_eq!(policy.status(), StatusCode::OK);
    assert_eq!(response_json(policy).await["data"]["operator"], "any_of");

    let stale = app
        .oneshot(json_request(
            Method::PUT,
            &policy_uri,
            json!({
                "operator": "all_of",
                "subjects": [{
                    "subject_type": "authenticated",
                    "community_group_id": null,
                    "subject_key": null
                }],
                "expected_revision": 2
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("stale content access policy update must respond");
    assert_eq!(stale.status(), StatusCode::CONFLICT);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn admin_medals_are_granted_and_visible_on_public_profile(pool: PgPool) {
    let app = daoyun_api::app_with_config(
        Database::from_pool(pool.clone()),
        daoyun_api::AuthConfig::default().with_secure_cookies(false),
    );
    initialize(&app).await;
    let (owner_cookies, owner_csrf) = login(&app, "owner", "correct horse battery staple").await;
    let member = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/auth/register",
            json!({
                "username": "medal_member",
                "email": "medal-member@example.com",
                "display_name": "勋章成员",
                "password": "correct horse battery staple"
            }),
            "",
            None,
        ))
        .await
        .expect("member registration must respond");
    assert_eq!(member.status(), StatusCode::CREATED);
    let member_id =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM users WHERE username = 'medal_member'")
            .fetch_one(&pool)
            .await
            .expect("member id must be queryable");
    let grant = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/membership/medals",
            json!({"user_id": member_id, "medal_key": "medal_01", "reason": "operator.award"}),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("medal grant must respond");
    assert_eq!(grant.status(), StatusCode::OK);
    assert_eq!(response_json(grant).await["data"]["created"], true);
    let profile = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/users/medal_member/medals")
                .body(Body::empty())
                .expect("profile medals request must be valid"),
        )
        .await
        .expect("profile medals must respond");
    assert_eq!(profile.status(), StatusCode::OK);
    assert_eq!(response_json(profile).await["data"][0]["key"], "medal_01");
}

fn hash_token(value: String) -> Vec<u8> {
    Sha256::digest(value.as_bytes()).to_vec()
}

async fn response_json(response: axum::response::Response) -> Value {
    let body = to_bytes(response.into_body(), 1024 * 1024)
        .await
        .expect("response body must be readable");
    serde_json::from_slice(&body).expect("response body must be JSON")
}

fn unavailable_database() -> Database {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .connect_lazy("postgresql://daoyun@127.0.0.1:1/daoyun")
        .expect("the unavailable database URL must be valid");
    Database::from_pool(pool)
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

async fn login(app: &axum::Router, username: &str, password: &str) -> (String, String) {
    let response = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/auth/login",
            json!({"identifier": username, "password": password}),
            "",
            None,
        ))
        .await
        .expect("login must respond");
    assert_eq!(response.status(), StatusCode::OK);
    let (cookies, csrf) = session_cookies(&response).await;
    if username == "owner" {
        let recent = app
            .clone()
            .oneshot(json_request(
                Method::POST,
                "/api/v1/auth/recent-auth",
                json!({
                    "operation": "admin.privileged_write",
                    "password": password
                }),
                &cookies,
                Some(&csrf),
            ))
            .await
            .expect("admin recent authentication must respond");
        assert_eq!(recent.status(), StatusCode::OK);
    }
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
