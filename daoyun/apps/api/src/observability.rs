use std::{
    collections::{BTreeMap, VecDeque},
    fmt,
    net::IpAddr,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

use api_contract::RequestId;
use axum::{
    Extension, Router,
    body::Body,
    extract::{MatchedPath, Request},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
    routing::get,
};
use infrastructure::Database;
use opentelemetry::{
    Context, KeyValue,
    trace::{
        Span as _, SpanBuilder, SpanContext, SpanId, SpanKind, TraceContextExt, TraceFlags,
        TraceId, TraceState, TracerProvider as _,
    },
};
use opentelemetry_otlp::{Protocol, SpanExporter, WithExportConfig};
use opentelemetry_sdk::{
    Resource,
    trace::{SdkTracer, SdkTracerProvider, Span as SdkSpan},
};
use subtle::ConstantTimeEq;
use tracing::Instrument;
use url::Url;
use uuid::Uuid;
use zeroize::Zeroizing;

const TRACEPARENT_HEADER: &str = "traceparent";
const OTLP_SERVICE_NAME: &str = "daoyun-api";
const OTLP_EXPORT_TIMEOUT: Duration = Duration::from_secs(5);
const OTLP_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);
const METRICS_CONTENT_TYPE: &str = "text/plain; version=0.0.4; charset=utf-8";
const DEFAULT_METRIC_WINDOW: Duration = Duration::from_secs(5 * 60);
const METRIC_RETENTION: Duration = Duration::from_secs(24 * 60 * 60);
const MAX_WINDOW_SAMPLES: usize = 100_000;
const DURATION_BUCKETS_MS: [u64; 10] = [5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000];

#[derive(Clone, Default)]
pub struct ObservabilityConfig {
    metrics_token: Option<Arc<Zeroizing<String>>>,
    otlp_endpoint: Option<String>,
}

impl fmt::Debug for ObservabilityConfig {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ObservabilityConfig")
            .field("metrics_enabled", &self.metrics_token.is_some())
            .field("traces_enabled", &self.otlp_endpoint.is_some())
            .finish()
    }
}

impl ObservabilityConfig {
    pub fn from_environment() -> Result<Self, ObservabilityConfigError> {
        let config = match std::env::var("DAOYUN_METRICS_TOKEN") {
            Ok(token) => Self::with_metrics_token(token)?,
            Err(std::env::VarError::NotPresent) => Self::default(),
            Err(std::env::VarError::NotUnicode(_)) => {
                return Err(ObservabilityConfigError::InvalidMetricsToken);
            }
        };
        let allow_http = parse_optional_bool("DAOYUN_OTLP_ALLOW_HTTP")?;
        match std::env::var("DAOYUN_OTLP_TRACES_ENDPOINT") {
            Ok(endpoint) if !endpoint.is_empty() => config.with_otlp_endpoint(endpoint, allow_http),
            Ok(_) | Err(std::env::VarError::NotPresent) => Ok(config),
            Err(std::env::VarError::NotUnicode(_)) => {
                Err(ObservabilityConfigError::InvalidOtlpEndpoint)
            }
        }
    }

    pub fn with_metrics_token(token: String) -> Result<Self, ObservabilityConfigError> {
        if !(32..=256).contains(&token.len()) || !token.bytes().all(|byte| byte.is_ascii_graphic())
        {
            return Err(ObservabilityConfigError::InvalidMetricsToken);
        }
        Ok(Self {
            metrics_token: Some(Arc::new(Zeroizing::new(token))),
            otlp_endpoint: None,
        })
    }

    pub fn with_otlp_endpoint(
        mut self,
        endpoint: impl Into<String>,
        allow_http: bool,
    ) -> Result<Self, ObservabilityConfigError> {
        let endpoint = endpoint.into();
        validate_otlp_endpoint(&endpoint, allow_http)?;
        self.otlp_endpoint = Some(endpoint);
        Ok(self)
    }

