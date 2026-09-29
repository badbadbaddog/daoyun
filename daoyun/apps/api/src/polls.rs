use crate::auth::{
    ApiError, AuthRuntime, authenticate_optional_session, authenticate_state_change,
};
use api_contract::{
    ApiResponse, ErrorBody, ErrorCode, ErrorResponse, PollInput, PollOption, PollPolicy, RequestId,
    TopicPoll, UpdatePollRequest, VotePollRequest,
};
use axum::{
    Extension, Json, Router,
    extract::{
        DefaultBodyLimit, Path, State,
        rejection::{JsonRejection, PathRejection},
    },
    http::{
        HeaderMap, HeaderValue, StatusCode,
        header::{CACHE_CONTROL, VARY},
    },
    routing::{get, post},
};
use infrastructure::{Database, NewPollRecord, PollError, PollRecord};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use uuid::Uuid;
type Reply<T> = Result<(HeaderMap, Json<ApiResponse<T>>), ApiError>;
pub(crate) fn router(runtime: AuthRuntime) -> Router<Database> {
    Router::new()
        .route("/api/v1/polls/policy", get(policy))
        .route("/api/v1/topics/{topic_id}/poll", get(detail).put(update))
        .route("/api/v1/topics/{topic_id}/poll/votes", post(vote))
        .layer(DefaultBodyLimit::max(16 * 1024))
        .layer(Extension(runtime))
}
#[utoipa::path(get,path="/api/v1/polls/policy",operation_id="getPollPolicy",tag="polls",responses((status=200,body=ApiResponse<PollPolicy>,headers(("x-request-id"=String))),(status=401,body=ErrorResponse,headers(("x-request-id"=String))),(status=403,body=ErrorResponse,headers(("x-request-id"=String))),(status=404,body=ErrorResponse,headers(("x-request-id"=String))),(status=409,body=ErrorResponse,headers(("x-request-id"=String))),(status=413,body=ErrorResponse,headers(("x-request-id"=String))),(status=422,body=ErrorResponse,headers(("x-request-id"=String))),(status=503,body=ErrorResponse,headers(("x-request-id"=String)))))]
pub(crate) async fn policy(
    State(db): State<Database>,
    Extension(id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
) -> Reply<PollPolicy> {
    let (session, _) = authenticate_optional_session(&db, &runtime, &headers, id).await?;
    let (enabled, can_create) = db
        .poll_policy(session.map(|s| s.user.id))
        .await
        .map_err(|e| error(e, id))?;
    reply(
        PollPolicy {
            enabled,
            can_create,
        },
        id,
    )
}
#[utoipa::path(get,path="/api/v1/topics/{topic_id}/poll",operation_id="getTopicPoll",tag="polls",params(("topic_id"=Uuid,Path)),responses((status=200,body=ApiResponse<Option<TopicPoll>>,headers(("x-request-id"=String))),(status=401,body=ErrorResponse,headers(("x-request-id"=String))),(status=403,body=ErrorResponse,headers(("x-request-id"=String))),(status=404,body=ErrorResponse,headers(("x-request-id"=String))),(status=409,body=ErrorResponse,headers(("x-request-id"=String))),(status=413,body=ErrorResponse,headers(("x-request-id"=String))),(status=422,body=ErrorResponse,headers(("x-request-id"=String))),(status=503,body=ErrorResponse,headers(("x-request-id"=String)))))]
// Keep the shared API error envelope in DTO conversion closures.
#[allow(clippy::result_large_err)]
pub(crate) async fn detail(
    State(db): State<Database>,
    Extension(id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
) -> Reply<Option<TopicPoll>> {
    let (session, _) = authenticate_optional_session(&db, &runtime, &headers, id).await?;
    let Path(topic) = path.map_err(|_| error(PollError::InvalidInput, id))?;
    let record = db
        .topic_poll(topic, session.map(|s| s.user.id))
        .await
        .map_err(|e| error(e, id))?;
    reply(record.map(|r| map(r, id)).transpose()?, id)
}
#[utoipa::path(post,path="/api/v1/topics/{topic_id}/poll/votes",operation_id="voteTopicPoll",tag="polls",params(("topic_id"=Uuid,Path),("x-csrf-token"=String,Header)),request_body=VotePollRequest,responses((status=200,body=ApiResponse<Option<TopicPoll>>,headers(("x-request-id"=String))),(status=401,body=ErrorResponse,headers(("x-request-id"=String))),(status=403,body=ErrorResponse,headers(("x-request-id"=String))),(status=404,body=ErrorResponse,headers(("x-request-id"=String))),(status=409,body=ErrorResponse,headers(("x-request-id"=String))),(status=413,body=ErrorResponse,headers(("x-request-id"=String))),(status=422,body=ErrorResponse,headers(("x-request-id"=String))),(status=503,body=ErrorResponse,headers(("x-request-id"=String)))))]
// Keep the shared API error envelope in DTO conversion closures.
#[allow(clippy::result_large_err)]
pub(crate) async fn vote(
    State(db): State<Database>,
    Extension(id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
    body: Result<Json<VotePollRequest>, JsonRejection>,
) -> Reply<Option<TopicPoll>> {
    let session = authenticate_state_change(&db, &runtime, &headers, id).await?;
    let Path(topic) = path.map_err(|_| error(PollError::InvalidInput, id))?;
    let input = body_value(body, id)?;
    db.vote_poll(session.user.id, topic, input.option_id)
        .await
        .map_err(|e| error(e, id))?;
    reply(
        db.topic_poll(topic, Some(session.user.id))
            .await
            .map_err(|e| error(e, id))?
            .map(|r| map(r, id))
            .transpose()?,
        id,
    )
}
#[utoipa::path(put,path="/api/v1/topics/{topic_id}/poll",operation_id="updateTopicPoll",tag="polls",params(("topic_id"=Uuid,Path),("x-csrf-token"=String,Header)),request_body=UpdatePollRequest,responses((status=200,body=ApiResponse<Option<TopicPoll>>,headers(("x-request-id"=String))),(status=401,body=ErrorResponse,headers(("x-request-id"=String))),(status=403,body=ErrorResponse,headers(("x-request-id"=String))),(status=404,body=ErrorResponse,headers(("x-request-id"=String))),(status=409,body=ErrorResponse,headers(("x-request-id"=String))),(status=413,body=ErrorResponse,headers(("x-request-id"=String))),(status=422,body=ErrorResponse,headers(("x-request-id"=String))),(status=503,body=ErrorResponse,headers(("x-request-id"=String)))))]
// Keep the shared API error envelope in DTO conversion closures.
#[allow(clippy::result_large_err)]
pub(crate) async fn update(
    State(db): State<Database>,
    Extension(id): Extension<RequestId>,
    Extension(runtime): Extension<AuthRuntime>,
    headers: HeaderMap,
    path: Result<Path<Uuid>, PathRejection>,
    body: Result<Json<UpdatePollRequest>, JsonRejection>,
) -> Reply<Option<TopicPoll>> {
    let session = authenticate_state_change(&db, &runtime, &headers, id).await?;
    let Path(topic) = path.map_err(|_| error(PollError::InvalidInput, id))?;
    let input = body_value(body, id)?;
    db.update_poll(
        session.user.id,
        topic,
        input.expected_revision,
        parse(input.poll).map_err(|e| error(e, id))?,
    )
    .await
    .map_err(|e| error(e, id))?;
    reply(
        db.topic_poll(topic, Some(session.user.id))
            .await
            .map_err(|e| error(e, id))?
            .map(|r| map(r, id))
            .transpose()?,
        id,
    )
}
pub(crate) fn parse(input: PollInput) -> Result<NewPollRecord, PollError> {
    Ok(NewPollRecord {
        question: input.question,
        options: input.options,
        ends_at: OffsetDateTime::parse(&input.ends_at, &Rfc3339)
            .map_err(|_| PollError::InvalidInput)?,
    })
}
#[allow(clippy::result_large_err)]
fn body_value<T>(body: Result<Json<T>, JsonRejection>, id: RequestId) -> Result<T, ApiError> {
    body.map(|Json(v)| v).map_err(|e| {
        if e.status() == StatusCode::PAYLOAD_TOO_LARGE {
            api_error(
                StatusCode::PAYLOAD_TOO_LARGE,
                "request.body_too_large",
                "投票请求过大",
                id,
            )
        } else {
            error(PollError::InvalidInput, id)
        }
    })
}
#[allow(clippy::result_large_err)]
fn map(r: PollRecord, id: RequestId) -> Result<TopicPoll, ApiError> {
    Ok(TopicPoll {
        topic_id: r.topic_id,
        question: r.question,
        ends_at: r.ends_at.format(&Rfc3339).map_err(|_| unavailable(id))?,
        revision: r.revision,
        enabled: r.enabled,
        closed: r.closed,
        can_vote: r.can_vote,
        can_edit: r.can_edit,
        selected_option: r.selected_option,
        total_votes: r.total_votes,
        options: r
            .options
            .into_iter()
            .map(|o| PollOption {
                id: o.id,
                label: o.label,
                votes: o.votes,
            })
            .collect(),
    })
}
#[allow(clippy::result_large_err)]
fn reply<T>(data: T, id: RequestId) -> Reply<T> {
    Ok((private_headers(), Json(ApiResponse::new(data, id))))
}
fn private_headers() -> HeaderMap {
    let mut h = HeaderMap::new();
    h.insert(CACHE_CONTROL, HeaderValue::from_static("private, no-store"));
    h.insert(VARY, HeaderValue::from_static("Cookie"));
    h
}
pub(crate) fn error(e: PollError, id: RequestId) -> ApiError {
    let (status, code, message) = match e {
        PollError::NotFound => (
            StatusCode::NOT_FOUND,
            "poll.not_found",
            "投票或内容不可访问",
        ),
        PollError::Forbidden => (
            StatusCode::FORBIDDEN,
            "poll.forbidden",
            "当前账号不能执行该投票操作",
        ),
        PollError::Disabled => (StatusCode::CONFLICT, "poll.disabled", "投票插件已停用"),
        PollError::Closed => (
            StatusCode::CONFLICT,
            "poll.closed",
            "投票已截止或主题已关闭互动",
        ),
        PollError::AlreadyVoted => (
            StatusCode::CONFLICT,
            "poll.already_voted",
            "你已参与投票，不能改票",
        ),
        PollError::Conflict => (
            StatusCode::CONFLICT,
            "poll.conflict",
            "投票已更新或已有成员投票，不能覆盖选项",
        ),
        PollError::InvalidOption => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "poll.invalid_option",
            "选项不属于当前投票",
        ),
        PollError::InvalidInput => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "request.validation_failed",
            "请输入问题、2–10 个不同选项，并在未来 30 天内截止",
        ),
        PollError::Database(_) => {
            tracing::warn!(request_id=%id,"Poll database operation failed");
            return unavailable(id);
        }
    };
    api_error(status, code, message, id)
}
fn unavailable(id: RequestId) -> ApiError {
    api_error(
        StatusCode::SERVICE_UNAVAILABLE,
        "system.internal_error",
        "投票服务暂时不可用",
        id,
    )
}
fn api_error(status: StatusCode, code: &'static str, message: &str, id: RequestId) -> ApiError {
    (
        status,
        private_headers(),
        Json(ErrorResponse::new(
            ErrorBody::new(ErrorCode::from_static(code), message),
            id,
        )),
    )
}
