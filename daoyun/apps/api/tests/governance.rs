use axum::{
    body::{Body, to_bytes},
    http::{Method, Request, StatusCode},
};
use infrastructure::Database;
use serde_json::Value;
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn reports_are_idempotent_and_admins_can_triage_a_report(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool.clone()), config);
    let (member_cookies, member_csrf) = register_member(&app).await;
    let topic = app
        .clone()
        .oneshot(json_request_with_headers(
            Method::POST,
            "/api/v1/topics",
            serde_json::json!({"title": "待举报主题", "content": "广告正文"}),
            &member_cookies,
            Some(&member_csrf),
        ))
        .await
        .expect("topic creation must respond");
    assert_eq!(topic.status(), StatusCode::CREATED);
    let topic_id = response_json(topic).await["data"]["id"]
        .as_str()
        .expect("topic id must be present")
        .to_owned();

    let report = app
        .clone()
        .oneshot(json_request_with_headers(
            Method::POST,
            "/api/v1/reports",
            serde_json::json!({
                "target_type": "topic",
                "target_id": topic_id,
                "reason": "spam",
                "details": "这是广告"
            }),
            &member_cookies,
            Some(&member_csrf),
        ))
        .await
        .expect("report creation must respond");
    assert_eq!(report.status(), StatusCode::CREATED);
    let report_id = response_json(report).await["data"]["id"]
        .as_str()
        .expect("report id must be present")
        .to_owned();
    let owner_id =
        sqlx::query_scalar::<_, uuid::Uuid>("SELECT id FROM users WHERE username = 'owner'")
            .fetch_one(&pool)
            .await
            .expect("owner id must be queryable");
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM notifications
             WHERE recipient_id = $1 AND kind = 'report'",
        )
        .bind(owner_id)
        .fetch_one(&pool)
        .await
        .expect("new report notification count must be readable"),
        1
    );

    let replay = app
        .clone()
        .oneshot(json_request_with_headers(
            Method::POST,
            "/api/v1/reports",
            serde_json::json!({
                "target_type": "topic",
                "target_id": topic_id,
                "reason": "spam"
            }),
            &member_cookies,
            Some(&member_csrf),
        ))
        .await
        .expect("duplicate report must respond");
    assert_eq!(replay.status(), StatusCode::OK);
    assert_eq!(response_json(replay).await["data"]["created"], false);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM notifications
             WHERE recipient_id = $1 AND kind = 'report'",
        )
        .bind(owner_id)
        .fetch_one(&pool)
        .await
        .expect("replayed report notification count must be readable"),
        1
    );
    let member_id =
        sqlx::query_scalar::<_, uuid::Uuid>("SELECT id FROM users WHERE username = 'member'")
            .fetch_one(&pool)
            .await
            .expect("member id must be queryable");
    let report_audit = sqlx::query_as::<_, (String, String, uuid::Uuid, Value)>(
        "SELECT action, resource_type, resource_id, summary FROM admin_audit_log
         WHERE actor_id = $1 AND action = 'report.create'",
    )
    .bind(member_id)
    .fetch_one(&pool)
    .await
    .expect("report creation audit must be readable");
    assert_eq!(
        report_audit,
        (
            "report.create".to_owned(),
            "content_report".to_owned(),
            uuid::Uuid::parse_str(&report_id).expect("report id must be valid"),
            serde_json::json!({
                "target_id": uuid::Uuid::parse_str(&topic_id).expect("topic id must be valid"),
                "target_type": "topic"
            }),
        )
    );
    let serialized_report_audit =
        serde_json::to_string(&report_audit).expect("report audit must serialize");
    assert!(!serialized_report_audit.contains("spam"));
    assert!(!serialized_report_audit.contains("这是广告"));

    let forbidden = app
        .clone()
        .oneshot(get_request_with_headers(
            "/api/v1/admin/reports",
            &member_cookies,
        ))
        .await
        .expect("member report list must respond");
    assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);

    let (owner_cookies, owner_csrf) = login_owner(&app).await;
    let reports = app
        .clone()
        .oneshot(get_request_with_headers(
            "/api/v1/admin/reports?status=open",
            &owner_cookies,
        ))
        .await
        .expect("admin report list must respond");
    assert_eq!(reports.status(), StatusCode::OK);
    let reports_payload = response_json(reports).await;
    assert_eq!(reports_payload["data"].as_array().map(Vec::len), Some(1));
    assert_eq!(reports_payload["data"][0]["id"], report_id);

    let shortcut = app
        .clone()
        .oneshot(json_request_with_headers(
            Method::PATCH,
            &format!("/api/v1/admin/reports/{report_id}"),
            serde_json::json!({
                "status": "resolved",
                "resolution": "hide_topic",
                "note": "尝试绕过组合处置",
                "expected_revision": 1
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("direct final resolution must respond");
    assert_eq!(shortcut.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let reviewed = app
        .clone()
        .oneshot(json_request_with_headers(
            Method::PATCH,
            &format!("/api/v1/admin/reports/{report_id}"),
            serde_json::json!({
                "status": "in_review",
                "resolution": "none",
                "note": "开始核查",
                "expected_revision": 1
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("admin report resolution must respond");
    assert_eq!(reviewed.status(), StatusCode::OK);
    assert_eq!(response_json(reviewed).await["data"]["status"], "in_review");
    let stale = app
        .clone()
        .oneshot(json_request_with_headers(
            Method::PATCH,
            &format!("/api/v1/admin/reports/{report_id}"),
            serde_json::json!({
                "status": "open",
                "resolution": "none",
                "expected_revision": 1
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("stale triage update must respond");
    assert_eq!(stale.status(), StatusCode::CONFLICT);
    assert_eq!(
        response_json(stale).await["error"]["code"],
        "governance.report_conflict"
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM notifications
             WHERE recipient_id = $1 AND kind = 'report'",
        )
        .bind(member_id)
        .fetch_one(&pool)
        .await
        .expect("resolution notification count must be readable"),
        0
    );

    let visible_topic = app
        .clone()
        .oneshot(get_request(&format!("/api/v1/topics/{topic_id}")))
        .await
        .expect("topic lookup must respond");
    assert_eq!(visible_topic.status(), StatusCode::OK);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM admin_audit_log
             WHERE resource_type = 'content_report' AND action = 'report.review'"
        )
        .fetch_one(&pool)
        .await
        .expect("governance audit count must be readable"),
        1
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn report_detail_requires_read_capability_and_returns_bounded_context(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool.clone()), config);
    let (member_cookies, member_csrf) = register_member(&app).await;
    let long_content = "治理上下文".repeat(1_200);
    let topic = app
        .clone()
        .oneshot(json_request_with_headers(
            Method::POST,
            "/api/v1/topics",
            serde_json::json!({"title": "举报详情上下文", "content": long_content}),
            &member_cookies,
            Some(&member_csrf),
        ))
        .await
        .expect("topic creation must respond");
    assert_eq!(topic.status(), StatusCode::CREATED);
    let topic_id = response_json(topic).await["data"]["id"]
        .as_str()
        .expect("topic id must exist")
        .to_owned();
    let report = app
        .clone()
        .oneshot(json_request_with_headers(
            Method::POST,
            "/api/v1/reports",
            serde_json::json!({
                "target_type": "topic",
                "target_id": topic_id,
                "reason": "harassment",
                "details": "需要完整上下文判断"
            }),
            &member_cookies,
            Some(&member_csrf),
        ))
        .await
        .expect("report creation must respond");
    assert_eq!(report.status(), StatusCode::CREATED);
    let report_id = response_json(report).await["data"]["id"]
        .as_str()
        .expect("report id must exist")
        .to_owned();

    let forbidden = app
        .clone()
        .oneshot(get_request_with_headers(
            &format!("/api/v1/admin/reports/{report_id}"),
            &member_cookies,
        ))
        .await
        .expect("member report detail must respond");
    assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);

    let (owner_cookies, _owner_csrf) = login_owner(&app).await;
    let detail = app
        .clone()
        .oneshot(get_request_with_headers(
            &format!("/api/v1/admin/reports/{report_id}"),
            &owner_cookies,
        ))
        .await
        .expect("admin report detail must respond");
    assert_eq!(detail.status(), StatusCode::OK);
    let detail = response_json(detail).await;
    assert_eq!(detail["data"]["report"]["id"], report_id);
    assert_eq!(detail["data"]["report"]["revision"], 1);
    assert_eq!(detail["data"]["context"]["topic_id"], topic_id);
    assert_eq!(detail["data"]["context"]["items"][0]["is_target"], true);
    assert!(
        detail["data"]["context"]["items"][0]["content"]
            .as_str()
            .expect("context content must be text")
            .chars()
            .count()
            <= 2_000
    );
    assert_eq!(detail["data"]["author"]["status"], "active");
    assert_eq!(
        detail["data"]["related_reports"].as_array().map(Vec::len),
        Some(1)
    );
    assert_eq!(
        detail["data"]["handling_history"][0]["action"],
        "report.create"
    );
    assert!(
        detail["data"]["handling_history"][0]
            .get("summary")
            .is_none()
    );
    assert!(detail.to_string().find("email").is_none());
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn report_moderation_atomically_hides_content_restricts_author_and_rejects_stale_revision(
    pool: PgPool,
) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool.clone()), config);
    let (member_cookies, member_csrf) = register_member(&app).await;
    let topic = app
        .clone()
        .oneshot(json_request_with_headers(
            Method::POST,
            "/api/v1/topics",
            serde_json::json!({"title": "组合处置目标", "content": "需要处置的内容"}),
            &member_cookies,
            Some(&member_csrf),
        ))
        .await
        .expect("topic creation must respond");
    let topic_id = response_json(topic).await["data"]["id"]
        .as_str()
        .expect("topic id must exist")
        .to_owned();
    let report = app
        .clone()
        .oneshot(json_request_with_headers(
            Method::POST,
            "/api/v1/reports",
            serde_json::json!({
                "target_type": "topic",
                "target_id": topic_id,
                "reason": "spam"
            }),
            &member_cookies,
            Some(&member_csrf),
        ))
        .await
        .expect("report creation must respond");
    let report_id = response_json(report).await["data"]["id"]
        .as_str()
        .expect("report id must exist")
        .to_owned();
    let (owner_cookies, owner_csrf) = login_owner(&app).await;

    let moderated = app
        .clone()
        .oneshot(json_request_with_headers(
            Method::POST,
            &format!("/api/v1/admin/reports/{report_id}/moderations"),
            serde_json::json!({
                "disposition": "resolved",
                "content_action": "hide",
                "user_action": {
                    "kind": "restricted",
                    "reason": "重复发布广告内容",
                    "expires_at": null
                },
                "public_reason": "内容违反社区规则",
                "note": "已核对原文与举报历史",
                "expected_revision": 1
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("report moderation must respond");
    assert_eq!(moderated.status(), StatusCode::CREATED);
    let moderated = response_json(moderated).await;
    assert_eq!(moderated["data"]["report"]["status"], "resolved");
    assert_eq!(moderated["data"]["report"]["revision"], 2);
    assert_eq!(moderated["data"]["content"]["action"], "hide");
    assert_eq!(moderated["data"]["content"]["changed"], true);
    assert_eq!(moderated["data"]["user"]["status"], "restricted");
    assert_eq!(moderated["data"]["notification_queued"], true);
    assert!(moderated["data"]["audit_id"].is_string());

    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT status FROM topics WHERE id = $1")
            .bind(uuid::Uuid::parse_str(&topic_id).expect("topic id must parse"))
            .fetch_one(&pool)
            .await
            .expect("topic status must be readable"),
        "hidden"
    );
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT status FROM users WHERE username = 'member'")
            .fetch_one(&pool)
            .await
            .expect("author status must be readable"),
        "restricted"
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM outbox_events WHERE event_type IN ('user.status_changed', 'report.moderated')"
        )
        .fetch_one(&pool)
        .await
        .expect("moderation outbox count must be readable"),
        2
    );

    let stale = app
        .clone()
        .oneshot(json_request_with_headers(
            Method::POST,
            &format!("/api/v1/admin/reports/{report_id}/moderations"),
            serde_json::json!({
                "disposition": "dismissed",
                "content_action": "none",
                "user_action": null,
                "public_reason": null,
                "note": "过期页面提交",
                "expected_revision": 1
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("stale moderation must respond");
    assert_eq!(stale.status(), StatusCode::CONFLICT);
    assert_eq!(
        response_json(stale).await["error"]["code"],
        "governance.report_conflict"
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn report_moderation_rolls_back_content_when_user_action_is_forbidden(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool.clone()), config);
    let (member_cookies, member_csrf) = register_member(&app).await;
    let (owner_cookies, owner_csrf) = login_owner(&app).await;
    let topic = app
        .clone()
        .oneshot(json_request_with_headers(
            Method::POST,
            "/api/v1/topics",
            serde_json::json!({"title": "事务回滚目标", "content": "站长发布的内容"}),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("owner topic creation must respond");
    let topic_id = response_json(topic).await["data"]["id"]
        .as_str()
        .expect("topic id must exist")
        .to_owned();
    let report = app
        .clone()
        .oneshot(json_request_with_headers(
            Method::POST,
            "/api/v1/reports",
            serde_json::json!({"target_type": "topic", "target_id": topic_id, "reason": "other"}),
            &member_cookies,
            Some(&member_csrf),
        ))
        .await
        .expect("report creation must respond");
    let report_id = response_json(report).await["data"]["id"]
        .as_str()
        .expect("report id must exist")
        .to_owned();

    let failed = app
        .clone()
        .oneshot(json_request_with_headers(
            Method::POST,
            &format!("/api/v1/admin/reports/{report_id}/moderations"),
            serde_json::json!({
                "disposition": "resolved",
                "content_action": "hide",
                "user_action": {
                    "kind": "suspended",
                    "reason": "不允许暂停最后一名超级管理员",
                    "expires_at": null
                },
                "public_reason": null,
                "note": "验证原子回滚",
                "expected_revision": 1
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("forbidden moderation must respond");
    assert_eq!(failed.status(), StatusCode::CONFLICT);
    assert_eq!(
        response_json(failed).await["error"]["code"],
        "governance.target_state_conflict"
    );
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT status FROM topics WHERE id = $1")
            .bind(uuid::Uuid::parse_str(&topic_id).expect("topic id must parse"))
            .fetch_one(&pool)
            .await
            .expect("topic status must be readable"),
        "published"
    );
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT status FROM content_reports WHERE id = $1")
            .bind(uuid::Uuid::parse_str(&report_id).expect("report id must parse"))
            .fetch_one(&pool)
            .await
            .expect("report status must be readable"),
        "open"
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn suspended_authors_are_not_reportable_as_public_targets(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool.clone()), config);
    let (member_cookies, member_csrf) = register_member(&app).await;
    let topic = app
        .clone()
        .oneshot(json_request_with_headers(
            Method::POST,
            "/api/v1/topics",
            serde_json::json!({"title": "暂停作者主题", "content": "正文"}),
            &member_cookies,
            Some(&member_csrf),
        ))
        .await
        .expect("topic creation must respond");
    assert_eq!(topic.status(), StatusCode::CREATED);
    let topic_id = response_json(topic).await["data"]["id"]
        .as_str()
        .expect("topic id must be present")
        .to_owned();
    sqlx::query("UPDATE users SET status = 'suspended' WHERE username = 'member'")
        .execute(&pool)
        .await
        .expect("suspension fixture must update the author");

    let (owner_cookies, owner_csrf) = login_owner(&app).await;
    let report = app
        .clone()
        .oneshot(json_request_with_headers(
            Method::POST,
            "/api/v1/reports",
            serde_json::json!({
                "target_type": "topic",
                "target_id": topic_id,
                "reason": "spam"
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("report request must respond");
    assert_eq!(report.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        response_json(report).await["error"]["code"],
        "report.target_not_found"
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn batch_report_triage_is_atomic_and_audited(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool.clone()), config);
    let (member_cookies, member_csrf) = register_member(&app).await;
    let mut topic_ids = Vec::new();
    for index in 0..2 {
        let topic = app
            .clone()
            .oneshot(json_request_with_headers(
                Method::POST,
                "/api/v1/topics",
                serde_json::json!({"title": format!("批量举报 {index}"), "content": "正文"}),
                &member_cookies,
                Some(&member_csrf),
            ))
            .await
            .expect("topic creation must respond");
        assert_eq!(topic.status(), StatusCode::CREATED);
        topic_ids.push(
            response_json(topic).await["data"]["id"]
                .as_str()
                .expect("topic id must be present")
                .to_owned(),
        );
    }
    let mut report_ids = Vec::new();
    for topic_id in &topic_ids {
        let report = app
            .clone()
            .oneshot(json_request_with_headers(
                Method::POST,
                "/api/v1/reports",
                serde_json::json!({"target_type": "topic", "target_id": topic_id, "reason": "spam"}),
                &member_cookies,
                Some(&member_csrf),
            ))
            .await
            .expect("report creation must respond");
        assert_eq!(report.status(), StatusCode::CREATED);
        report_ids.push(
            response_json(report).await["data"]["id"]
                .as_str()
                .expect("report id must be present")
                .to_owned(),
        );
    }
    let (owner_cookies, owner_csrf) = login_owner(&app).await;
    let invalid = app
        .clone()
        .oneshot(json_request_with_headers(
            Method::POST,
            "/api/v1/admin/reports/batch",
            serde_json::json!({
                "report_ids": [report_ids[0], uuid::Uuid::now_v7()],
                "status": "in_review",
                "resolution": "none"
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("invalid batch must respond");
    assert_eq!(invalid.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM content_reports WHERE status = 'open'")
            .fetch_one(&pool)
            .await
            .expect("open report count must be readable"),
        2
    );

    let reviewed = app
        .clone()
        .oneshot(json_request_with_headers(
            Method::POST,
            "/api/v1/admin/reports/batch",
            serde_json::json!({
                "report_ids": report_ids,
                "status": "in_review",
                "resolution": "none",
                "note": "批量进入核查"
            }),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("batch resolution must respond");
    assert_eq!(reviewed.status(), StatusCode::OK);
    assert_eq!(response_json(reviewed).await["data"]["updated"], 2);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM admin_audit_log WHERE action = 'report.review'"
        )
        .fetch_one(&pool)
        .await
        .expect("batch audit count must be readable"),
        2
    );
}

#[tokio::test]
async fn governance_routes_are_documented() {
    let response = daoyun_api::app(unavailable_database())
        .oneshot(get_request("/api/v1/openapi.json"))
        .await
        .expect("OpenAPI route must respond");
    assert_eq!(response.status(), StatusCode::OK);
    let document = response_json(response).await;
    assert!(document["paths"]["/api/v1/reports"]["post"].is_object());
    assert!(document["paths"]["/api/v1/admin/reports"]["get"].is_object());
    assert!(document["paths"]["/api/v1/admin/reports/{report_id}"]["patch"].is_object());
    assert!(document["paths"]["/api/v1/admin/reports/{report_id}"]["get"].is_object());
    assert!(document["paths"]["/api/v1/admin/reports/{report_id}/moderations"]["post"].is_object());
    assert!(document["paths"]["/api/v1/admin/reports/batch"]["post"].is_object());
    assert!(document["paths"]["/api/v1/admin/audit"]["get"].is_object());
    assert!(document["paths"]["/api/v1/admin/audit/alerts"]["get"].is_object());
    for schema in [
        "ContentReport",
        "ContentReportDetail",
        "ReportContentContext",
        "ReportContextItem",
        "ReportAuthorContext",
        "ReportHistoryItem",
        "ReportHandlingRecord",
        "CreateReportModerationRequest",
        "ReportDisposition",
        "ReportContentAction",
        "ReportUserAction",
        "ReportUserActionKind",
        "ReportModerationResult",
        "ReportModerationContentResult",
        "ReportModerationUserResult",
        "ContentReportReceipt",
        "CreateReportRequest",
        "UpdateReportRequest",
        "ReportReason",
        "ReportResolution",
        "ReportStatus",
        "ReportTargetType",
        "AdminAuditEntry",
        "BatchUpdateReportsRequest",
        "BatchReportResult",
        "GovernancePolicy",
        "UpdateGovernancePolicyRequest",
        "RiskAlert",
        "UpdateRiskAlertRequest",
        "RiskAlertKind",
        "RiskAlertSeverity",
        "RiskAlertStatus",
        "AttachmentCleanupResult",
        "AttachmentScanStatus",
    ] {
        assert!(
            document["components"]["schemas"][schema].is_object(),
            "{schema}"
        );
    }
    assert!(document["paths"]["/api/v1/admin/governance/policy"]["get"].is_object());
    assert!(document["paths"]["/api/v1/admin/governance/policy"]["patch"].is_object());
    assert!(document["paths"]["/api/v1/admin/risk-alerts"]["get"].is_object());
    assert!(document["paths"]["/api/v1/admin/risk-alerts/{alert_id}"]["patch"].is_object());
    assert!(document["paths"]["/api/v1/admin/attachments/cleanup"]["post"].is_object());
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn governance_policy_scores_high_risk_reports_and_exposes_alerts(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool), config);
    let (member_cookies, member_csrf) = register_member(&app).await;
    let topic = app
        .clone()
        .oneshot(json_request_with_headers(
            Method::POST,
            "/api/v1/topics",
            serde_json::json!({"title": "高风险主题", "content": "正文"}),
            &member_cookies,
            Some(&member_csrf),
        ))
        .await
        .expect("topic creation must respond");
    let topic_id = response_json(topic).await["data"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let report = app
        .clone()
        .oneshot(json_request_with_headers(
            Method::POST,
            "/api/v1/reports",
            serde_json::json!({"target_type": "topic", "target_id": topic_id, "reason": "illegal"}),
            &member_cookies,
            Some(&member_csrf),
        ))
        .await
        .expect("high risk report must respond");
    assert_eq!(report.status(), StatusCode::CREATED);
    let (owner_cookies, owner_csrf) = login_owner(&app).await;
    let policy = app
        .clone()
        .oneshot(get_request_with_headers(
            "/api/v1/admin/governance/policy",
            &owner_cookies,
        ))
        .await
        .expect("policy must respond");
    assert_eq!(policy.status(), StatusCode::OK);
    assert_eq!(
        response_json(policy).await["data"]["alert_score_threshold"],
        70
    );
    let alerts = app
        .clone()
        .oneshot(get_request_with_headers(
            "/api/v1/admin/risk-alerts?status=open",
            &owner_cookies,
        ))
        .await
        .expect("risk alerts must respond");
    assert_eq!(alerts.status(), StatusCode::OK);
    let alert_id = response_json(alerts).await["data"][0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let acknowledged = app
        .clone()
        .oneshot(json_request_with_headers(
            Method::PATCH,
            &format!("/api/v1/admin/risk-alerts/{alert_id}"),
            serde_json::json!({"status": "acknowledged"}),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("risk alert update must respond");
    assert_eq!(acknowledged.status(), StatusCode::OK);
    assert_eq!(
        response_json(acknowledged).await["data"]["status"],
        "acknowledged"
    );

    let already_resolved = app
        .oneshot(json_request_with_headers(
            Method::PATCH,
            &format!("/api/v1/admin/risk-alerts/{alert_id}"),
            serde_json::json!({"status": "dismissed"}),
            &owner_cookies,
            Some(&owner_csrf),
        ))
        .await
        .expect("resolved risk alert update must respond");
    assert_eq!(already_resolved.status(), StatusCode::CONFLICT);
    assert_eq!(
        response_json(already_resolved).await["error"]["code"],
        "governance.alert_conflict"
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn concurrent_risk_alert_resolution_has_exactly_one_winner(pool: PgPool) {
    let config = daoyun_api::AuthConfig::default().with_secure_cookies(false);
    let app = daoyun_api::app_with_config(Database::from_pool(pool.clone()), config);
    let _ = register_member(&app).await;
    let (owner_cookies, owner_csrf) = login_owner(&app).await;
    let alert_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO risk_alerts (id, kind, severity, score, status, details)
         VALUES ($1, 'reporter_spike', 'high', 90, 'open', '{}'::jsonb)",
    )
    .bind(alert_id)
    .execute(&pool)
    .await
    .expect("risk alert fixture must insert");

    let acknowledge = app.clone().oneshot(json_request_with_headers(
        Method::PATCH,
        &format!("/api/v1/admin/risk-alerts/{alert_id}"),
        serde_json::json!({"status": "acknowledged"}),
        &owner_cookies,
        Some(&owner_csrf),
    ));
    let dismiss = app.clone().oneshot(json_request_with_headers(
        Method::PATCH,
        &format!("/api/v1/admin/risk-alerts/{alert_id}"),
        serde_json::json!({"status": "dismissed"}),
        &owner_cookies,
        Some(&owner_csrf),
    ));
    let (acknowledge, dismiss) = tokio::join!(acknowledge, dismiss);
    let acknowledge = acknowledge.expect("acknowledge request must respond");
    let dismiss = dismiss.expect("dismiss request must respond");
    let statuses = [acknowledge.status(), dismiss.status()];
    assert_eq!(
        statuses
            .iter()
            .filter(|status| **status == StatusCode::OK)
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
    let stored_status =
        sqlx::query_scalar::<_, String>("SELECT status FROM risk_alerts WHERE id = $1")
            .bind(alert_id)
            .fetch_one(&pool)
            .await
            .expect("resolved risk alert must be queryable");
    assert!(matches!(
        stored_status.as_str(),
        "acknowledged" | "dismissed"
    ));
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM admin_audit_log
             WHERE resource_type = 'risk_alert' AND resource_id = $1",
        )
        .bind(alert_id)
        .fetch_one(&pool)
        .await
        .expect("risk alert audit count must be queryable"),
        1
    );
}

async fn register_member(app: &axum::Router) -> (String, String) {
    let initialize = app
        .clone()
        .oneshot(json_request(
            "/api/v1/installation",
            serde_json::json!({
                "username": "owner",
                "email": "owner@example.com",
                "display_name": "管理员",
                "password": "correct horse battery staple"
            }),
        ))
        .await
        .expect("installation request must respond");
    assert_eq!(initialize.status(), StatusCode::CREATED);
    let registration = app
        .clone()
        .oneshot(json_request(
            "/api/v1/auth/register",
            serde_json::json!({
                "username": "member",
                "email": "member@example.com",
                "display_name": "社区成员",
                "password": "correct horse battery staple"
            }),
        ))
        .await
        .expect("registration request must respond");
    assert_eq!(registration.status(), StatusCode::CREATED);
    session_cookies(&registration)
}

async fn login_owner(app: &axum::Router) -> (String, String) {
    let login = app
        .clone()
        .oneshot(json_request(
            "/api/v1/auth/login",
            serde_json::json!({
                "identifier": "owner",
                "password": "correct horse battery staple"
            }),
        ))
        .await
        .expect("owner login request must respond");
    assert_eq!(login.status(), StatusCode::OK);
    session_cookies(&login)
}

fn json_request(uri: &str, value: serde_json::Value) -> Request<Body> {
    json_request_with_headers(Method::POST, uri, value, "", None)
}

fn json_request_with_headers(
    method: Method,
    uri: &str,
    value: serde_json::Value,
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

fn get_request(uri: &str) -> Request<Body> {
    Request::builder()
        .uri(uri)
        .body(Body::empty())
        .expect("GET request must be valid")
}

fn get_request_with_headers(uri: &str, cookies: &str) -> Request<Body> {
    Request::builder()
        .uri(uri)
        .header("cookie", cookies)
        .body(Body::empty())
        .expect("authenticated GET request must be valid")
}

fn session_cookies(response: &axum::response::Response) -> (String, String) {
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
    let csrf_token = csrf_cookie
        .split_once('=')
        .expect("CSRF cookie must contain a value")
        .1
        .to_owned();
    (format!("{session_cookie}; {csrf_cookie}"), csrf_token)
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
        .expect("unavailable database URL must be valid");
    Database::from_pool(pool)
}