    pub fn build(self) -> Result<ObservabilityRuntime, ObservabilityConfigError> {
        let tracing = self
            .otlp_endpoint
            .as_deref()
            .map(OtlpTracingRuntime::build)
            .transpose()?;
        Ok(ObservabilityRuntime {
            inner: Arc::new(ObservabilityInner {
                started_at: Instant::now(),
                metrics_token: self.metrics_token,
                tracing,
                in_flight: AtomicU64::new(0),
                state: Mutex::new(MetricsState::default()),
            }),
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ObservabilityConfigError {
    InvalidMetricsToken,
    InvalidOtlpEndpoint,
    InsecureRemoteOtlpEndpoint,
    InvalidOtlpAllowHttp,
    OtlpExporterInitialization,
}

impl fmt::Display for ObservabilityConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidMetricsToken => formatter
                .write_str("DAOYUN_METRICS_TOKEN must contain 32 to 256 visible ASCII characters"),
            Self::InvalidOtlpEndpoint => {
                formatter.write_str("DAOYUN_OTLP_TRACES_ENDPOINT is invalid")
            }
            Self::InsecureRemoteOtlpEndpoint => formatter
                .write_str("remote OTLP HTTP endpoints require DAOYUN_OTLP_ALLOW_HTTP=true"),
            Self::InvalidOtlpAllowHttp => {
                formatter.write_str("DAOYUN_OTLP_ALLOW_HTTP must be true, false, 1, or 0")
            }
            Self::OtlpExporterInitialization => {
                formatter.write_str("OTLP trace exporter initialization failed")
            }
        }
    }
}

impl std::error::Error for ObservabilityConfigError {}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ObservabilityRuntimeError;

impl fmt::Display for ObservabilityRuntimeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("OTLP trace exporter operation failed")
    }
}

impl std::error::Error for ObservabilityRuntimeError {}

#[derive(Clone)]
pub struct ObservabilityRuntime {
    inner: Arc<ObservabilityInner>,
}

impl fmt::Debug for ObservabilityRuntime {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ObservabilityRuntime")
            .field("metrics_enabled", &self.inner.metrics_token.is_some())
            .finish_non_exhaustive()
    }
}

impl Default for ObservabilityRuntime {
    fn default() -> Self {
        ObservabilityConfig::default()
            .build()
            .expect("disabled observability runtime must build")
    }
}

impl ObservabilityRuntime {
    pub fn metrics_enabled(&self) -> bool {
        self.inner.metrics_token.is_some()
    }

    pub fn traces_enabled(&self) -> bool {
        self.inner.tracing.is_some()
    }

    pub async fn force_flush_traces(&self) -> Result<(), ObservabilityRuntimeError> {
        let Some(tracing) = self.inner.tracing.as_ref() else {
            return Ok(());
        };
        let provider = tracing.provider.clone();
        tokio::task::spawn_blocking(move || provider.force_flush())
            .await
            .map_err(|_| ObservabilityRuntimeError)?
            .map_err(|_| ObservabilityRuntimeError)
    }

    pub async fn shutdown_traces(&self) -> Result<(), ObservabilityRuntimeError> {
        let Some(tracing) = self.inner.tracing.as_ref() else {
            return Ok(());
        };
        let provider = tracing.provider.clone();
        tokio::task::spawn_blocking(move || provider.shutdown_with_timeout(OTLP_SHUTDOWN_TIMEOUT))
            .await
            .map_err(|_| ObservabilityRuntimeError)?
            .map_err(|_| ObservabilityRuntimeError)
    }

    pub fn snapshot(&self) -> ObservabilitySnapshot {
        let window = self.window_snapshot(DEFAULT_METRIC_WINDOW);
        let state = self
            .inner
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        ObservabilitySnapshot {
            uptime_seconds: self.inner.started_at.elapsed().as_secs(),
            total_requests: state.series.values().map(|series| series.count).sum(),
            in_flight_requests: self.inner.in_flight.load(Ordering::Relaxed),
            errors_5m: window.errors,
            p95_ms_5m: window.p95_ms,
        }
    }

