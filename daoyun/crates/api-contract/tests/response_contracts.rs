use api_contract::{
    AdminBoard, AdminBoardVisibility, AdminUserContentItem, AdminUserContentKind, AdminUserDetail,
    AdminUserStatus, AdminUserStatusUpdate, AdminUserSummary, ApiResponse, AuthenticatedSession,
    AuthenticatedUser, BlockState, BoardSummary, BoardTone, BookmarkState, BrandLink,
    ChangePasswordData, ChangePasswordRequest, ContentReport, ConversationLastMessage,
    ConversationReadState, ConversationSummary, CreateAdminBoardRequest, CreateConversationRequest,
    CreateReplyRequest, CreateTopicRequest, DirectMessage, ErrorBody, ErrorCode, ErrorResponse,
    ExternalIdentity, FollowState, InitialAdministrator, InitializeInstallationRequest,
    InstallationInitialization, InstallationStatus, LogoutData, MarkConversationReadRequest,
    MfaChallengeData, MfaCodeRequest, MfaDisableData, MfaEnableData, MfaRecoveryCodesData,
    MfaSetupData, MfaStatus, MfaVerifyRequest, ModerateTopicRequest, Notification,
    NotificationKind, NotificationTarget, NotificationUnreadCount, OidcAuthorizationStartData,
    OidcProvider, PageResponse, PostLikeState, RecentAuthData, RegistrationEmailChallengeData,
    RegistrationEmailChallengeRequest, RegistrationPolicy, ReplyRevision, ReportReason,
    ReportResolution, ReportStatus, ReportTargetType, RequestId, SendDirectMessageRequest,
    SiteBranding, SmtpSettings, SmtpTlsMode, TestSmtpSettingsRequest, TopicAuthorSummary,
    TopicBoardSummary, TopicDetail, TopicModerationHistoryAction, TopicModerationHistoryEntry,
    TopicModerationHistorySource, TopicModerationResult, TopicModerationStatus, TopicReply,
    TopicScope, TopicSort, TopicSummary, UnlinkExternalIdentityData, UpdateAdminBoardRequest,
    UpdateAdminUserStatusRequest, UpdateReplyRequest, UpdateSiteBrandingRequest,
    UpdateSmtpSettingsRequest, UpdateUserProfileRequest, UserProfile, UserProfileViewer,
    UserSummary, error_codes,
};
use serde_json::json;
use uuid::Uuid;

#[test]
fn registration_email_contracts_keep_verification_secrets_write_only() {
    let policy = serde_json::to_value(RegistrationPolicy {
        email_verification_required: true,
        code_expires_in_seconds: 600,
        resend_after_seconds: 60,
    })
    .expect("registration policy must serialize");
    assert_eq!(policy["email_verification_required"], true);

    let request: RegistrationEmailChallengeRequest = serde_json::from_value(json!({
        "email": "member@example.com"
    }))
    .expect("challenge request must deserialize");
    assert_eq!(request.email, "member@example.com");

    let challenge_id = fixed_uuid(401);
    let challenge = serde_json::to_value(RegistrationEmailChallengeData {
        challenge_id,
        expires_at: "2026-08-24T12:10:00Z".to_owned(),
        resend_after_seconds: 60,
    })
    .expect("challenge response must serialize");
    assert_eq!(challenge["challenge_id"], challenge_id.to_string());
    assert!(!challenge.to_string().contains("123456"));

    let register: api_contract::RegisterRequest = serde_json::from_value(json!({
        "username": "member",
        "email": "member@example.com",
        "display_name": "Member",
        "password": "secret12",
        "email_challenge_id": challenge_id,
        "email_verification_code": "123456"
    }))
    .expect("verified registration request must deserialize");
    assert_eq!(register.email_challenge_id, Some(challenge_id));
    assert_eq!(register.email_verification_code.as_deref(), Some("123456"));
}

#[test]
fn smtp_settings_contract_never_serializes_the_password() {
    let settings = serde_json::to_value(SmtpSettings {
        host: "smtp.example.com".to_owned(),
        port: 587,
        username: Some("mailer".to_owned()),
        password_configured: true,
        tls_mode: SmtpTlsMode::Starttls,
        from_email: "noreply@example.com".to_owned(),
        from_name: "DaoYun".to_owned(),
        enabled: true,
        registration_email_verification_enabled: true,
    })
    .expect("SMTP settings must serialize");
    assert_eq!(settings["password_configured"], true);
    assert!(!settings.to_string().contains("password_ciphertext"));
    assert!(!settings.to_string().contains("super-secret"));

    let update: UpdateSmtpSettingsRequest = serde_json::from_value(json!({
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
    }))
    .expect("SMTP update must deserialize");
    assert_eq!(update.password.as_deref(), Some("super-secret"));

    let test: TestSmtpSettingsRequest = serde_json::from_value(json!({
        "recipient_email": "admin@example.com"
    }))
    .expect("SMTP test request must deserialize");
    assert_eq!(test.recipient_email, "admin@example.com");
}

