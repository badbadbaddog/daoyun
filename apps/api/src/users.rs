use crate::auth::{
    ApiError, AuthRuntime, authenticate_optional_session, authenticate_session,
    authenticate_state_change,
};
use api_contract::{
    ApiResponse, BlockState, ErrorBody, ErrorCode, ErrorResponse, FieldErrors, FollowState,
    MembershipAccount, MembershipMedal, PageResponse, RequestId, UpdateUserProfileRequest,
    UserProfile, UserProfileViewer, UserSummary, error_codes,
};
use axum::{
    Extension, Json, Router,
    extract::{
        DefaultBodyLimit, Path, Query, State, rejection::JsonRejection, rejection::PathRejection,
        rejection::QueryRejection,
    },
    http::{HeaderMap, HeaderValue, StatusCode, header},
    routing::{get, patch, put},
};
use infrastructure::{
    BlockMutationError, BlockStateRecord, Database, FollowMutationError, FollowStateRecord,
    ListUserRelationsError, MembershipAccountRecord, PublicUserProfileRecord,
    PublicUserSummaryRecord, UpdateUserProfileError, UpdateUserProfileRecord, UserRelationKind,
};
use serde::Deserialize;
use time::{OffsetDateTime, UtcOffset, format_description::well_known::Rfc3339};
use utoipa::IntoParams;
use uuid::Uuid;

const PROFILE_BODY_LIMIT: usize = 16 * 1024;
const DEFAULT_RELATION_LIMIT: u16 = 20;
const MAX_RELATION_LIMIT: u16 = 50;

#[derive(Debug, Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub(crate) struct ListUserRelationsQuery {
    cursor: Option<Uuid>,
    limit: Option<u16>,
}

struct ValidatedProfileUpdate {
    base_revision: i32,
    display_name: String,
    bio: String,
    location: Option<String>,
    website_url: Option<String>,
    avatar_url: Option<String>,
}

pub(crate) fn router(runtime: AuthRuntime) -> Router<Database> {
    Router::new()
        .route("/api/v1/users/{username}", get(profile))
        .route("/api/v1/users/{username}/followers", get(followers))
        .route("/api/v1/users/{username}/following", get(following))
        .route("/api/v1/users/{username}/medals", get(user_medals))
        .route(
            "/api/v1/users/me",
            patch(update_profile).layer(DefaultBodyLimit::max(PROFILE_BODY_LIMIT)),
        )
        .route("/api/v1/users/me/membership", get(membership))
        // Source: https://docs.rs/axum/0.8.9/axum/routing/method_routing/struct.MethodRouter.html#method.delete
        .route(
            "/api/v1/users/{user_id}/follow",
            put(follow_user).delete(unfollow_user),
        )
        .route(
            "/api/v1/users/{user_id}/block",
            put(block_user).delete(unblock_user),
        )
        .layer(Extension(runtime))
}