    pub fn window_snapshot(&self, window: Duration) -> ObservabilityWindowSnapshot {
        let now = Instant::now();
        let mut state = self
            .inner
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.prune(now);
        let window = window.min(METRIC_RETENTION);
        let samples = state
            .window
            .iter()
            .filter(|sample| now.duration_since(sample.observed_at) <= window);
        let mut durations = samples
            .clone()
            .map(|sample| sample.duration_ms)
            .collect::<Vec<_>>();
        durations.sort_unstable();
        let p95_ms = if durations.is_empty() {
            0
        } else {
            let index = (durations.len() * 95).div_ceil(100).saturating_sub(1);
            durations[index]
        };
        ObservabilityWindowSnapshot {
            errors: samples.filter(|sample| sample.is_5xx).count() as u64,
            p95_ms,
        }
    }

    fn authorize_metrics(&self, headers: &HeaderMap) -> bool {
        let Some(expected) = self.inner.metrics_token.as_ref() else {
            return false;
        };
        let Some(provided) = headers
            .get(header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.strip_prefix("Bearer "))
        else {
            return false;
        };
        provided.len() == expected.len()
            && bool::from(provided.as_bytes().ct_eq(expected.as_bytes()))
    }

    fn begin_request(&self) {
        self.inner.in_flight.fetch_add(1, Ordering::Relaxed);
    }

    fn start_server_span(
        &self,
        incoming: Option<TraceContext>,
        method: &'static str,
        route: &str,
        request_id: Option<RequestId>,
    ) -> Option<SdkSpan> {
        let tracing = self.inner.tracing.as_ref()?;
        let parent = incoming.map_or_else(Context::new, TraceContext::remote_parent);
        let mut attributes = vec![
            KeyValue::new("http.request.method", method),
            KeyValue::new("http.route", route.to_owned()),
        ];
        if let Some(request_id) = request_id {
            attributes.push(KeyValue::new("daoyun.request_id", request_id.to_string()));
        }
        Some(
            SpanBuilder::from_name(format!("{method} {route}"))
                .with_kind(SpanKind::Server)
                .with_attributes(attributes)
                .start_with_context(&tracing.tracer, &parent),
        )
    }

    fn finish_request(&self, method: &'static str, route: String, status: u16, duration: Duration) {
        self.inner.in_flight.fetch_sub(1, Ordering::Relaxed);
        let duration_ms = u64::try_from(duration.as_millis()).unwrap_or(u64::MAX);
        let status_class = status_class(status);
        let now = Instant::now();
        let mut state = self
            .inner
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let series = state
            .series
            .entry(MetricKey {
                method,
                route,
                status_class,
            })
            .or_default();
        series.count = series.count.saturating_add(1);
        series.sum_ms = series.sum_ms.saturating_add(u128::from(duration_ms));
        for (index, bucket) in DURATION_BUCKETS_MS.iter().enumerate() {
            if duration_ms <= *bucket {
                series.buckets[index] = series.buckets[index].saturating_add(1);
            }
        }
        if state.window.len() == MAX_WINDOW_SAMPLES {
            state.window.pop_front();
        }
        state.window.push_back(WindowSample {
            observed_at: now,
            duration_ms,
            is_5xx: status >= 500,
        });
        state.prune(now);
    }

