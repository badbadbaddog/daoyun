use axum::{
    body::{Body, to_bytes},
    http::{Method, Request, StatusCode},
};
use infrastructure::Database;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn admin_points_ledger_is_real_paginated_private_and_uid_scoped(pool: PgPool) {
    let db = Database::from_pool(pool.clone());
    let app = daoyun_api::app_with_config(
        db.clone(),
        daoyun_api::AuthConfig::default().with_secure_cookies(false),
    );
    initialize(&app).await;
    let (cookies, csrf) = login(&app, "owner", "correct horse battery staple").await;
    let user_id: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE username='owner'")
        .fetch_one(&pool)
        .await
        .unwrap();
    for (key, amount) in [("first", 10), ("second", 20), ("third", 30)] {
        let response=app.clone().oneshot(json_request(Method::POST,"/api/v1/admin/membership/points",json!({"user_id":user_id,"amount":amount,"reason":"admin.grant","idempotency_key":key}),&cookies,Some(&csrf))).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }
    let uri = format!("/api/v1/admin/membership/users/{user_id}/points/ledger");
    let unauthorized = app.clone().oneshot(get_request(&uri, "")).await.unwrap();
    assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);
    let response = app
        .clone()
        .oneshot(get_request(&format!("{uri}?limit=2"), &cookies))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["cache-control"], "no-store");
    let request_id = response.headers()["x-request-id"]
        .to_str()
        .unwrap()
        .to_owned();
    let page = response_json(response).await;
    assert_eq!(page["meta"]["request_id"], request_id);
    assert_eq!(page["data"].as_array().unwrap().len(), 2);
    assert_eq!(page["data"][0]["amount"], 30);
    assert_eq!(page["data"][0]["actor_username"], "owner");
    assert!(page["data"][0]["operation_request_id"].is_string());
    let cursor = page["meta"]["next_cursor"].as_str().unwrap();
    let tail = response_json(
        app.clone()
            .oneshot(get_request(
                &format!("{uri}?limit=2&cursor={cursor}"),
                &cookies,
            ))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(tail["data"].as_array().unwrap().len(), 1);
    assert_eq!(tail["data"][0]["amount"], 10);
    assert!(tail["meta"]["next_cursor"].is_null());
    let empty_id = Uuid::now_v7();
    sqlx::query("INSERT INTO users(id,username,email,display_name,status) VALUES($1,'ledger_empty','ledger-empty@example.com','空账本','active')").bind(empty_id).execute(&pool).await.unwrap();
    let empty_uri = format!("/api/v1/admin/membership/users/{empty_id}/points/ledger");
    let empty = response_json(
        app.clone()
            .oneshot(get_request(&empty_uri, &cookies))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(empty["data"], json!([]));
    assert_eq!(db.get_membership_account(empty_id).await.unwrap(), None);
    for invalid_uri in [
        format!("{uri}?limit=0"),
        format!("{uri}?limit=51"),
        format!("{uri}?cursor=bad"),
        format!("{uri}?cursor={}", Uuid::now_v7()),
        format!("{empty_uri}?cursor={cursor}"),
    ] {
        assert_eq!(
            app.clone()
                .oneshot(get_request(&invalid_uri, &cookies))
                .await
                .unwrap()
                .status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
    assert_eq!(
        app.clone()
            .oneshot(get_request(
                &format!(
                    "/api/v1/admin/membership/users/{}/points/ledger",
                    Uuid::now_v7()
                ),
                &cookies
            ))
            .await
            .unwrap()
            .status(),
        StatusCode::NOT_FOUND
    );
    sqlx::query("DELETE FROM role_assignments WHERE user_id=$1")
        .bind(user_id)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        app.clone()
            .oneshot(get_request(&uri, &cookies))
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn admin_points_deduction_replays_without_overdraft_or_experience_changes(pool: PgPool) {
    let db = Database::from_pool(pool.clone());
    let app = daoyun_api::app_with_config(
        db.clone(),
        daoyun_api::AuthConfig::default().with_secure_cookies(false),
    );
    initialize(&app).await;
    let (cookies, csrf) = login(&app, "owner", "correct horse battery staple").await;
    let uid: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE username='owner'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let experience = db.find_experience_account(uid).await.unwrap().unwrap();
    let command = |amount, key: &str| {
        json_request(
            Method::POST,
            "/api/v1/admin/membership/points",
            json!({"user_id":uid,"amount":amount,"reason":"operations.correction","idempotency_key":key}),
            &cookies,
            Some(&csrf),
        )
    };
    let grant = app
        .clone()
        .oneshot(command(10_i64, "deduction-seed"))
        .await
        .unwrap();
    assert_eq!(grant.status(), StatusCode::OK);
    let deduction = app
        .clone()
        .oneshot(command(-7_i64, "deduction-once"))
        .await
        .unwrap();
    assert_eq!(deduction.status(), StatusCode::OK);
    let request_id = deduction.headers()["x-request-id"]
        .to_str()
        .unwrap()
        .to_owned();
    let receipt = response_json(deduction).await;
    assert_eq!(receipt["meta"]["request_id"], request_id);
    assert_eq!(receipt["data"]["balance_before"], 10);
    assert_eq!(receipt["data"]["balance_after"], 3);
    assert_eq!(receipt["data"]["account"]["points_balance"], 3);
    assert_eq!(receipt["data"]["account"]["lifetime_points"], 10);
    let replay = app
        .clone()
        .oneshot(command(-7_i64, "deduction-once"))
        .await
        .unwrap();
    assert_eq!(replay.status(), StatusCode::OK);
    let replay = response_json(replay).await;
    assert_eq!(replay["data"]["created"], false);
    assert_eq!(
        replay["data"]["ledger_entry_id"],
        receipt["data"]["ledger_entry_id"]
    );
    assert_eq!(replay["data"]["audit_id"], receipt["data"]["audit_id"]);
    for (amount, key) in [
        (-4, "overdraft"),
        (0, "zero"),
        (-1_000_001, "too-negative"),
        (1_000_001, "too-positive"),
        (i64::MIN, "minimum-integer"),
        (i64::MAX, "maximum-integer"),
    ] {
        let rejected = app.clone().oneshot(command(amount, key)).await.unwrap();
        assert_eq!(rejected.status(), StatusCode::UNPROCESSABLE_ENTITY, "{key}");
        let request_id = rejected.headers()["x-request-id"]
            .to_str()
            .unwrap()
            .to_owned();
        assert_eq!(
            response_json(rejected).await["meta"]["request_id"],
            request_id
        );
    }
    let account = db.get_membership_account(uid).await.unwrap().unwrap();
    assert_eq!((account.points_balance, account.lifetime_points), (3, 10));
    let after = db.find_experience_account(uid).await.unwrap().unwrap();
    assert_eq!(
        (after.experience, after.revision, after.current_level_id),
        (
            experience.experience,
            experience.revision,
            experience.current_level_id
        )
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM point_ledger_entries WHERE user_id=$1")
            .bind(uid)
            .fetch_one(&pool)
            .await
            .unwrap(),
        2
    );
    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT count(*) FROM admin_audit_log WHERE action='membership.points.grant' AND resource_id=$1")
        .bind(uid).fetch_one(&pool).await.unwrap(), 2);
    sqlx::query("DELETE FROM role_assignments WHERE user_id=$1")
        .bind(uid)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        app.clone()
            .oneshot(command(-1_i64, "permission-revoked"))
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    let schema = serde_json::to_value(daoyun_api::openapi_document()).unwrap();
    let amount =
        &schema["components"]["schemas"]["GrantMembershipPointsRequest"]["properties"]["amount"];
    assert_eq!(amount["minimum"].as_f64(), Some(-1_000_000.0));
    assert_eq!(amount["maximum"].as_f64(), Some(1_000_000.0));
}

#[test]
fn operational_ledger_openapi_defines_points_pagination_and_request_id() {
    let schema = serde_json::to_value(daoyun_api::openapi_document()).unwrap();
    let op = &schema["paths"]["/api/v1/admin/membership/users/{user_id}/points/ledger"]["get"];
    assert_eq!(op["operationId"], "listAdminPointsLedger");
    assert!(op["responses"]["200"]["headers"]["x-request-id"].is_object());
    assert!(op["responses"]["422"].is_object());
    assert!(
        op["parameters"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p["name"] == "cursor")
    );
}

async fn response_json(response: axum::response::Response) -> Value {
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
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

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn admin_experience_is_atomic_revisioned_and_replays_original_facts(pool: PgPool) {
    let db = Database::from_pool(pool.clone());
    let app = daoyun_api::app_with_config(
        db.clone(),
        daoyun_api::AuthConfig::default().with_secure_cookies(false),
    );
    initialize(&app).await;
    let (cookies, csrf) = login(&app, "owner", "correct horse battery staple").await;
    let uid: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE username='owner'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let uri = format!("/api/v1/admin/membership/users/{uid}/experience");
    let read = app
        .clone()
        .oneshot(get_request(&uri, &cookies))
        .await
        .unwrap();
    assert_eq!(read.status(), StatusCode::OK);
    assert_eq!(response_json(read).await["data"]["revision"], 1);
    let input = json!({"user_id":uid,"amount":120,"reason":"社区贡献补发","expected_revision":1,"idempotency_key":"exp-a","reversal_of":null});
    let missing_csrf = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/membership/experience",
            input.clone(),
            &cookies,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(missing_csrf.status(), StatusCode::FORBIDDEN);
    let grant = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/membership/experience",
            input.clone(),
            &cookies,
            Some(&csrf),
        ))
        .await
        .unwrap();
    assert_eq!(grant.status(), StatusCode::OK);
    let request_id = grant.headers()["x-request-id"].to_str().unwrap().to_owned();
    let first = response_json(grant).await;
    assert_eq!(first["meta"]["request_id"], request_id);
    assert_eq!(first["data"]["entry"]["operation_request_id"], request_id);
    assert_eq!(first["data"]["entry"]["balance_after"], 120);
    assert_eq!(first["data"]["entry"]["revision_after"], 2);
    assert_eq!(first["data"]["entry"]["details"], "社区贡献补发");
    assert!(first["data"]["entry"]["audit_id"].is_string());
    assert_eq!(first["data"]["account"]["current_level"]["level_order"], 2);
    let later=app.clone().oneshot(json_request(Method::POST,"/api/v1/admin/membership/experience",json!({"user_id":uid,"amount":7,"reason":"补记贡献","expected_revision":2,"idempotency_key":"exp-b"}),&cookies,Some(&csrf))).await.unwrap();
    assert_eq!(later.status(), StatusCode::OK);
    let replay = response_json(
        app.clone()
            .oneshot(json_request(
                Method::POST,
                "/api/v1/admin/membership/experience",
                input.clone(),
                &cookies,
                Some(&csrf),
            ))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(replay["data"]["replayed"], true);
    assert_eq!(replay["data"]["entry"], first["data"]["entry"]);
    assert_eq!(replay["data"]["account"]["experience"], 127);
    for bad in [
        json!({"amount":121}),
        json!({"reason":"篡改原因"}),
        json!({"expected_revision":3}),
    ] {
        let mut changed = input.clone();
        for (k, v) in bad.as_object().unwrap() {
            changed[k] = v.clone();
        }
        assert_eq!(
            app.clone()
                .oneshot(json_request(
                    Method::POST,
                    "/api/v1/admin/membership/experience",
                    changed,
                    &cookies,
                    Some(&csrf)
                ))
                .await
                .unwrap()
                .status(),
            StatusCode::CONFLICT
        );
    }
    let mut stale = input.clone();
    stale["idempotency_key"] = json!("stale");
    assert_eq!(
        app.clone()
            .oneshot(json_request(
                Method::POST,
                "/api/v1/admin/membership/experience",
                stale,
                &cookies,
                Some(&csrf)
            ))
            .await
            .unwrap()
            .status(),
        StatusCode::CONFLICT
    );
    let reversal = json!({"user_id":uid,"amount":-120,"reason":"纠正重复奖励","expected_revision":3,"idempotency_key":"exp-r","reversal_of":first["data"]["entry"]["id"]});
    let reversed = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/membership/experience",
            reversal.clone(),
            &cookies,
            Some(&csrf),
        ))
        .await
        .unwrap();
    assert_eq!(reversed.status(), StatusCode::OK);
    let reversed = response_json(reversed).await;
    assert_eq!(reversed["data"]["account"]["experience"], 7);
    assert_eq!(
        reversed["data"]["account"]["current_level"]["level_order"],
        2
    );
    let mut duplicate = reversal;
    duplicate["idempotency_key"] = json!("duplicate");
    duplicate["expected_revision"] = json!(4);
    assert_eq!(
        app.clone()
            .oneshot(json_request(
                Method::POST,
                "/api/v1/admin/membership/experience",
                duplicate,
                &cookies,
                Some(&csrf)
            ))
            .await
            .unwrap()
            .status(),
        StatusCode::CONFLICT
    );
    let ledger_uri = format!("{uri}/ledger");
    let page = response_json(
        app.clone()
            .oneshot(get_request(&format!("{ledger_uri}?limit=2"), &cookies))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(page["data"].as_array().unwrap().len(), 2);
    assert_eq!(page["data"][0]["amount"], -120);
    assert_eq!(page["data"][0]["actor_username"], "owner");
    let cursor = page["meta"]["next_cursor"].as_str().unwrap();
    let tail = response_json(
        app.clone()
            .oneshot(get_request(
                &format!("{ledger_uri}?cursor={cursor}&limit=2"),
                &cookies,
            ))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(tail["data"], json!([first["data"]["entry"].clone()]));
    assert_eq!(
        db.get_membership_account(uid)
            .await
            .unwrap()
            .unwrap()
            .points_balance,
        0
    );
    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT count(*) FROM admin_audit_log WHERE action='membership.experience.adjust' AND resource_id=$1").bind(uid).fetch_one(&pool).await.unwrap(),3);
    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT count(*) FROM outbox_events WHERE event_type='experience.changed' AND aggregate_id=$1").bind(uid).fetch_one(&pool).await.unwrap(),3);
    sqlx::query("DELETE FROM role_assignments WHERE user_id=$1")
        .bind(uid)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        app.clone()
            .oneshot(get_request(&ledger_uri, &cookies))
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn experience_reads_do_not_initialize_missing_accounts_and_validate_cursor(pool: PgPool) {
    let app = daoyun_api::app_with_config(
        Database::from_pool(pool.clone()),
        daoyun_api::AuthConfig::default().with_secure_cookies(false),
    );
    initialize(&app).await;
    let (cookies, csrf) = login(&app, "owner", "correct horse battery staple").await;
    let uid = Uuid::now_v7();
    sqlx::query("INSERT INTO users(id,username,email,display_name,status) VALUES($1,'exp_empty','exp-empty@example.com','未初始化','active')").bind(uid).execute(&pool).await.unwrap();
    sqlx::query("DELETE FROM experience_accounts WHERE user_id=$1")
        .bind(uid)
        .execute(&pool)
        .await
        .unwrap();
    let uri = format!("/api/v1/admin/membership/users/{uid}/experience");
    let response = app
        .clone()
        .oneshot(get_request(&uri, &cookies))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response_json(response).await["data"].is_null());
    assert_eq!(
        response_json(
            app.clone()
                .oneshot(get_request(&format!("{uri}/ledger"), &cookies))
                .await
                .unwrap()
        )
        .await["data"],
        json!([])
    );
    for suffix in [
        "?limit=0".to_owned(),
        "?cursor=bad".to_owned(),
        format!("?cursor={}", Uuid::now_v7()),
    ] {
        assert_eq!(
            app.clone()
                .oneshot(get_request(&format!("{uri}/ledger{suffix}"), &cookies))
                .await
                .unwrap()
                .status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
    let write=app.clone().oneshot(json_request(Method::POST,"/api/v1/admin/membership/experience",json!({"user_id":uid,"amount":1,"reason":"未初始化不可写","expected_revision":1,"idempotency_key":"empty"}),&cookies,Some(&csrf))).await.unwrap();
    assert_eq!(write.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM experience_accounts WHERE user_id=$1")
            .bind(uid)
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn old_medal_grant_retry_after_revocation_never_resurrects_ownership(pool: PgPool) {
    let db = Database::from_pool(pool.clone());
    let app = daoyun_api::app_with_config(
        db.clone(),
        daoyun_api::AuthConfig::default().with_secure_cookies(false),
    );
    initialize(&app).await;
    let (cookies, csrf) = login(&app, "owner", "correct horse battery staple").await;
    let uid: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE username='owner'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let grant = json!({"user_id":uid,"medal_key":"medal_01","reason":"operator.award","expected_revision":0,"idempotency_key":"medal-original"});
    let first = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/membership/medals",
            grant.clone(),
            &cookies,
            Some(&csrf),
        ))
        .await
        .unwrap();
    assert_eq!(first.status(), StatusCode::OK);
    let first = response_json(first).await;
    let revoke=app.clone().oneshot(json_request(Method::POST,"/api/v1/admin/membership/medal-revocations",json!({"user_id":uid,"medal_key":"medal_01","reason":"纠正授予","expected_revision":1,"idempotency_key":"medal-revoke"}),&cookies,Some(&csrf))).await.unwrap();
    assert_eq!(revoke.status(), StatusCode::OK);
    let revoke = response_json(revoke).await;
    let replay = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/membership/medals",
            grant.clone(),
            &cookies,
            Some(&csrf),
        ))
        .await
        .unwrap();
    assert_eq!(replay.status(), StatusCode::OK);
    let replay = response_json(replay).await;
    assert!(
        db.list_membership_medals(uid).await.unwrap().is_empty(),
        "replaying an old grant after revoke must never restore ownership"
    );
    assert_eq!(replay["data"]["receipt"]["replayed"], true);
    for field in [
        "id",
        "audit_id",
        "operation_request_id",
        "revision",
        "affected",
        "owned_after",
        "created_at",
    ] {
        assert_eq!(
            replay["data"]["receipt"][field],
            first["data"]["receipt"][field]
        );
    }
    assert_eq!(revoke["data"]["receipt"]["revision"], 2);
    let state_uri = format!("/api/v1/admin/membership/users/{uid}/medals");
    let state = response_json(
        app.clone()
            .oneshot(get_request(&state_uri, &cookies))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(state["data"]["revision"], 2);
    assert_eq!(state["data"]["medals"], json!([]));
    let receipt_uri = format!("/api/v1/admin/membership/users/{uid}/medal-requests/medal-original");
    let receipt = app
        .clone()
        .oneshot(get_request(&receipt_uri, &cookies))
        .await
        .unwrap();
    assert_eq!(receipt.status(), StatusCode::OK);
    assert_eq!(
        response_json(receipt).await["data"]["id"],
        first["data"]["receipt"]["id"]
    );
    assert_eq!(
        app.clone()
            .oneshot(get_request(&receipt_uri, ""))
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        app.clone()
            .oneshot(get_request(
                &format!("/api/v1/admin/membership/users/{uid}/medal-requests/unknown"),
                &cookies
            ))
            .await
            .unwrap()
            .status(),
        StatusCode::NOT_FOUND
    );
    for patch in [
        json!({"reason":"different.reason"}),
        json!({"expected_revision":2}),
        json!({"medal_key":"medal_02"}),
    ] {
        let mut input = grant.clone();
        for (k, v) in patch.as_object().unwrap() {
            input[k] = v.clone();
        }
        assert_eq!(
            app.clone()
                .oneshot(json_request(
                    Method::POST,
                    "/api/v1/admin/membership/medals",
                    input,
                    &cookies,
                    Some(&csrf)
                ))
                .await
                .unwrap()
                .status(),
            StatusCode::CONFLICT
        );
    }
    let mut fresh = grant;
    fresh["idempotency_key"] = json!("medal-fresh");
    fresh["expected_revision"] = json!(2);
    let fresh = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/membership/medals",
            fresh,
            &cookies,
            Some(&csrf),
        ))
        .await
        .unwrap();
    assert_eq!(fresh.status(), StatusCode::OK);
    assert_eq!(response_json(fresh).await["data"]["receipt"]["revision"], 3);
    assert_eq!(db.list_membership_medals(uid).await.unwrap().len(), 1);
    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT count(*) FROM admin_audit_log WHERE resource_type='membership_medal' AND resource_id=$1 AND action IN ('membership.medal.grant','membership.medal.revoke')").bind(uid).fetch_one(&pool).await.unwrap(),3);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn membership_commands_roll_back_all_facts_when_audit_fails(pool: PgPool) {
    let db = Database::from_pool(pool.clone());
    let app = daoyun_api::app_with_config(
        db.clone(),
        daoyun_api::AuthConfig::default().with_secure_cookies(false),
    );
    initialize(&app).await;
    let uid: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE username='owner'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let account = db.find_experience_account(uid).await.unwrap().unwrap();
    sqlx::raw_sql("CREATE FUNCTION reject_membership_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action IN ('membership.medal.grant','membership.experience.adjust') THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER membership_audit_failure BEFORE INSERT ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION reject_membership_audit();").execute(&pool).await.unwrap();
    assert!(
        db.adjust_admin_experience(
            uid,
            10,
            "rollback-exp",
            None,
            infrastructure::AdminExperienceContext {
                actor_id: uid,
                expected_revision: account.revision,
                details: "回滚验证",
                request_id: Uuid::now_v7()
            }
        )
        .await
        .is_err()
    );
    let after = db.find_experience_account(uid).await.unwrap().unwrap();
    assert_eq!(
        (after.experience, after.revision, after.current_level_id),
        (
            account.experience,
            account.revision,
            account.current_level_id
        )
    );
    assert!(
        db.list_experience_ledger(uid, None, 20)
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        db.grant_membership_medal(
            uid,
            uid,
            "medal_01",
            "operator.award",
            infrastructure::MedalCommandContext {
                expected_revision: 0,
                idempotency_key: "rollback-medal",
                request_id: Uuid::now_v7()
            }
        )
        .await
        .is_err()
    );
    assert_eq!(db.membership_medal_state(uid).await.unwrap().revision, 0);
    assert!(db.list_membership_medals(uid).await.unwrap().is_empty());
    assert!(
        db.membership_medal_receipt(uid, "rollback-medal")
            .await
            .unwrap()
            .is_none()
    );
    let events: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM outbox_events WHERE event_type='experience.changed'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(events, 0);
}

#[test]
fn operational_membership_openapi_declares_write_csrf_and_new_read_contracts() {
    let schema = serde_json::to_value(daoyun_api::openapi_document()).unwrap();
    for path in [
        "/api/v1/admin/membership/experience",
        "/api/v1/admin/membership/medals",
        "/api/v1/admin/membership/medal-revocations",
    ] {
        let op = &schema["paths"][path]["post"];
        assert!(
            op["parameters"]
                .as_array()
                .unwrap()
                .iter()
                .any(|p| p["name"] == "x-csrf-token" && p["in"] == "header"),
            "CSRF header missing: {path}"
        );
        for status in ["200", "401", "403", "404", "409", "422"] {
            assert!(
                op["responses"][status]["headers"]["x-request-id"].is_object(),
                "missing response: {path} {status}"
            );
        }
    }
    for (path, id) in [
        (
            "/api/v1/admin/membership/users/{user_id}/experience",
            "getAdminExperience",
        ),
        (
            "/api/v1/admin/membership/users/{user_id}/experience/ledger",
            "listAdminExperienceLedger",
        ),
        (
            "/api/v1/admin/membership/users/{user_id}/medals",
            "getAdminMedalState",
        ),
        (
            "/api/v1/admin/membership/users/{user_id}/medal-requests/{key}",
            "getAdminMedalReceipt",
        ),
    ] {
        let op = &schema["paths"][path]["get"];
        assert_eq!(op["operationId"], id);
        assert!(op["responses"]["200"]["headers"]["x-request-id"].is_object());
    }
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn concurrent_membership_retries_preserve_one_fact_and_revoked_authority(pool: PgPool) {
    let db = Database::from_pool(pool.clone());
    let app = daoyun_api::app_with_config(
        db.clone(),
        daoyun_api::AuthConfig::default().with_secure_cookies(false),
    );
    initialize(&app).await;
    let (cookies, csrf) = login(&app, "owner", "correct horse battery staple").await;
    let uid: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE username='owner'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let exp = json!({"user_id":uid,"amount":10,"reason":"并发补记验证","expected_revision":1,"idempotency_key":"concurrent-exp"});
    let (a, b) = tokio::join!(
        app.clone().oneshot(json_request(
            Method::POST,
            "/api/v1/admin/membership/experience",
            exp.clone(),
            &cookies,
            Some(&csrf)
        )),
        app.clone().oneshot(json_request(
            Method::POST,
            "/api/v1/admin/membership/experience",
            exp.clone(),
            &cookies,
            Some(&csrf)
        ))
    );
    let a = a.unwrap();
    let b = b.unwrap();
    assert_eq!(a.status(), StatusCode::OK);
    assert_eq!(b.status(), StatusCode::OK);
    let a = response_json(a).await;
    let b = response_json(b).await;
    assert_eq!(a["data"]["entry"]["id"], b["data"]["entry"]["id"]);
    assert_ne!(a["data"]["replayed"], b["data"]["replayed"]);
    assert_eq!(
        db.find_experience_account(uid)
            .await
            .unwrap()
            .unwrap()
            .experience,
        10
    );
    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT count(*) FROM outbox_events WHERE event_type='experience.changed' AND aggregate_id=$1").bind(uid).fetch_one(&pool).await.unwrap(),1);
    let medal = json!({"user_id":uid,"medal_key":"medal_01","reason":"operator.award","expected_revision":0,"idempotency_key":"command/?#%"});
    let (a, b) = tokio::join!(
        app.clone().oneshot(json_request(
            Method::POST,
            "/api/v1/admin/membership/medals",
            medal.clone(),
            &cookies,
            Some(&csrf)
        )),
        app.clone().oneshot(json_request(
            Method::POST,
            "/api/v1/admin/membership/medals",
            medal.clone(),
            &cookies,
            Some(&csrf)
        ))
    );
    let a = a.unwrap();
    let b = b.unwrap();
    assert_eq!(a.status(), StatusCode::OK);
    assert_eq!(b.status(), StatusCode::OK);
    let a = response_json(a).await;
    let b = response_json(b).await;
    assert_eq!(a["data"]["receipt"]["id"], b["data"]["receipt"]["id"]);
    assert_ne!(
        a["data"]["receipt"]["replayed"],
        b["data"]["receipt"]["replayed"]
    );
    assert_eq!(db.membership_medal_state(uid).await.unwrap().revision, 1);
    let receipt_uri =
        format!("/api/v1/admin/membership/users/{uid}/medal-requests/command%2F%3F%23%25");
    let receipt = app
        .clone()
        .oneshot(get_request(&receipt_uri, &cookies))
        .await
        .unwrap();
    assert_eq!(receipt.status(), StatusCode::OK);
    assert_eq!(
        response_json(receipt).await["data"]["idempotency_key"],
        "command/?#%"
    );
    sqlx::query("UPDATE membership_medal_rules SET deleted_at=now() WHERE medal_key='medal_01'")
        .execute(&pool)
        .await
        .unwrap();
    let replay = app
        .clone()
        .oneshot(json_request(
            Method::POST,
            "/api/v1/admin/membership/medals",
            medal.clone(),
            &cookies,
            Some(&csrf),
        ))
        .await
        .unwrap();
    assert_eq!(replay.status(), StatusCode::OK);
    assert_eq!(
        response_json(replay).await["data"]["receipt"]["id"],
        a["data"]["receipt"]["id"]
    );
    for action in ["membership.experience.adjust", "membership.medal.grant"] {
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT count(*) FROM admin_audit_log WHERE action=$1 AND resource_id=$2"
            )
            .bind(action)
            .bind(uid)
            .fetch_one(&pool)
            .await
            .unwrap(),
            1
        );
    }
    sqlx::query("DELETE FROM role_assignments WHERE user_id=$1")
        .bind(uid)
        .execute(&pool)
        .await
        .unwrap();
    for (path, input) in [
        ("/api/v1/admin/membership/experience", exp),
        ("/api/v1/admin/membership/medals", medal),
    ] {
        assert_eq!(
            app.clone()
                .oneshot(json_request(
                    Method::POST,
                    path,
                    input,
                    &cookies,
                    Some(&csrf)
                ))
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
    }
    assert_eq!(
        app.clone()
            .oneshot(get_request(&receipt_uri, &cookies))
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn operational_membership_migrations_are_reversible_without_removing_existing_facts(
    pool: PgPool,
) {
    let db = Database::from_pool(pool.clone());
    let app = daoyun_api::app_with_config(
        db.clone(),
        daoyun_api::AuthConfig::default().with_secure_cookies(false),
    );
    initialize(&app).await;
    let uid: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE username='owner'")
        .fetch_one(&pool)
        .await
        .unwrap();
    db.grant_membership_medal(
        uid,
        uid,
        "medal_01",
        "operator.award",
        infrastructure::MedalCommandContext {
            expected_revision: 0,
            idempotency_key: "migration-fact",
            request_id: Uuid::now_v7(),
        },
    )
    .await
    .unwrap();
    sqlx::raw_sql(include_str!(
        "../../../migrations/202610060002_add_medal_command_receipts.down.sql"
    ))
    .execute(&pool)
    .await
    .unwrap();
    sqlx::raw_sql(include_str!(
        "../../../migrations/202610060001_add_admin_experience_metadata.down.sql"
    ))
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(db.list_membership_medals(uid).await.unwrap().len(), 1);
    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT count(*) FROM admin_audit_log WHERE action='membership.medal.grant' AND resource_id=$1").bind(uid).fetch_one(&pool).await.unwrap(),1);
    sqlx::raw_sql(include_str!(
        "../../../migrations/202610060001_add_admin_experience_metadata.up.sql"
    ))
    .execute(&pool)
    .await
    .unwrap();
    sqlx::raw_sql(include_str!(
        "../../../migrations/202610060002_add_medal_command_receipts.up.sql"
    ))
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(db.membership_medal_state(uid).await.unwrap().revision, 1);
    assert_eq!(db.list_membership_medals(uid).await.unwrap().len(), 1);
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn operational_membership_invalid_uids_keep_auth_and_request_envelopes(pool: PgPool) {
    let app = daoyun_api::app_with_config(
        Database::from_pool(pool),
        daoyun_api::AuthConfig::default().with_secure_cookies(false),
    );
    initialize(&app).await;
    let (cookies, _) = login(&app, "owner", "correct horse battery staple").await;
    for suffix in [
        "experience",
        "experience/ledger",
        "points/ledger",
        "medals",
        "medal-requests/key",
    ] {
        let uri = format!("/api/v1/admin/membership/users/invalid/{suffix}");
        assert_eq!(
            app.clone()
                .oneshot(get_request(&uri, ""))
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        let response = app
            .clone()
            .oneshot(get_request(&uri, &cookies))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        let request_id = response.headers()["x-request-id"]
            .to_str()
            .unwrap()
            .to_owned();
        let body = response_json(response).await;
        assert_eq!(body["meta"]["request_id"], request_id);
        assert!(body["error"]["code"].is_string());
    }
}