#[utoipa::path(
    get,
    path = "/api/v1/users/{username}/followers",
    operation_id = "listUserFollowers",
    tag = "users",
    params(
        ("username" = String, Path, description = "Stable username"),
        ListUserRelationsQuery
    ),
    responses(
        (status = 200, description = "Active followers of the public user", body = PageResponse<UserSummary>, headers(("x-request-id" = String))),
        (status = 400, description = "The username path is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, description = "The profile is unavailable", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, description = "The pagination query is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, description = "The relationship database is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn followers(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    path: Result<Path<String>, PathRejection>,
    query: Result<Query<ListUserRelationsQuery>, QueryRejection>,
) -> Result<Json<PageResponse<UserSummary>>, ApiError> {
    list_relations(
        database,
        request_id,
        path,
        query,
        UserRelationKind::Followers,
    )
    .await
}

#[utoipa::path(
    get,
    path = "/api/v1/users/{username}/following",
    operation_id = "listUserFollowing",
    tag = "users",
    params(
        ("username" = String, Path, description = "Stable username"),
        ListUserRelationsQuery
    ),
    responses(
        (status = 200, description = "Active users followed by the public user", body = PageResponse<UserSummary>, headers(("x-request-id" = String))),
        (status = 400, description = "The username path is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, description = "The profile is unavailable", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, description = "The pagination query is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, description = "The relationship database is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn following(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    path: Result<Path<String>, PathRejection>,
    query: Result<Query<ListUserRelationsQuery>, QueryRejection>,
) -> Result<Json<PageResponse<UserSummary>>, ApiError> {
    list_relations(
        database,
        request_id,
        path,
        query,
        UserRelationKind::Following,
    )
    .await
}

#[utoipa::path(
    get,
    path = "/api/v1/users/me/membership",
    operation_id = "getCurrentMembership",
    tag = "users",
    responses(
        (status = 200, description = "The current user's membership account", body = ApiResponse<MembershipAccount>, headers(("x-request-id" = String))),
        (status = 401, description = "The request has no active session", body = ErrorResponse, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 503, description = "The membership database is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn membership(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
) -> Result<(HeaderMap, Json<ApiResponse<MembershipAccount>>), ApiError> {
    let (session, _) = authenticate_session(&database, &runtime, &headers, request_id).await?;
    let record = database
        .get_membership_account(session.user.id)
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "Membership account query failed");
            membership_service_unavailable(request_id)
        })?
        .ok_or_else(|| membership_service_unavailable(request_id))?;
    let account =
        membership_account(record).map_err(|()| membership_service_unavailable(request_id))?;
    let mut headers = HeaderMap::new();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok((headers, Json(ApiResponse::new(account, request_id))))
}

#[utoipa::path(
    get,
    path = "/api/v1/users/{username}/medals",
    operation_id = "listUserMembershipMedals",
    tag = "users",
    params(("username" = String, Path, description = "Stable username")),
    responses(
        (status = 200, body = ApiResponse<Vec<MembershipMedal>>, headers(("x-request-id" = String))),
        (status = 400, body = ErrorResponse), (status = 404, body = ErrorResponse), (status = 503, body = ErrorResponse)
    )
)]
pub(crate) async fn user_medals(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    path: Result<Path<String>, PathRejection>,
) -> Result<Json<ApiResponse<Vec<MembershipMedal>>>, ApiError> {
    let Path(username) = path.map_err(|_| username_path_invalid(request_id))?;
    if !valid_username(&username) {
        return Err(username_path_invalid(request_id));
    }
    let user_id = database
        .user_id_by_username(&username)
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "User medal owner lookup failed");
            membership_service_unavailable(request_id)
        })?
        .ok_or_else(|| user_not_found(request_id))?;
    let medals = database
        .list_membership_medals(user_id)
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "User medals query failed");
            membership_service_unavailable(request_id)
        })?
        .into_iter()
        .map(map_membership_medal)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|()| membership_service_unavailable(request_id))?;
    Ok(Json(ApiResponse::new(medals, request_id)))
}

#[utoipa::path(
    get,
    path = "/api/v1/users/{username}",
    operation_id = "getUserProfile",
    tag = "users",
    params(("username" = String, Path, description = "Stable username")),
    responses(
        (status = 200, description = "The public user profile", body = ApiResponse<UserProfile>, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 400, description = "The username path is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, description = "The profile is unavailable", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, description = "The profile database is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn profile(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<String>, PathRejection>,
) -> Result<(HeaderMap, Json<ApiResponse<UserProfile>>), ApiError> {
    let Path(username) = path.map_err(|_| username_path_invalid(request_id))?;
    if !valid_username(&username) {
        return Err(username_path_invalid(request_id));
    }
    let (session, response_headers) =
        authenticate_optional_session(&database, &runtime, &headers, request_id).await?;
    let viewer_id = session.map(|session| session.user.id);
    let record = database
        .public_user_profile(&username, viewer_id)
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "Public user profile query failed");
            service_unavailable(request_id)
        })?
        .ok_or_else(|| user_not_found(request_id))?;
    let profile = user_profile(record).map_err(|()| service_unavailable(request_id))?;
    Ok((
        response_headers,
        Json(ApiResponse::new(profile, request_id)),
    ))
}