    fn render_prometheus(
        &self,
        database_ready: bool,
        persistent: Option<&infrastructure::OperationsSummaryRecord>,
    ) -> String {
        let state = self
            .inner
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut output = String::from(
            "# HELP daoyun_process_uptime_seconds Process uptime in seconds.\n\
             # TYPE daoyun_process_uptime_seconds gauge\n",
        );
        output.push_str(&format!(
            "daoyun_process_uptime_seconds {}\n",
            self.inner.started_at.elapsed().as_secs()
        ));
        output.push_str(
            "# HELP daoyun_http_requests_in_flight Current HTTP requests.\n\
             # TYPE daoyun_http_requests_in_flight gauge\n",
        );
        output.push_str(&format!(
            "daoyun_http_requests_in_flight {}\n",
            self.inner.in_flight.load(Ordering::Relaxed)
        ));
        output.push_str(
            "# HELP daoyun_http_requests_total Completed HTTP requests.\n\
             # TYPE daoyun_http_requests_total counter\n\
             # HELP daoyun_http_request_duration_seconds HTTP request duration.\n\
             # TYPE daoyun_http_request_duration_seconds histogram\n",
        );
        for (key, series) in &state.series {
            let labels = format!(
                "method=\"{}\",route=\"{}\",status_class=\"{}\"",
                key.method,
                escape_label(&key.route),
                key.status_class
            );
            output.push_str(&format!(
                "daoyun_http_requests_total{{{labels}}} {}\n",
                series.count
            ));
            for (index, bucket_ms) in DURATION_BUCKETS_MS.iter().enumerate() {
                output.push_str(&format!(
                    "daoyun_http_request_duration_seconds_bucket{{{labels},le=\"{}\"}} {}\n",
                    bucket_label(*bucket_ms),
                    series.buckets[index]
                ));
            }
            output.push_str(&format!(
                "daoyun_http_request_duration_seconds_bucket{{{labels},le=\"+Inf\"}} {}\n",
                series.count
            ));
            output.push_str(&format!(
                "daoyun_http_request_duration_seconds_sum{{{labels}}} {:.6}\n",
                series.sum_ms as f64 / 1_000.0
            ));
            output.push_str(&format!(
                "daoyun_http_request_duration_seconds_count{{{labels}}} {}\n",
                series.count
            ));
        }
        output.push_str(
            "# HELP daoyun_database_ready Whether the database schema is reachable and current.\n\
             # TYPE daoyun_database_ready gauge\n",
        );
        output.push_str(&format!(
            "daoyun_database_ready {}\n",
            u8::from(database_ready)
        ));
        if let Some(persistent) = persistent {
            output.push_str(
                "# HELP daoyun_database_pool_connections Current database pool connections.\n\
                 # TYPE daoyun_database_pool_connections gauge\n\
                 # HELP daoyun_database_pool_idle_connections Current idle database pool connections.\n\
                 # TYPE daoyun_database_pool_idle_connections gauge\n\
                 # HELP daoyun_outbox_events Current Outbox events by fixed status.\n\
                 # TYPE daoyun_outbox_events gauge\n\
                 # HELP daoyun_risk_alerts Current governance risk alerts by fixed status.\n\
                 # TYPE daoyun_risk_alerts gauge\n\
                 # HELP daoyun_operations_alerts Current operations alerts by fixed status.\n\
                 # TYPE daoyun_operations_alerts gauge\n",
            );
            output.push_str(&format!(
                "daoyun_database_pool_connections {}\n\
                 daoyun_database_pool_idle_connections {}\n\
                 daoyun_outbox_events{{status=\"pending\"}} {}\n\
                 daoyun_outbox_events{{status=\"processing\"}} {}\n\
                 daoyun_outbox_events{{status=\"dead\"}} {}\n\
                 daoyun_risk_alerts{{status=\"open\"}} {}\n\
                 daoyun_operations_alerts{{status=\"open\"}} {}\n\
                 daoyun_operations_alerts{{status=\"acknowledged\"}} {}\n",
                persistent.database_connections,
                persistent.database_idle_connections,
                persistent.outbox_pending,
                persistent.outbox_processing,
                persistent.outbox_dead,
                persistent.risk_alerts_open,
                persistent.operations_alerts_open,
                persistent.operations_alerts_acknowledged,
            ));
        }
        output
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ObservabilitySnapshot {
    pub uptime_seconds: u64,
    pub total_requests: u64,
    pub in_flight_requests: u64,
    pub errors_5m: u64,
    pub p95_ms_5m: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ObservabilityWindowSnapshot {
    pub errors: u64,
    pub p95_ms: u64,
}

struct ObservabilityInner {
    started_at: Instant,
    metrics_token: Option<Arc<Zeroizing<String>>>,
    tracing: Option<OtlpTracingRuntime>,
    in_flight: AtomicU64,
    state: Mutex<MetricsState>,
}

struct OtlpTracingRuntime {
    provider: SdkTracerProvider,
    tracer: SdkTracer,
}

impl OtlpTracingRuntime {
    fn build(endpoint: &str) -> Result<Self, ObservabilityConfigError> {
        crate::install_rustls_crypto_provider();
        // Source: https://docs.rs/opentelemetry-otlp/0.32.0/opentelemetry_otlp/#http-transport-port-4318
        let exporter = SpanExporter::builder()
            .with_http()
            .with_protocol(Protocol::HttpBinary)
            .with_endpoint(endpoint)
            .with_timeout(OTLP_EXPORT_TIMEOUT)
            .build()
            .map_err(|_| ObservabilityConfigError::OtlpExporterInitialization)?;
        // Source: https://docs.rs/opentelemetry_sdk/0.32.1/opentelemetry_sdk/trace/struct.SdkTracerProvider.html
        let provider = SdkTracerProvider::builder()
            .with_resource(
                Resource::builder()
                    .with_service_name(OTLP_SERVICE_NAME)
                    .build(),
            )
            .with_batch_exporter(exporter)
            .build();
        let tracer = provider.tracer(OTLP_SERVICE_NAME);
        Ok(Self { provider, tracer })
    }
}

#[derive(Default)]
struct MetricsState {
    series: BTreeMap<MetricKey, MetricSeries>,
    window: VecDeque<WindowSample>,
}

impl MetricsState {
    fn prune(&mut self, now: Instant) {
        while self
            .window
            .front()
            .is_some_and(|sample| now.duration_since(sample.observed_at) > METRIC_RETENTION)
        {
            self.window.pop_front();
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct MetricKey {
    method: &'static str,
    route: String,
    status_class: &'static str,
}

#[derive(Default)]
struct MetricSeries {
    count: u64,
    sum_ms: u128,
    buckets: [u64; DURATION_BUCKETS_MS.len()],
}

struct WindowSample {
    observed_at: Instant,
    duration_ms: u64,
    is_5xx: bool,
}

#[derive(Clone, Copy)]
struct TraceContext {
    trace_id: [u8; 16],
    parent_id: [u8; 8],
    flags: u8,
}

impl TraceContext {
    fn remote_parent(self) -> Context {
        Context::new().with_remote_span_context(SpanContext::new(
            TraceId::from_bytes(self.trace_id),
            SpanId::from_bytes(self.parent_id),
            TraceFlags::new(self.flags),
            true,
            TraceState::default(),
        ))
    }
}

pub(crate) fn router() -> Router<Database> {
    Router::new().route("/metrics", get(metrics))
}

async fn metrics(
    axum::extract::State(database): axum::extract::State<Database>,
    Extension(runtime): Extension<ObservabilityRuntime>,
    headers: HeaderMap,
) -> Response {
    if !runtime.authorize_metrics(&headers) {
        return StatusCode::NOT_FOUND.into_response();
    }
    let persistent = match database.check_readiness().await {
        Ok(()) => match database.operations_summary().await {
            Ok(summary) => Some(summary),
            Err(error) => {
                tracing::warn!(error = %error, "Metrics persistent state query failed");
                None
            }
        },
        Err(error) => {
            tracing::warn!(error = %error, "Metrics database readiness query failed");
            None
        }
    };
    let database_ready = persistent.is_some();
    let mut response = Response::new(Body::from(
        runtime.render_prometheus(database_ready, persistent.as_ref()),
    ));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static(METRICS_CONTENT_TYPE),
    );
    response
}

pub(crate) async fn observe_request(
    axum::extract::State(runtime): axum::extract::State<ObservabilityRuntime>,
    mut request: Request,
    next: Next,
) -> Response {
    let method = normalized_method(request.method().as_str());
    let route = request
        .extensions()
        .get::<MatchedPath>()
        .map(|path| path.as_str().to_owned())
        .unwrap_or_else(|| "unmatched".to_owned());
    let incoming = request
        .headers()
        .get(TRACEPARENT_HEADER)
        .and_then(|value| value.to_str().ok())
        .and_then(parse_traceparent);
    let request_id = request.extensions().get::<RequestId>().copied();
    let mut exported_span = runtime.start_server_span(incoming, method, &route, request_id);
    let (trace_id_bytes, span_id_bytes, flags) = if let Some(span) = exported_span.as_ref() {
        let context = span.span_context();
        (
            context.trace_id().to_bytes(),
            context.span_id().to_bytes(),
            context.trace_flags().to_u8(),
        )
    } else {
        let trace = incoming.unwrap_or_else(new_trace_context);
        (trace.trace_id, new_span_id(), trace.flags)
    };
    let trace_id = hex_lower(&trace_id_bytes);
    let traceparent = format!("00-{trace_id}-{}-{flags:02x}", hex_lower(&span_id_bytes));
    request.extensions_mut().insert(TraceContext {
        trace_id: trace_id_bytes,
        parent_id: span_id_bytes,
        flags,
    });
    let started_at = Instant::now();
    runtime.begin_request();
    let span = tracing::info_span!(
        "http.request",
        request_id = request_id.map(|value| value.to_string()).unwrap_or_default(),
        trace_id = %trace_id,
        method,
        route = %route,
    );
    let mut response = next.run(request).instrument(span).await;
    let elapsed = started_at.elapsed();
    let status = response.status().as_u16();
    runtime.finish_request(method, route.clone(), status, elapsed);
    if let Some(span) = exported_span.as_mut() {
        span.set_attribute(KeyValue::new(
            "http.response.status_code",
            i64::from(status),
        ));
        span.set_attribute(KeyValue::new(
            "daoyun.http.status_class",
            status_class(status),
        ));
        span.end();
    }
    tracing::info!(
        request_id = request_id.map(|value| value.to_string()).unwrap_or_default(),
        trace_id = %trace_id,
        method,
        route = %route,
        status,
        duration_ms = u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX),
        "HTTP request completed"
    );
    response.headers_mut().insert(
        header::HeaderName::from_static(TRACEPARENT_HEADER),
        HeaderValue::from_str(&traceparent).expect("generated traceparent is a valid header"),
    );
    response
}

fn parse_traceparent(value: &str) -> Option<TraceContext> {
    if value.len() != 55 || !value.is_ascii() {
        return None;
    }
    let bytes = value.as_bytes();
    if bytes[0..3] != *b"00-" || bytes[35] != b'-' || bytes[52] != b'-' {
        return None;
    }
    let trace_id = decode_hex::<16>(&bytes[3..35])?;
    let parent_id = decode_hex::<8>(&bytes[36..52])?;
    let flags = decode_hex::<1>(&bytes[53..55])?[0];
    if trace_id.iter().all(|byte| *byte == 0)
        || parent_id.iter().all(|byte| *byte == 0)
        || !matches!(flags, 0 | 1)
    {
        return None;
    }
    Some(TraceContext {
        trace_id,
        parent_id,
        flags,
    })
}

fn decode_hex<const N: usize>(value: &[u8]) -> Option<[u8; N]> {
    if value.len() != N * 2 {
        return None;
    }
    let mut decoded = [0_u8; N];
    for (index, pair) in value.chunks_exact(2).enumerate() {
        decoded[index] = (hex_nibble(pair[0])? << 4) | hex_nibble(pair[1])?;
    }
    Some(decoded)
}

fn hex_nibble(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        _ => None,
    }
}

fn new_trace_context() -> TraceContext {
    TraceContext {
        trace_id: *Uuid::now_v7().as_bytes(),
        parent_id: [0; 8],
        flags: 1,
    }
}

fn new_span_id() -> [u8; 8] {
    let bytes = Uuid::now_v7().into_bytes();
    bytes[8..16]
        .try_into()
        .expect("UUID tail contains eight bytes")
}

fn hex_lower(bytes: &[u8]) -> String {
    use fmt::Write;
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        write!(&mut output, "{byte:02x}").expect("writing to String cannot fail");
    }
    output
}

fn normalized_method(method: &str) -> &'static str {
    match method {
        "GET" => "GET",
        "POST" => "POST",
        "PATCH" => "PATCH",
        "PUT" => "PUT",
        "DELETE" => "DELETE",
        "HEAD" => "HEAD",
        "OPTIONS" => "OPTIONS",
        _ => "OTHER",
    }
}

fn status_class(status: u16) -> &'static str {
    match status {
        100..=199 => "1xx",
        200..=299 => "2xx",
        300..=399 => "3xx",
        400..=499 => "4xx",
        _ => "5xx",
    }
}