#[test]
fn branding_contract_adds_layout_fields_without_breaking_old_update_requests() {
    let branding = serde_json::to_value(SiteBranding {
        site_name: "刀云".to_owned(),
        logo_url: Some("/api/v1/site-branding/assets/logo".to_owned()),
        favicon_url: Some("/api/v1/site-branding/assets/favicon".to_owned()),
        default_cover_url: Some("https://cdn.example.com/default-cover.webp".to_owned()),
        navigation_links: vec![BrandLink {
            label: "文档".to_owned(),
            url: "/docs".to_owned(),
        }],
        footer_text: Some("自托管社区".to_owned()),
        footer_links: vec![BrandLink {
            label: "隐私".to_owned(),
            url: "#privacy".to_owned(),
        }],
        primary_color: "#176a4d".to_owned(),
        accent_color: "#c85516".to_owned(),
        theme_preset: api_contract::BrandThemePreset::Default,
        list_density: api_contract::BrandListDensity::Comfortable,
        home_mode: api_contract::BrandHomeMode::Latest,
    })
    .expect("branding must serialize");

    assert_eq!(branding["navigation_links"][0]["label"], "文档");
    assert_eq!(branding["footer_links"][0]["url"], "#privacy");

    let old_request: UpdateSiteBrandingRequest = serde_json::from_value(json!({
        "site_name": "刀云",
        "logo_url": null,
        "favicon_url": null,
        "primary_color": "#176a4d",
        "accent_color": "#c85516",
        "theme_preset": "default",
        "list_density": "comfortable",
        "home_mode": "latest"
    }))
    .expect("the pre-expansion update shape must remain valid");

    assert!(old_request.default_cover_url.is_none());
    assert!(old_request.navigation_links.is_none());
    assert!(old_request.footer_text.is_none());
    assert!(old_request.footer_links.is_none());
}

#[test]
fn admin_board_contract_exposes_hierarchy_and_optimistic_revision_fields() {
    let parent_id = fixed_uuid(301);
    let board = serde_json::to_value(AdminBoard {
        id: fixed_uuid(302),
        parent_id: Some(parent_id),
        slug: "announcements".to_owned(),
        name: "公告".to_owned(),
        description: "站点公告".to_owned(),
        icon: "megaphone".to_owned(),
        tone: BoardTone::Amber,
        position: 1,
        visibility: AdminBoardVisibility::Public,
        topic_count: 3,
        revision: 4,
    })
    .expect("admin board must serialize");
    assert_eq!(board["parent_id"], parent_id.to_string());
    assert_eq!(board["revision"], 4);

    let create: CreateAdminBoardRequest = serde_json::from_value(json!({
        "parent_id": parent_id,
        "slug": "feedback",
        "name": "反馈",
        "description": "",
        "icon": "messages",
        "tone": "green",
        "position": 0,
        "visibility": "hidden"
    }))
    .expect("hierarchical board creation request must deserialize");
    assert_eq!(create.parent_id, Some(parent_id));

    let update: UpdateAdminBoardRequest = serde_json::from_value(json!({
        "parent_id": null,
        "slug": "feedback",
        "name": "反馈与建议",
        "description": "",
        "icon": "messages",
        "tone": "green",
        "position": 2,
        "visibility": "public",
        "expected_revision": 4
    }))
    .expect("board update request with revision must deserialize");
    assert_eq!(update.parent_id, None);
    assert_eq!(update.expected_revision, 4);
}

#[test]
fn mfa_contracts_expose_only_approved_security_fields() {
    let challenge_id = fixed_uuid(250);
    assert_eq!(
        serde_json::to_value(MfaStatus {
            enabled: true,
            setup_pending: false,
            recovery_codes_remaining: 8,
        })
        .expect("MFA status must serialize"),
        json!({
            "enabled": true,
            "setup_pending": false,
            "recovery_codes_remaining": 8,
        })
    );
    let setup = serde_json::to_value(MfaSetupData {
        secret_base32: "JBSWY3DPEHPK3PXP".to_owned(),
        otpauth_url: "otpauth://totp/DaoYun:user@example.com".to_owned(),
        expires_at: "2026-08-10T00:00:00Z".to_owned(),
    })
    .expect("MFA setup must serialize");
    assert_eq!(setup["secret_base32"], "JBSWY3DPEHPK3PXP");
    assert!(!setup.to_string().contains("hash"));

    assert_eq!(
        serde_json::to_value(MfaEnableData {
            enabled: true,
            csrf_token: "csrf".to_owned(),
            recovery_codes: vec!["ABCD-EFGH-IJKL".to_owned()],
        })
        .expect("MFA enable must serialize")["recovery_codes"][0],
        "ABCD-EFGH-IJKL"
    );
    assert_eq!(
        serde_json::to_value(MfaDisableData {
            disabled: true,
            csrf_token: "csrf".to_owned(),
        })
        .expect("MFA disable must serialize")["disabled"],
        true
    );
    assert_eq!(
        serde_json::to_value(MfaRecoveryCodesData {
            recovery_codes: vec!["ABCD-EFGH-IJKL".to_owned()],
            csrf_token: "csrf".to_owned(),
        })
        .expect("recovery code regeneration must serialize")["csrf_token"],
        "csrf"
    );
    assert_eq!(
        serde_json::to_value(MfaChallengeData {
            challenge_id,
            expires_at: "2026-08-10T00:00:00Z".to_owned(),
        })
        .expect("MFA challenge must serialize")["challenge_id"],
        challenge_id.to_string()
    );
    assert_eq!(
        serde_json::to_value(MfaCodeRequest {
            code: "123456".to_owned(),
        })
        .expect("MFA code request must serialize")["code"],
        "123456"
    );
    assert_eq!(
        serde_json::to_value(MfaVerifyRequest {
            challenge_id,
            code: "123456".to_owned(),
        })
        .expect("MFA verify request must serialize")["challenge_id"],
        challenge_id.to_string()
    );
}

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
fn oidc_provider_contract_exposes_only_public_metadata() {
    let value = serde_json::to_value(OidcProvider {
        provider_key: "google".to_owned(),
        display_name: "Google".to_owned(),
    })
    .expect("OIDC provider must serialize");

    assert_eq!(
        value,
        json!({
            "provider_key": "google",
            "display_name": "Google",
        })
    );
}