#[utoipa::path(
    patch,
    path = "/api/v1/users/me",
    operation_id = "updateCurrentUserProfile",
    tag = "users",
    params(("x-csrf-token" = String, Header, description = "Session-bound CSRF token")),
    request_body = UpdateUserProfileRequest,
    responses(
        (status = 200, description = "The updated public profile", body = ApiResponse<UserProfile>, headers(("x-request-id" = String))),
        (status = 401, description = "The request has no active session", body = ErrorResponse, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 403, description = "The CSRF token is missing or invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 409, description = "The profile revision is stale", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, description = "The profile update is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, description = "The profile database is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn update_profile(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    request: Result<Json<UpdateUserProfileRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<UserProfile>>, ApiError> {
    let Json(request) = request.map_err(|_| malformed_profile_body(request_id))?;
    let input = validate_profile_update(request)
        .map_err(|fields| profile_validation_error(request_id, fields))?;
    let session = authenticate_state_change(&database, &runtime, &headers, request_id).await?;
    database
        .update_user_profile(UpdateUserProfileRecord {
            user_id: session.user.id,
            base_revision: input.base_revision,
            display_name: input.display_name,
            bio: input.bio,
            location: input.location,
            website_url: input.website_url,
            avatar_url: input.avatar_url,
        })
        .await
        .map_err(|error| match error {
            UpdateUserProfileError::ProfileUnavailable => user_not_found(request_id),
            UpdateUserProfileError::RevisionConflict => profile_revision_conflict(request_id),
            UpdateUserProfileError::Database(error) => {
                tracing::warn!(request_id = %request_id, error = %error, "User profile update failed");
                service_unavailable(request_id)
            }
        })?;
    let record = database
        .public_user_profile(&session.user.username, Some(session.user.id))
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "Updated user profile query failed");
            service_unavailable(request_id)
        })?
        .ok_or_else(|| service_unavailable(request_id))?;
    let profile = user_profile(record).map_err(|()| service_unavailable(request_id))?;
    Ok(Json(ApiResponse::new(profile, request_id)))
}