fn escape_label(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
}

fn bucket_label(milliseconds: u64) -> String {
    if milliseconds < 1_000 {
        format!("0.{milliseconds:03}")
    } else if milliseconds.is_multiple_of(1_000) {
        (milliseconds / 1_000).to_string()
    } else {
        format!("{}.{:03}", milliseconds / 1_000, milliseconds % 1_000)
    }
}

fn validate_otlp_endpoint(
    endpoint: &str,
    allow_http: bool,
) -> Result<(), ObservabilityConfigError> {
    if endpoint.is_empty() || endpoint.len() > 2_048 || endpoint.chars().any(char::is_control) {
        return Err(ObservabilityConfigError::InvalidOtlpEndpoint);
    }
    let url = Url::parse(endpoint).map_err(|_| ObservabilityConfigError::InvalidOtlpEndpoint)?;
    let host = url
        .host_str()
        .ok_or(ObservabilityConfigError::InvalidOtlpEndpoint)?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(ObservabilityConfigError::InvalidOtlpEndpoint);
    }
    match url.scheme() {
        "https" => Ok(()),
        "http" if allow_http || is_loopback_host(host) => Ok(()),
        "http" => Err(ObservabilityConfigError::InsecureRemoteOtlpEndpoint),
        _ => Err(ObservabilityConfigError::InvalidOtlpEndpoint),
    }
}