#[test]
fn external_identity_binding_contract_omits_provider_subject_and_tokens() {
    let identity_id = fixed_uuid(220);
    let identity = serde_json::to_value(ExternalIdentity {
        id: identity_id,
        provider_key: "google".to_owned(),
        created_at: "2026-08-08T10:00:00Z".to_owned(),
        last_authenticated_at: Some("2026-08-08T10:05:00Z".to_owned()),
    })
    .expect("external identity must serialize");
    assert_eq!(
        identity,
        json!({
            "id": identity_id,
            "provider_key": "google",
            "created_at": "2026-08-08T10:00:00Z",
            "last_authenticated_at": "2026-08-08T10:05:00Z",
        })
    );
    assert!(!identity.to_string().contains("subject"));
    assert!(!identity.to_string().contains("issuer"));
    assert!(!identity.to_string().contains("email"));

    let start = serde_json::to_value(OidcAuthorizationStartData {
        authorization_url: "https://accounts.example.com/oauth2/authorize?state=state".to_owned(),
    })
    .expect("OIDC authorization start must serialize");
    assert_eq!(
        start,
        json!({
            "authorization_url": "https://accounts.example.com/oauth2/authorize?state=state",
        })
    );
}

#[test]
fn unlink_external_identity_contract_exposes_only_result_and_rotated_csrf() {
    let value = serde_json::to_value(UnlinkExternalIdentityData {
        unlinked: true,
        csrf_token: "a".repeat(64),
    })
    .expect("unlink response must serialize");

    assert_eq!(
        value,
        json!({ "unlinked": true, "csrf_token": "a".repeat(64) })
    );
}

#[test]
fn notification_contract_exposes_target_and_read_state() {
    let notification_id = fixed_uuid(210);
    let target_id = fixed_uuid(211);
    let value = serde_json::to_value(Notification {
        id: notification_id,
        kind: NotificationKind::Reply,
        actor: None,
        target: NotificationTarget::Topic,
        target_id,
        read_at: None,
        created_at: "2026-08-04T10:00:00Z".to_owned(),
    })
    .expect("notification must serialize");
    assert_eq!(value["kind"], "reply");
    assert_eq!(value["target"], "topic");
    assert!(value["read_at"].is_null());
    assert_eq!(
        serde_json::to_value(NotificationUnreadCount { unread_count: 2 })
            .expect("unread count must serialize"),
        json!({ "unread_count": 2 })
    );
}

#[test]
fn moderation_contract_uses_explicit_status_and_reason() {
    let request: ModerateTopicRequest = serde_json::from_value(json!({
        "status": "rejected",
        "reason": "需要补充来源"
    }))
    .expect("moderation request must deserialize");
    assert_eq!(request.status, TopicModerationStatus::Rejected);
    assert_eq!(request.reason.as_deref(), Some("需要补充来源"));
    let value = serde_json::to_value(TopicModerationResult {
        topic_id: fixed_uuid(212),
        status: TopicModerationStatus::Hidden,
    })
    .expect("moderation result must serialize");
    assert_eq!(value["status"], "hidden");
}

#[test]
fn report_contract_uses_explicit_target_and_resolution_enums() {
    let request: api_contract::CreateReportRequest = serde_json::from_value(json!({
        "target_type": "post",
        "target_id": fixed_uuid(213),
        "reason": "harassment",
        "details": "包含针对个人的攻击"
    }))
    .expect("report request must deserialize");
    assert_eq!(request.target_type, ReportTargetType::Post);
    assert_eq!(request.reason, ReportReason::Harassment);

    let value = serde_json::to_value(ContentReport {
        id: fixed_uuid(214),
        target_type: ReportTargetType::Topic,
        target_id: fixed_uuid(215),
        target_topic_id: Some(fixed_uuid(215)),
        target_title: Some("需要审核".to_owned()),
        target_author: None,
        reporter: api_contract::UserSummary {
            id: fixed_uuid(216),
            username: "reporter".to_owned(),
            display_name: "举报者".to_owned(),
            avatar_url: None,
        },
        reason: ReportReason::Spam,
        details: None,
        status: ReportStatus::Resolved,
        resolution: ReportResolution::HideTopic,
        resolution_note: Some("确认是广告".to_owned()),
        reviewer: None,
        created_at: "2026-08-05T10:00:00Z".to_owned(),
        updated_at: "2026-08-05T10:01:00Z".to_owned(),
        resolved_at: Some("2026-08-05T10:01:00Z".to_owned()),
        revision: 1,
    })
    .expect("report must serialize");
    assert_eq!(value["target_type"], "topic");
    assert_eq!(value["status"], "resolved");
    assert_eq!(value["resolution"], "hide_topic");
}