#[utoipa::path(
    put,
    path = "/api/v1/users/{user_id}/follow",
    operation_id = "followUser",
    tag = "users",
    params(
        ("user_id" = Uuid, Path, description = "Target user identifier"),
        ("x-csrf-token" = String, Header, description = "Session-bound CSRF token")
    ),
    responses(
        (status = 200, description = "The current follow state", body = ApiResponse<FollowState>, headers(("x-request-id" = String))),
        (status = 400, description = "The user path is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 401, description = "The request has no active session", body = ErrorResponse, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 403, description = "The CSRF token is missing or invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, description = "The target user is unavailable", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, description = "The relationship is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, description = "The relationship database is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn follow_user(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<Json<ApiResponse<FollowState>>, ApiError> {
    set_following(database, runtime, request_id, headers, path, true).await
}

#[utoipa::path(
    delete,
    path = "/api/v1/users/{user_id}/follow",
    operation_id = "unfollowUser",
    tag = "users",
    params(
        ("user_id" = Uuid, Path, description = "Target user identifier"),
        ("x-csrf-token" = String, Header, description = "Session-bound CSRF token")
    ),
    responses(
        (status = 200, description = "The current follow state", body = ApiResponse<FollowState>, headers(("x-request-id" = String))),
        (status = 400, description = "The user path is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 401, description = "The request has no active session", body = ErrorResponse, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 403, description = "The CSRF token is missing or invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, description = "The target user is unavailable", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, description = "The relationship is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, description = "The relationship database is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn unfollow_user(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<Json<ApiResponse<FollowState>>, ApiError> {
    set_following(database, runtime, request_id, headers, path, false).await
}

#[utoipa::path(
    put,
    path = "/api/v1/users/{user_id}/block",
    operation_id = "blockUser",
    tag = "users",
    params(
        ("user_id" = Uuid, Path, description = "Target user identifier"),
        ("x-csrf-token" = String, Header, description = "Session-bound CSRF token")
    ),
    responses(
        (status = 200, description = "The current block state", body = ApiResponse<BlockState>, headers(("x-request-id" = String))),
        (status = 400, description = "The user path is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 401, description = "The request has no active session", body = ErrorResponse, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 403, description = "The CSRF token is missing or invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, description = "The target user is unavailable", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, description = "The relationship is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, description = "The relationship database is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn block_user(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<Json<ApiResponse<BlockState>>, ApiError> {
    set_blocked(database, runtime, request_id, headers, path, true).await
}

#[utoipa::path(
    delete,
    path = "/api/v1/users/{user_id}/block",
    operation_id = "unblockUser",
    tag = "users",
    params(
        ("user_id" = Uuid, Path, description = "Target user identifier"),
        ("x-csrf-token" = String, Header, description = "Session-bound CSRF token")
    ),
    responses(
        (status = 200, description = "The current block state", body = ApiResponse<BlockState>, headers(("x-request-id" = String))),
        (status = 400, description = "The user path is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 401, description = "The request has no active session", body = ErrorResponse, headers(("x-request-id" = String), ("set-cookie" = String))),
        (status = 403, description = "The CSRF token is missing or invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 404, description = "The target user is unavailable", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 422, description = "The relationship is invalid", body = ErrorResponse, headers(("x-request-id" = String))),
        (status = 503, description = "The relationship database is unavailable", body = ErrorResponse, headers(("x-request-id" = String)))
    )
)]
pub(crate) async fn unblock_user(
    State(database): State<Database>,
    Extension(request_id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<Json<ApiResponse<BlockState>>, ApiError> {
    set_blocked(database, runtime, request_id, headers, path, false).await
}

async fn set_following(
    database: Database,
    runtime: AuthRuntime,
    request_id: RequestId,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
    following: bool,
) -> Result<Json<ApiResponse<FollowState>>, ApiError> {
    let Path(user_id) = path.map_err(|_| user_id_path_invalid(request_id))?;
    let session = authenticate_state_change(&database, &runtime, &headers, request_id).await?;
    let record = database
        .set_user_following(session.user.id, user_id, following)
        .await
        .map_err(|error| match error {
            FollowMutationError::SelfFollow => self_follow_not_allowed(request_id),
            FollowMutationError::TargetUnavailable => user_not_found(request_id),
            FollowMutationError::Database(error) => {
                tracing::warn!(request_id = %request_id, error = %error, "Follow mutation failed");
                service_unavailable(request_id)
            }
        })?;
    let state = follow_state(record).map_err(|()| service_unavailable(request_id))?;
    Ok(Json(ApiResponse::new(state, request_id)))
}

async fn list_relations(
    database: Database,
    request_id: RequestId,
    path: Result<Path<String>, PathRejection>,
    query: Result<Query<ListUserRelationsQuery>, QueryRejection>,
    kind: UserRelationKind,
) -> Result<Json<PageResponse<UserSummary>>, ApiError> {
    let Path(username) = path.map_err(|_| username_path_invalid(request_id))?;
    if !valid_username(&username) {
        return Err(username_path_invalid(request_id));
    }
    let Query(query) = query
        .map_err(|_| relation_validation_error(request_id, "query", "关系分页参数格式不正确"))?;
    let limit = query.limit.unwrap_or(DEFAULT_RELATION_LIMIT);
    if !(1..=MAX_RELATION_LIMIT).contains(&limit) {
        return Err(relation_validation_error(
            request_id,
            "limit",
            "limit 必须介于 1 和 50 之间",
        ));
    }
    let mut records = database
        .list_user_relations(&username, kind, query.cursor, i64::from(limit) + 1)
        .await
        .map_err(|error| match error {
            ListUserRelationsError::InvalidCursor => relation_validation_error(
                request_id,
                "cursor",
                "cursor 不属于当前关系结果集",
            ),
            ListUserRelationsError::Database(error) => {
                tracing::warn!(request_id = %request_id, error = %error, "User relation list query failed");
                service_unavailable(request_id)
            }
        })?
        .ok_or_else(|| user_not_found(request_id))?;
    let has_next_page = records.len() > usize::from(limit);
    records.truncate(usize::from(limit));
    let next_cursor = has_next_page.then(|| {
        records
            .last()
            .expect("a full relation page is non-empty")
            .id
            .to_string()
    });
    let users = records.into_iter().map(user_summary).collect();
    Ok(Json(PageResponse::new(users, request_id, next_cursor)))
}

async fn set_blocked(
    database: Database,
    runtime: AuthRuntime,
    request_id: RequestId,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
    blocked: bool,
) -> Result<Json<ApiResponse<BlockState>>, ApiError> {
    let Path(user_id) = path.map_err(|_| user_id_path_invalid(request_id))?;
    let session = authenticate_state_change(&database, &runtime, &headers, request_id).await?;
    let record = database
        .set_user_blocked(session.user.id, user_id, blocked)
        .await
        .map_err(|error| match error {
            BlockMutationError::SelfBlock => self_block_not_allowed(request_id),
            BlockMutationError::TargetUnavailable => user_not_found(request_id),
            BlockMutationError::Database(error) => {
                tracing::warn!(request_id = %request_id, error = %error, "Block mutation failed");
                service_unavailable(request_id)
            }
        })?;
    Ok(Json(ApiResponse::new(block_state(record), request_id)))
}

fn validate_profile_update(
    request: UpdateUserProfileRequest,
) -> Result<ValidatedProfileUpdate, FieldErrors> {
    let mut fields = FieldErrors::new();
    let base_revision = i32::try_from(request.base_revision).unwrap_or(0);
    if base_revision < 1 {
        add_field_error(&mut fields, "base_revision", "base_revision 必须为正整数");
    }

    let display_name = request.display_name.trim();
    if !(1..=80).contains(&display_name.chars().count())
        || display_name.chars().any(char::is_control)
    {
        add_field_error(&mut fields, "display_name", "显示名称需为 1-80 个有效字符");
    }
    let bio = request.bio.trim();
    if bio.chars().count() > 500 || bio.chars().any(disallowed_text_control) {
        add_field_error(&mut fields, "bio", "简介最多为 500 个有效字符");
    }
    let location = normalize_optional_text(request.location, 100, "location", &mut fields);
    let website_url = normalize_optional_url(
        request.website_url,
        &["http://", "https://"],
        "website_url",
        "个人网站必须是最长 2,048 个字符的 HTTP 或 HTTPS URL",
        &mut fields,
    );
    let avatar_url = normalize_optional_url(
        request.avatar_url,
        &["https://"],
        "avatar_url",
        "头像必须是最长 2,048 个字符的 HTTPS URL",
        &mut fields,
    );
    if !fields.is_empty() {
        return Err(fields);
    }
    Ok(ValidatedProfileUpdate {
        base_revision,
        display_name: display_name.to_owned(),
        bio: bio.to_owned(),
        location,
        website_url,
        avatar_url,
    })
}

fn normalize_optional_text(
    value: Option<String>,
    maximum: usize,
    field: &'static str,
    fields: &mut FieldErrors,
) -> Option<String> {
    let value = value?;
    let value = value.trim();
    if value.is_empty() || value.chars().count() > maximum || value.chars().any(char::is_control) {
        add_field_error(fields, field, "所在地需为 1-100 个有效字符或 null");
        return None;
    }
    Some(value.to_owned())
}

fn normalize_optional_url(
    value: Option<String>,
    schemes: &[&str],
    field: &'static str,
    message: &'static str,
    fields: &mut FieldErrors,
) -> Option<String> {
    let value = value?;
    let value = value.trim();
    let scheme = schemes.iter().find(|scheme| value.starts_with(**scheme));
    let valid = scheme.is_some_and(|scheme| {
        let authority = value[scheme.len()..]
            .split(['/', '?', '#'])
            .next()
            .unwrap_or_default();
        !authority.is_empty()
            && value.chars().count() <= 2_048
            && !value
                .chars()
                .any(|character| character.is_whitespace() || character.is_control())
    });
    if !valid {
        add_field_error(fields, field, message);
        return None;
    }
    Some(value.to_owned())
}

fn valid_username(value: &str) -> bool {
    let mut characters = value.chars();
    let Some(first) = characters.next() else {
        return false;
    };
    value.len() <= 32
        && value.len() >= 3
        && first.is_ascii_lowercase()
        && characters.all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '_'
        })
}

fn disallowed_text_control(character: char) -> bool {
    character.is_control() && !matches!(character, '\n' | '\r' | '\t')
}

fn user_profile(record: PublicUserProfileRecord) -> Result<UserProfile, ()> {
    Ok(UserProfile {
        user: UserSummary {
            id: record.id,
            username: record.username,
            display_name: record.display_name,
            avatar_url: record.avatar_url,
        },
        bio: record.bio,
        location: record.location,
        website_url: record.website_url,
        profile_revision: u32::try_from(record.profile_revision).map_err(|_| ())?,
        created_at: format_timestamp(record.created_at)?,
        topic_count: u64::try_from(record.topic_count).map_err(|_| ())?,
        follower_count: u64::try_from(record.follower_count).map_err(|_| ())?,
        following_count: u64::try_from(record.following_count).map_err(|_| ())?,
        viewer: record.viewer.map(|viewer| UserProfileViewer {
            is_self: viewer.is_self,
            is_following: viewer.is_following,
            is_blocked_by_viewer: viewer.is_blocked_by_viewer,
            can_message: viewer.can_message,
        }),
    })
}

fn follow_state(record: FollowStateRecord) -> Result<FollowState, ()> {
    Ok(FollowState {
        user_id: record.user_id,
        following: record.following,
        follower_count: u64::try_from(record.follower_count).map_err(|_| ())?,
        following_count: u64::try_from(record.following_count).map_err(|_| ())?,
    })
}

fn block_state(record: BlockStateRecord) -> BlockState {
    BlockState {
        user_id: record.user_id,
        blocked: record.blocked,
    }
}

fn user_summary(record: PublicUserSummaryRecord) -> UserSummary {
    UserSummary {
        id: record.id,
        username: record.username,
        display_name: record.display_name,
        avatar_url: record.avatar_url,
    }
}

fn membership_account(record: MembershipAccountRecord) -> Result<MembershipAccount, ()> {
    if !valid_membership_level_key(&record.level_key)
        || record.level_number != membership_level_number(&record.level_key)
        || record.level_display_name.is_empty()
    {
        return Err(());
    }
    Ok(MembershipAccount {
        user_id: record.user_id,
        points_balance: record.points_balance,
        lifetime_points: record.lifetime_points,
        level_key: record.level_key,
        level_number: record.level_number,
        level_display_name: record.level_display_name,
        revision: record.revision,
        updated_at: format_timestamp(record.updated_at)?,
    })
}

fn valid_membership_level_key(value: &str) -> bool {
    membership_level_number(value) > 0
}

fn membership_level_number(value: &str) -> i16 {
    value
        .strip_prefix("lv_")
        .and_then(|number| number.parse::<i16>().ok())
        .filter(|number| (1..=20).contains(number))
        .unwrap_or_default()
}

fn map_membership_medal(
    record: infrastructure::MembershipMedalRecord,
) -> Result<MembershipMedal, ()> {
    let (filename, sha256) = crate::membership::medal_asset_metadata(&record.medal_key).ok_or(())?;
    Ok(MembershipMedal {
        key: record.medal_key.clone(),
        display_name: format!(
            "勋章 {}",
            record.medal_key.strip_prefix("medal_").ok_or(())?
        ),
        asset_url: format!("/assets/membership/medals/{filename}"),
        sha256: sha256.to_owned(),
        granted_at: format_timestamp(record.granted_at)?,
    })
}

fn format_timestamp(value: OffsetDateTime) -> Result<String, ()> {
    value
        .to_offset(UtcOffset::UTC)
        .format(&Rfc3339)
        .map_err(|_| ())
}

fn add_field_error(fields: &mut FieldErrors, field: &'static str, message: &'static str) {
    fields
        .entry(field.to_owned())
        .or_default()
        .push(message.to_owned());
}

fn malformed_profile_body(request_id: RequestId) -> ApiError {
    profile_validation_error(
        request_id,
        FieldErrors::from([(
            "body".to_owned(),
            vec!["请求体必须是小于 16 KiB 的合法 JSON".to_owned()],
        )]),
    )
}

fn profile_validation_error(request_id: RequestId, fields: FieldErrors) -> ApiError {
    let mut body = ErrorBody::new(
        ErrorCode::from_static(error_codes::VALIDATION_FAILED),
        "请求参数校验失败",
    );
    body.fields = fields;
    error(StatusCode::UNPROCESSABLE_ENTITY, body, request_id)
}

fn relation_validation_error(
    request_id: RequestId,
    field: &'static str,
    message: &'static str,
) -> ApiError {
    error(
        StatusCode::UNPROCESSABLE_ENTITY,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::VALIDATION_FAILED),
            "请求参数校验失败",
        )
        .with_field(field, message),
        request_id,
    )
}

fn username_path_invalid(request_id: RequestId) -> ApiError {
    error(
        StatusCode::BAD_REQUEST,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::PATH_INVALID),
            "用户路径参数格式不正确",
        )
        .with_field("username", "username 必须是有效用户名"),
        request_id,
    )
}

fn user_id_path_invalid(request_id: RequestId) -> ApiError {
    error(
        StatusCode::BAD_REQUEST,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::PATH_INVALID),
            "用户路径参数格式不正确",
        )
        .with_field("user_id", "user_id 必须是 UUID"),
        request_id,
    )
}

fn user_not_found(request_id: RequestId) -> ApiError {
    error(
        StatusCode::NOT_FOUND,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::USER_NOT_FOUND),
            "用户不存在或不可访问",
        ),
        request_id,
    )
}

fn profile_revision_conflict(request_id: RequestId) -> ApiError {
    error(
        StatusCode::CONFLICT,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::PROFILE_REVISION_CONFLICT),
            "用户资料已经被其他请求更新，请刷新后重试",
        ),
        request_id,
    )
}