fn is_loopback_host(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<IpAddr>()
            .is_ok_and(|address| address.is_loopback())
}

fn parse_optional_bool(name: &str) -> Result<bool, ObservabilityConfigError> {
    match std::env::var(name).as_deref() {
        Err(std::env::VarError::NotPresent) | Ok("") | Ok("false") | Ok("0") => Ok(false),
        Ok("true") | Ok("1") => Ok(true),
        Err(std::env::VarError::NotUnicode(_)) | Ok(_) => {
            Err(ObservabilityConfigError::InvalidOtlpAllowHttp)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{bucket_label, parse_traceparent};

    #[test]
    fn traceparent_parser_rejects_non_canonical_and_zero_identifiers() {
        assert!(
            parse_traceparent("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01").is_some()
        );
        for invalid in [
            "00-4BF92F3577B34DA6A3CE929D0E0E4736-00f067aa0ba902b7-01",
            "00-00000000000000000000000000000000-00f067aa0ba902b7-01",
            "00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01",
            "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-ff",
        ] {
            assert!(parse_traceparent(invalid).is_none(), "accepted {invalid}");
        }
    }

    #[test]
    fn histogram_bucket_labels_are_canonical_seconds() {
        assert_eq!(bucket_label(5), "0.005");
        assert_eq!(bucket_label(1_000), "1");
        assert_eq!(bucket_label(2_500), "2.500");
    }
}