#[test]
fn report_detail_contract_bounds_context_and_excludes_internal_audit_summary() {
    let value = json!({
        "report": {
            "id": fixed_uuid(220),
            "target_type": "post",
            "target_id": fixed_uuid(221),
            "target_topic_id": fixed_uuid(222),
            "target_title": "需要审核",
            "target_author": null,
            "reporter": {
                "id": fixed_uuid(223),
                "username": "reporter",
                "display_name": "举报者",
                "avatar_url": null
            },
            "reason": "harassment",
            "details": "包含攻击内容",
            "status": "open",
            "resolution": "none",
            "resolution_note": null,
            "reviewer": null,
            "created_at": "2026-08-12T10:00:00Z",
            "updated_at": "2026-08-12T10:00:00Z",
            "resolved_at": null,
            "revision": 1
        },
        "context": {
            "topic_id": fixed_uuid(222),
            "title": "需要审核",
            "items": [{
                "id": fixed_uuid(221),
                "author": null,
                "content": "受限长度的上下文",
                "status": "published",
                "is_target": true,
                "created_at": "2026-08-12T09:59:00Z"
            }]
        },
        "author": null,
        "related_reports": [],
        "handling_history": [{
            "id": fixed_uuid(224),
            "action": "report.create",
            "actor": {
                "id": fixed_uuid(223),
                "username": "reporter",
                "display_name": "举报者",
                "avatar_url": null
            },
            "created_at": "2026-08-12T10:00:00Z"
        }]
    });
    let detail: api_contract::ContentReportDetail =
        serde_json::from_value(value).expect("report detail must deserialize");
    let serialized = serde_json::to_value(detail).expect("report detail must serialize");

    assert_eq!(serialized["report"]["revision"], 1);
    assert_eq!(serialized["context"]["items"][0]["is_target"], true);
    assert!(serialized["handling_history"][0].get("summary").is_none());
}