fn self_follow_not_allowed(request_id: RequestId) -> ApiError {
    error(
        StatusCode::UNPROCESSABLE_ENTITY,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::RELATIONSHIP_SELF_FOLLOW_NOT_ALLOWED),
            "不能关注自己",
        ),
        request_id,
    )
}

fn self_block_not_allowed(request_id: RequestId) -> ApiError {
    error(
        StatusCode::UNPROCESSABLE_ENTITY,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::RELATIONSHIP_SELF_BLOCK_NOT_ALLOWED),
            "不能屏蔽自己",
        ),
        request_id,
    )
}

fn service_unavailable(request_id: RequestId) -> ApiError {
    error(
        StatusCode::SERVICE_UNAVAILABLE,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::DATABASE_UNAVAILABLE),
            "用户资料服务暂时不可用",
        ),
        request_id,
    )
}

fn membership_service_unavailable(request_id: RequestId) -> ApiError {
    error(
        StatusCode::SERVICE_UNAVAILABLE,
        ErrorBody::new(
            ErrorCode::from_static(error_codes::DATABASE_UNAVAILABLE),
            "会员服务暂时不可用",
        ),
        request_id,
    )
}

fn error(status: StatusCode, body: ErrorBody, request_id: RequestId) -> ApiError {
    (
        status,
        HeaderMap::new(),
        Json(ErrorResponse::new(body, request_id)),
    )
}