#[test]
fn report_moderation_contract_separates_public_reason_from_internal_note() {
    let request: api_contract::CreateReportModerationRequest = serde_json::from_value(json!({
        "disposition": "resolved",
        "content_action": "hide",
        "user_action": {
            "kind": "restricted",
            "reason": "重复发布攻击内容",
            "expires_at": "2026-08-20T10:00:00Z"
        },
        "public_reason": "内容违反社区规则",
        "note": "已核对上下文和历史举报",
        "expected_revision": 3
    }))
    .expect("moderation request must deserialize");

    assert_eq!(
        request.disposition,
        api_contract::ReportDisposition::Resolved
    );
    assert_eq!(
        request.content_action,
        api_contract::ReportContentAction::Hide
    );
    assert_eq!(
        request.user_action.expect("user action must exist").kind,
        api_contract::ReportUserActionKind::Restricted
    );
    assert_eq!(request.public_reason.as_deref(), Some("内容违反社区规则"));
    assert_eq!(request.note, "已核对上下文和历史举报");
    assert_eq!(request.expected_revision, 3);
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

#[test]
fn installation_initialization_request_deserializes_the_public_contract() {
    let request: InitializeInstallationRequest = serde_json::from_value(json!({
        "username": "owner",
        "email": "owner@example.com",
        "display_name": "站点管理员",
        "password": "correct horse battery staple"
    }))
    .expect("initialization request must deserialize");

    assert_eq!(request.username, "owner");
    assert_eq!(request.email, "owner@example.com");
    assert_eq!(request.display_name, "站点管理员");
    assert_eq!(request.password, "correct horse battery staple");
}

#[test]
fn installation_initialization_response_exposes_no_credentials() {
    let administrator_id =
        Uuid::parse_str("019fc700-0000-7000-8000-000000000001").expect("fixture must be a UUID");
    let response = ApiResponse::new(
        InstallationInitialization {
            is_initialized: true,
            administrator: InitialAdministrator {
                id: administrator_id,
                username: "owner".to_owned(),
                email: "owner@example.com".to_owned(),
                display_name: "站点管理员".to_owned(),
            },
        },
        fixed_request_id(),
    );

    let payload = serde_json::to_value(response).expect("initialization response must serialize");

    assert_eq!(
        payload,
        json!({
            "data": {
                "is_initialized": true,
                "administrator": {
                    "id": administrator_id,
                    "username": "owner",
                    "email": "owner@example.com",
                    "display_name": "站点管理员"
                }
            },
            "meta": { "request_id": fixed_request_id() }
        })
    );
    assert!(!payload.to_string().contains("password"));
}

#[test]
fn installation_error_codes_are_stable() {
    assert_eq!(
        error_codes::INSTALLATION_ALREADY_INITIALIZED,
        "installation.already_initialized"
    );
    assert_eq!(error_codes::INTERNAL_ERROR, "system.internal_error");
}

#[test]
fn auth_session_serializes_only_public_user_and_csrf_data() {
    let user_id = fixed_user_id();
    let response = ApiResponse::new(
        AuthenticatedSession {
            user: AuthenticatedUser {
                id: user_id,
                username: "owner".to_owned(),
                email: "owner@example.com".to_owned(),
                display_name: "站点管理员".to_owned(),
            },
            csrf_token: "a".repeat(64),
        },
        fixed_request_id(),
    );

    let payload = serde_json::to_value(response).expect("auth session must serialize");
    assert_eq!(payload["data"]["user"]["id"], user_id.to_string());
    assert_eq!(payload["data"]["csrf_token"], "a".repeat(64));
    assert!(!payload.to_string().contains("password"));
    assert!(!payload.to_string().contains("token_hash"));
}

#[test]
fn logout_response_is_an_enveloped_boolean() {
    let response = ApiResponse::new(LogoutData { logged_out: true }, fixed_request_id());
    assert_eq!(
        serde_json::to_value(response).expect("logout response must serialize"),
        json!({
            "data": { "logged_out": true },
            "meta": { "request_id": fixed_request_id() }
        })
    );
}

#[test]
fn recent_auth_response_exposes_only_status_and_expiry() {
    let response = ApiResponse::new(
        RecentAuthData {
            authenticated: true,
            expires_at: "2026-08-08T12:10:00Z".to_owned(),
        },
        fixed_request_id(),
    );
    let value = serde_json::to_value(response).expect("recent auth response must serialize");
    assert_eq!(value["data"]["authenticated"], true);
    assert_eq!(value["data"]["expires_at"], "2026-08-08T12:10:00Z");
    assert!(value["data"].get("password").is_none());
    assert!(value["data"].get("token").is_none());
}

#[test]
fn password_change_contract_exposes_only_the_rotated_csrf_token() {
    let request: ChangePasswordRequest = serde_json::from_value(json!({
        "new_password": "new secure password"
    }))
    .expect("password change request must deserialize");
    assert_eq!(request.new_password, "new secure password");

    let response = ApiResponse::new(
        ChangePasswordData {
            csrf_token: "b".repeat(64),
        },
        fixed_request_id(),
    );
    let value = serde_json::to_value(response).expect("password response must serialize");
    assert_eq!(value["data"], json!({ "csrf_token": "b".repeat(64) }));
    assert!(value["data"].get("password").is_none());
    assert!(value["data"].get("token_hash").is_none());
}

#[test]
fn auth_error_codes_are_stable() {
    assert_eq!(error_codes::AUTH_CSRF_FAILED, "auth.csrf_failed");
    assert_eq!(
        error_codes::AUTH_IDENTITY_UNAVAILABLE,
        "auth.identity_unavailable"
    );
    assert_eq!(
        error_codes::AUTH_INVALID_CREDENTIALS,
        "auth.invalid_credentials"
    );
    assert_eq!(error_codes::AUTH_OIDC_FAILED, "auth.oidc_failed");
    assert_eq!(
        error_codes::AUTH_OIDC_CLAIM_REQUIRED,
        "auth.oidc_claim_required"
    );
    assert_eq!(
        error_codes::AUTH_OIDC_PROVIDER_NOT_FOUND,
        "auth.oidc_provider_not_found"
    );
    assert_eq!(error_codes::AUTH_RATE_LIMITED, "auth.rate_limited");
    assert_eq!(
        error_codes::AUTH_RECENT_AUTH_REQUIRED,
        "auth.recent_auth_required"
    );
    assert_eq!(error_codes::AUTH_UNAUTHENTICATED, "auth.unauthenticated");
    assert_eq!(error_codes::AUTH_PASSKEY_FAILED, "auth.passkey_failed");
    assert_eq!(
        error_codes::AUTH_PASSKEY_NOT_FOUND,
        "auth.passkey_not_found"
    );
}

#[test]
fn passkey_wire_contract_uses_browser_field_names_without_private_material() {
    let options = api_contract::PasskeyRegistrationOptionsData {
        challenge_id: fixed_user_id(),
        options: api_contract::PasskeyRegistrationOptions {
            challenge: "challenge".to_owned(),
            rp: api_contract::PasskeyRp {
                id: "example.com".to_owned(),
                name: "DaoYun".to_owned(),
            },
            user: api_contract::PasskeyUser {
                id: "user".to_owned(),
                name: "alice".to_owned(),
                display_name: "Alice".to_owned(),
            },
            pub_key_cred_params: vec![api_contract::PasskeyCredentialParameter {
                kind: "public-key".to_owned(),
                alg: -7,
            }],
            exclude_credentials: Vec::new(),
            timeout: 60_000,
            authenticator_selection: api_contract::PasskeyAuthenticatorSelection {
                authenticator_attachment: Some("platform".to_owned()),
                resident_key: Some("preferred".to_owned()),
                user_verification: "required".to_owned(),
            },
            attestation: "none".to_owned(),
        },
    };
    let value = serde_json::to_value(options).expect("passkey options must serialize");
    assert_eq!(value["challenge_id"], fixed_user_id().to_string());
    assert_eq!(
        value["options"]["pubKeyCredParams"][0]["type"],
        "public-key"
    );
    assert_eq!(value["options"]["user"]["displayName"], "Alice");
    assert_eq!(
        value["options"]["authenticatorSelection"]["userVerification"],
        "required"
    );
    assert!(value.get("public_key_cose").is_none());
    assert!(value.get("counter").is_none());
}

#[test]
fn user_profile_and_relationship_contracts_exclude_private_identity_fields() {
    let update: UpdateUserProfileRequest = serde_json::from_value(json!({
        "base_revision": 2,
        "display_name": "林屿",
        "bio": "保持好奇。",
        "location": "杭州",
        "website_url": "https://example.com",
        "avatar_url": "https://example.com/avatar.png"
    }))
    .expect("profile update request must deserialize");
    assert_eq!(update.base_revision, 2);
    assert_eq!(update.display_name, "林屿");

    let user_id = fixed_user_id();
    let profile = UserProfile {
        user: UserSummary {
            id: user_id,
            username: "linyu".to_owned(),
            display_name: "林屿".to_owned(),
            avatar_url: Some("https://example.com/avatar.png".to_owned()),
        },
        bio: "保持好奇。".to_owned(),
        location: Some("杭州".to_owned()),
        website_url: Some("https://example.com".to_owned()),
        profile_revision: 3,
        created_at: "2026-08-03T12:00:00Z".to_owned(),
        topic_count: 7,
        follower_count: 12,
        following_count: 5,
        viewer: Some(UserProfileViewer {
            is_self: false,
            is_following: true,
            is_blocked_by_viewer: false,
            can_message: true,
        }),
    };
    let value = serde_json::to_value(profile).expect("profile must serialize");

    assert_eq!(value["id"], user_id.to_string());
    assert_eq!(value["username"], "linyu");
    assert_eq!(value["avatar_url"], "https://example.com/avatar.png");
    assert_eq!(value["viewer"]["is_following"], true);
    for private_field in ["email", "status", "password", "session"] {
        assert!(!value.to_string().contains(private_field));
    }

    assert!(
        FollowState {
            user_id,
            following: true,
            follower_count: 12,
            following_count: 5,
        }
        .following
    );
    assert!(
        BlockState {
            user_id,
            blocked: false
        }
        .user_id
            == user_id
    );
    assert_eq!(error_codes::USER_NOT_FOUND, "user.not_found");
    assert_eq!(
        error_codes::PROFILE_REVISION_CONFLICT,
        "profile.revision_conflict"
    );
    assert_eq!(
        error_codes::RELATIONSHIP_SELF_FOLLOW_NOT_ALLOWED,
        "relationship.self_follow_not_allowed"
    );
    assert_eq!(
        error_codes::RELATIONSHIP_SELF_BLOCK_NOT_ALLOWED,
        "relationship.self_block_not_allowed"
    );
}

#[test]
fn admin_user_contracts_expose_management_context_without_private_identity_fields() {
    let user_id = fixed_user_id();
    let summary = AdminUserSummary {
        id: user_id,
        username: "linyu".to_owned(),
        display_name: "林屿".to_owned(),
        avatar_url: None,
        status: AdminUserStatus::Active,
        primary_role: Some("站长".to_owned()),
        topic_count: 7,
        post_count: 12,
        report_count: 2,
        created_at: "2026-08-03T12:00:00Z".to_owned(),
        last_seen_at: Some("2026-08-12T08:00:00Z".to_owned()),
    };
    let detail = AdminUserDetail {
        summary,
        bio: "保持好奇。".to_owned(),
        location: Some("杭州".to_owned()),
        website_url: None,
        follower_count: 12,
        following_count: 5,
        roles: Vec::new(),
        restriction_reason: None,
        restriction_expires_at: None,
        revision: 1,
    };
    let value = serde_json::to_value(detail).expect("admin user detail must serialize");

    assert_eq!(value["id"], user_id.to_string());
    assert_eq!(value["status"], "active");
    assert_eq!(value["revision"], 1);
    for private_field in ["email", "password", "session", "token", "external_identity"] {
        assert!(!value.to_string().contains(private_field));
    }

    let content = serde_json::to_value(AdminUserContentItem {
        id: user_id,
        kind: AdminUserContentKind::Topic,
        topic_id: user_id,
        title: Some("主题".to_owned()),
        excerpt: "内容摘要".to_owned(),
        status: "published".to_owned(),
        created_at: "2026-08-03T12:00:00Z".to_owned(),
    })
    .expect("admin user content must serialize");
    assert_eq!(content["kind"], "topic");
}

#[test]
fn bookmark_and_post_like_state_contracts_are_stable() {
    let topic_id =
        Uuid::parse_str("019fc800-0000-7000-8000-000000000101").expect("fixture must be a UUID");
    let post_id =
        Uuid::parse_str("019fc800-0000-7000-8000-000000000201").expect("fixture must be a UUID");

    assert_eq!(
        serde_json::to_value(BookmarkState {
            topic_id,
            bookmarked: true,
        })
        .expect("bookmark state must serialize"),
        json!({ "topic_id": topic_id, "bookmarked": true })
    );
    assert_eq!(
        serde_json::to_value(PostLikeState {
            post_id,
            liked: false,
            like_count: 12,
        })
        .expect("post like state must serialize"),
        json!({ "post_id": post_id, "liked": false, "like_count": 12 })
    );
}

#[test]
fn topic_summary_and_detail_serialize_only_the_public_contract() {
    let topic_id =
        Uuid::parse_str("019fc800-0000-7000-8000-000000000101").expect("fixture must be a UUID");
    let board_id =
        Uuid::parse_str("019fc800-0000-7000-8000-000000000011").expect("fixture must be a UUID");
    let summary = TopicSummary {
        id: topic_id,
        title: "SQLx 的编译期查询检查".to_owned(),
        excerpt: "保留 SQL 控制力并获得类型检查。".to_owned(),
        author: TopicAuthorSummary {
            id: fixed_user_id(),
            username: "author".to_owned(),
            display_name: "作者".to_owned(),
            avatar_url: Some("https://example.com/author.png".to_owned()),
        },
        board: TopicBoardSummary {
            id: board_id,
            slug: "engineering".to_owned(),
            name: "工程实践".to_owned(),
            tone: BoardTone::Green,
        },
        published_at: "2026-08-03T12:00:00Z".to_owned(),
        last_activity_at: "2026-08-03T13:00:00Z".to_owned(),
        reply_count: 3,
        like_count: 8,
        viewer_bookmarked: Some(true),
        viewer_liked: Some(false),
        view_count: 21,
        is_featured: true,
        is_pinned: false,
        tags: Vec::new(),
    };
    let payload = serde_json::to_value(TopicDetail {
        summary,
        content: "正文".to_owned(),
        rich_content: None,
        content_revision: 1,
        has_locked_content: false,
    })
    .expect("topic detail must serialize");

    assert_eq!(
        payload,
        json!({
            "id": topic_id,
            "title": "SQLx 的编译期查询检查",
            "excerpt": "保留 SQL 控制力并获得类型检查。",
            "author": {
                "id": fixed_user_id(),
                "username": "author",
                "display_name": "作者",
                "avatar_url": "https://example.com/author.png"
            },
            "board": {
                "id": board_id,
                "slug": "engineering",
                "name": "工程实践",
                "tone": "green"
            },
            "published_at": "2026-08-03T12:00:00Z",
            "last_activity_at": "2026-08-03T13:00:00Z",
            "reply_count": 3,
            "like_count": 8,
            "viewer_bookmarked": true,
            "viewer_liked": false,
            "view_count": 21,
            "is_featured": true,
            "is_pinned": false,
            "tags": [],
            "content": "正文",
            "rich_content": null,
            "content_revision": 1,
            "has_locked_content": false
        })
    );
    for private_field in ["email", "status", "hot_score", "deleted_at"] {
        assert!(!payload.to_string().contains(private_field));
    }
}

#[test]
fn topic_sort_and_error_codes_are_stable() {
    for (value, expected) in [
        ("latest", TopicSort::Latest),
        ("popular", TopicSort::Popular),
        ("active", TopicSort::Active),
    ] {
        let parsed: TopicSort =
            serde_json::from_value(json!(value)).expect("sort must deserialize");
        assert_eq!(parsed, expected);
    }
    assert_eq!(
        serde_json::to_value(TopicScope::Following).expect("scope must serialize"),
        json!("following")
    );
    assert_eq!(error_codes::PATH_INVALID, "request.path_invalid");
    assert_eq!(error_codes::TOPIC_NOT_FOUND, "topic.not_found");
    assert_eq!(
        error_codes::TOPIC_BOARD_UNAVAILABLE,
        "topic.board_unavailable"
    );
    assert_eq!(
        error_codes::IDEMPOTENCY_CONFLICT,
        "request.idempotency_conflict"
    );
}

#[test]
fn topic_moderation_history_exposes_only_traceable_fields() {
    let id = fixed_uuid(501);
    let value = serde_json::to_value(TopicModerationHistoryEntry {
        id,
        source: TopicModerationHistorySource::Governance,
        action: TopicModerationHistoryAction::Pin,
        actor: UserSummary {
            id: fixed_user_id(),
            username: "owner".to_owned(),
            display_name: "站长".to_owned(),
            avatar_url: None,
        },
        reason: Some("重要公告".to_owned()),
        created_at: "2026-08-25T08:00:00Z".to_owned(),
    })
    .expect("topic moderation history must serialize");

    assert_eq!(value["id"], id.to_string());
    assert_eq!(value["source"], "governance");
    assert_eq!(value["action"], "pin");
    assert_eq!(value["actor"]["username"], "owner");
    assert_eq!(value["reason"], "重要公告");
    for private_field in ["email", "from_board_id", "to_board_id", "revision"] {
        assert!(!value.to_string().contains(private_field));
    }
}

#[test]
fn create_topic_request_deserializes_with_an_optional_board() {
    let request: CreateTopicRequest = serde_json::from_value(json!({
        "title": "发布主题",
        "content": "正文"
    }))
    .expect("topic creation request must deserialize");
    assert_eq!(request.title, "发布主题");
    assert_eq!(request.content, "正文");
    assert!(request.board_id.is_none());
}

#[test]
fn topic_reply_contract_exposes_only_public_content_and_author_fields() {
    let request: CreateReplyRequest = serde_json::from_value(json!({
        "content": "  回复正文  "
    }))
    .expect("reply request must deserialize");
    assert_eq!(request.content, "  回复正文  ");

    let reply = TopicReply {
        id: Uuid::parse_str("019fc800-0000-7000-8000-000000000201")
            .expect("fixture must be a UUID"),
        topic_id: Uuid::parse_str("019fc800-0000-7000-8000-000000000101")
            .expect("fixture must be a UUID"),
        floor_number: 3,
        reply_to: None,
        author: TopicAuthorSummary {
            id: fixed_user_id(),
            username: "member".to_owned(),
            display_name: "社区成员".to_owned(),
            avatar_url: None,
        },
        content: "回复正文".to_owned(),
        rich_content: None,
        has_locked_content: false,
        created_at: "2026-08-03T12:00:00Z".to_owned(),
        updated_at: "2026-08-03T12:00:00Z".to_owned(),
        revision_count: 1,
        like_count: 4,
        viewer_liked: None,
    };
    let value = serde_json::to_value(reply).expect("reply must serialize");

    assert_eq!(value["content"], "回复正文");
    assert_eq!(value["floor_number"], 3);
    assert!(value["reply_to"].is_null());
    assert_eq!(value["author"]["username"], "member");
    assert_eq!(value["like_count"], 4);
    assert!(value["viewer_liked"].is_null());
    for private_field in ["email", "status", "deleted_at", "editor_id"] {
        assert!(!value.to_string().contains(private_field));
    }
}

#[test]
fn admin_user_status_mutation_contract_is_stable() {
    let request: UpdateAdminUserStatusRequest = serde_json::from_value(json!({
        "status": "restricted",
        "reason": "需要完成内容复核",
        "expires_at": "2026-08-20T08:00:00Z",
        "expected_revision": 4
    }))
    .expect("admin status request must deserialize");
    assert_eq!(request.status, AdminUserStatus::Restricted);
    assert_eq!(request.reason, "需要完成内容复核");
    assert_eq!(request.expected_revision, 4);

    let value = serde_json::to_value(AdminUserStatusUpdate {
        user_id: fixed_user_id(),
        status: AdminUserStatus::Restricted,
        reason: Some("需要完成内容复核".to_owned()),
        expires_at: Some("2026-08-20T08:00:00Z".to_owned()),
        revision: 5,
        audit_id: Uuid::parse_str("019fc800-0000-7000-8000-000000000499")
            .expect("fixture must be a UUID"),
        actor: UserSummary {
            id: fixed_user_id(),
            username: "owner".to_owned(),
            display_name: "站长".to_owned(),
            avatar_url: None,
        },
        changed_at: "2026-08-12T08:00:00Z".to_owned(),
    })
    .expect("admin status result must serialize");
    assert_eq!(value["status"], "restricted");
    assert_eq!(value["revision"], 5);
    assert_eq!(value["actor"]["username"], "owner");
    for private_field in ["email", "password", "session", "token"] {
        assert!(!value.to_string().contains(private_field));
    }
}

#[test]
fn reply_update_and_revision_contracts_are_stable() {
    let request: UpdateReplyRequest = serde_json::from_value(json!({
        "base_revision": 2,
        "content": "  更新后的回复  "
    }))
    .expect("reply update request must deserialize");
    assert_eq!(request.base_revision, 2);
    assert_eq!(request.content, "  更新后的回复  ");

    let reply_id =
        Uuid::parse_str("019fc800-0000-7000-8000-000000000201").expect("fixture must be a UUID");
    let revision = ReplyRevision {
        id: Uuid::parse_str("019fc800-0000-7000-8000-000000000301")
            .expect("fixture must be a UUID"),
        reply_id,
        revision_number: 2,
        editor: TopicAuthorSummary {
            id: fixed_user_id(),
            username: "member".to_owned(),
            display_name: "社区成员".to_owned(),
            avatar_url: None,
        },
        content: "更新后的回复".to_owned(),
        rich_content: None,
        created_at: "2026-08-03T12:30:00Z".to_owned(),
    };

    assert_eq!(
        serde_json::to_value(revision).expect("reply revision must serialize"),
        json!({
            "id": "019fc800-0000-7000-8000-000000000301",
            "reply_id": reply_id,
            "revision_number": 2,
            "editor": {
                "id": fixed_user_id(),
                "username": "member",
                "display_name": "社区成员",
                "avatar_url": null
            },
            "content": "更新后的回复",
            "rich_content": null,
            "created_at": "2026-08-03T12:30:00Z"
        })
    );
    assert_eq!(error_codes::REPLY_NOT_FOUND, "reply.not_found");
    assert_eq!(
        error_codes::REPLY_REVISION_CONFLICT,
        "reply.revision_conflict"
    );
}

#[test]
fn direct_message_contracts_are_stable_and_do_not_expose_private_identity() {
    let conversation_id =
        Uuid::parse_str("019fc900-0000-7000-8000-000000000101").expect("fixture must be a UUID");
    let message_id =
        Uuid::parse_str("019fc900-0000-7000-8000-000000000201").expect("fixture must be a UUID");
    let other_user = UserSummary {
        id: fixed_user_id(),
        username: "member".to_owned(),
        display_name: "社区成员".to_owned(),
        avatar_url: None,
    };
    let summary = ConversationSummary {
        id: conversation_id,
        other_user: other_user.clone(),
        last_message: Some(ConversationLastMessage {
            id: message_id,
            sender_id: fixed_user_id(),
            content: "你好".to_owned(),
            created_at: "2026-08-04T01:00:00Z".to_owned(),
        }),
        unread_count: 2,
        updated_at: "2026-08-04T01:00:00Z".to_owned(),
    };
    let message = DirectMessage {
        id: message_id,
        conversation_id,
        sender: other_user,
        content: "你好".to_owned(),
        created_at: "2026-08-04T01:00:00Z".to_owned(),
    };

    let summary_value = serde_json::to_value(summary).expect("conversation must serialize");
    let message_value = serde_json::to_value(message).expect("message must serialize");
    assert_eq!(summary_value["unread_count"], 2);
    assert_eq!(
        summary_value["last_message"]["sender_id"],
        fixed_user_id().to_string()
    );
    assert_eq!(message_value["sender"]["username"], "member");
    for private_field in ["email", "status", "password_hash", "csrf_token"] {
        assert!(!summary_value.to_string().contains(private_field));
        assert!(!message_value.to_string().contains(private_field));
    }
}

#[test]
fn direct_message_requests_and_read_state_use_explicit_resource_ids() {
    let recipient_id = fixed_user_id();
    let message_id =
        Uuid::parse_str("019fc900-0000-7000-8000-000000000201").expect("fixture must be a UUID");
    let conversation_id =
        Uuid::parse_str("019fc900-0000-7000-8000-000000000101").expect("fixture must be a UUID");
    let create: CreateConversationRequest = serde_json::from_value(json!({
        "recipient_id": recipient_id
    }))
    .expect("create conversation request must deserialize");
    let send: SendDirectMessageRequest = serde_json::from_value(json!({
        "content": "  你好  "
    }))
    .expect("send message request must deserialize");
    let read: MarkConversationReadRequest = serde_json::from_value(json!({
        "last_read_message_id": message_id
    }))
    .expect("read request must deserialize");

    assert_eq!(create.recipient_id, recipient_id);
    assert_eq!(send.content, "  你好  ");
    assert_eq!(read.last_read_message_id, message_id);
    assert_eq!(
        serde_json::to_value(ConversationReadState {
            conversation_id,
            last_read_message_id: message_id,
            unread_count: 0,
        })
        .expect("read state must serialize"),
        json!({
            "conversation_id": conversation_id,
            "last_read_message_id": message_id,
            "unread_count": 0
        })
    );
    assert_eq!(
        error_codes::CONVERSATION_NOT_FOUND,
        "conversation.not_found"
    );
    assert_eq!(error_codes::MESSAGE_RATE_LIMITED, "message.rate_limited");
}

fn fixed_request_id() -> RequestId {
    RequestId::from(
        Uuid::parse_str("019fc59d-f66c-7501-9e2a-3670d0904ea6").expect("fixture must be a UUID"),
    )
}

fn fixed_user_id() -> Uuid {
    Uuid::parse_str("019fc700-0000-7000-8000-000000000002").expect("fixture must be a UUID")
}

fn fixed_uuid(value: u128) -> Uuid {
    Uuid::from_u128(value)
}
