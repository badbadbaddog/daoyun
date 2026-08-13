use axum::{
    Router,
    body::{Body, Bytes, to_bytes},
    http::{Request, StatusCode, header},
    routing::post,
};
use daoyun_api::{ObservabilityConfig, app, app_with_observability};
use infrastructure::Database;
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;
use std::{sync::Arc, time::Duration};
use tokio::sync::{Mutex, mpsc};
use tower::ServiceExt;

const UPSTREAM_TRACE_ID: &str = "4bf92f3577b34da6a3ce929d0e0e4736";
const UPSTREAM_PARENT_ID: &str = "00f067aa0ba902b7";

#[derive(Debug)]
struct OtlpRequest {
    content_type: String,
    body: Bytes,
}

#[test]
fn otlp_endpoint_rejects_unsafe_or_ambiguous_urls() {
    for endpoint in [
        "http://collector.internal:4318/v1/traces",
        "https://user:secret@collector.example/v1/traces",
        "https://collector.example/v1/traces?token=secret",
        "https://collector.example/v1/traces#fragment",
    ] {
        assert!(
            ObservabilityConfig::default()
                .with_otlp_endpoint(endpoint, false)
                .is_err(),
            "accepted unsafe endpoint: {endpoint}"
        );
    }

    assert!(
        ObservabilityConfig::default()
            .with_otlp_endpoint("http://127.0.0.1:4318/v1/traces", false)
            .is_ok()
    );
    assert!(
        ObservabilityConfig::default()
            .with_otlp_endpoint("http://collector.internal:4318/v1/traces", true)
            .is_ok()
    );
    assert!(
        ObservabilityConfig::default()
            .with_otlp_endpoint("https://collector.example/v1/traces", false)
            .is_ok()
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn otlp_http_exports_the_server_span_across_the_network_boundary() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("collector listener must bind");
    let collector_address = listener
        .local_addr()
        .expect("collector address must be available");
    let (request_tx, mut request_rx) = mpsc::channel::<OtlpRequest>(1);
    let request_tx = Arc::new(Mutex::new(request_tx));
    let collector = Router::new().route(
        "/v1/traces",
        post({
            let request_tx = request_tx.clone();
            move |headers: axum::http::HeaderMap, body: Bytes| {
                let request_tx = request_tx.clone();
                async move {
                    let content_type = headers
                        .get(header::CONTENT_TYPE)
                        .and_then(|value| value.to_str().ok())
                        .unwrap_or_default()
                        .to_owned();
                    request_tx
                        .lock()
                        .await
                        .send(OtlpRequest { content_type, body })
                        .await
                        .expect("test collector receiver must remain open");
                    (
                        StatusCode::OK,
                        [(header::CONTENT_TYPE, "application/x-protobuf")],
                        Bytes::new(),
                    )
                }
            }
        }),
    );
    let collector_task = tokio::spawn(async move {
        axum::serve(listener, collector)
            .await
            .expect("test collector must serve");
    });

    let runtime = ObservabilityConfig::default()
        .with_otlp_endpoint(format!("http://{collector_address}/v1/traces"), false)
        .expect("loopback OTLP endpoint must be valid")
        .build()
        .expect("OTLP runtime must build");
    let response = app_with_observability(test_database(), runtime.clone())
        .oneshot(
            Request::builder()
                .uri("/api/v1/health/live")
                .header(
                    "traceparent",
                    format!("00-{UPSTREAM_TRACE_ID}-{UPSTREAM_PARENT_ID}-01"),
                )
                .body(Body::empty())
                .expect("request must be valid"),
        )
        .await
        .expect("router must respond");
    assert_eq!(response.status(), StatusCode::OK);
    let response_traceparent = response.headers()["traceparent"]
        .to_str()
        .expect("response traceparent must be text");
    let server_span_id = response_traceparent
        .split('-')
        .nth(2)
        .expect("response traceparent must contain a span ID");

    runtime
        .force_flush_traces()
        .await
        .expect("trace flush must succeed");
    let exported = tokio::time::timeout(Duration::from_secs(5), request_rx.recv())
        .await
        .expect("collector request must arrive before timeout")
        .expect("collector request must exist");
    assert_eq!(exported.content_type, "application/x-protobuf");
    assert!(contains_bytes(
        &exported.body,
        &decode_hex(UPSTREAM_TRACE_ID)
    ));
    assert!(contains_bytes(
        &exported.body,
        &decode_hex(UPSTREAM_PARENT_ID)
    ));
    assert!(contains_bytes(&exported.body, &decode_hex(server_span_id)));
    assert!(contains_bytes(&exported.body, b"/api/v1/health/live"));
    assert!(contains_bytes(&exported.body, b"daoyun-api"));

    runtime
        .shutdown_traces()
        .await
        .expect("trace shutdown must succeed");
    collector_task.abort();
}

#[tokio::test]
async fn valid_traceparent_is_continued_with_a_new_server_span() {
    let response = test_app()
        .oneshot(
            Request::builder()
                .uri("/api/v1/health/live")
                .header(
                    "traceparent",
                    format!("00-{UPSTREAM_TRACE_ID}-00f067aa0ba902b7-01"),
                )
                .body(Body::empty())
                .expect("request must be valid"),
        )
        .await
        .expect("router must respond");

    assert_eq!(response.status(), StatusCode::OK);
    let traceparent = response.headers()["traceparent"]
        .to_str()
        .expect("traceparent must be text");
    assert!(traceparent.starts_with(&format!("00-{UPSTREAM_TRACE_ID}-")));
    assert_ne!(
        traceparent,
        format!("00-{UPSTREAM_TRACE_ID}-00f067aa0ba902b7-01")
    );
}

#[tokio::test]
async fn invalid_traceparent_is_replaced_and_never_reflected() {
    let invalid = "00-00000000000000000000000000000000-0000000000000000-01";
    let response = test_app()
        .oneshot(
            Request::builder()
                .uri("/api/v1/health/live")
                .header("traceparent", invalid)
                .body(Body::empty())
                .expect("request must be valid"),
        )
        .await
        .expect("router must respond");

    let traceparent = response.headers()["traceparent"]
        .to_str()
        .expect("traceparent must be text");
    assert_ne!(traceparent, invalid);
    assert!(is_traceparent(traceparent));
}

#[tokio::test]
async fn metrics_are_hidden_when_disabled_or_the_bearer_token_is_wrong() {
    let disabled = test_app()
        .oneshot(
            Request::builder()
                .uri("/metrics")
                .body(Body::empty())
                .expect("request must be valid"),
        )
        .await
        .expect("router must respond");
    assert_eq!(disabled.status(), StatusCode::NOT_FOUND);

    let runtime = ObservabilityConfig::with_metrics_token("m".repeat(32))
        .expect("token must be valid")
        .build()
        .expect("observability runtime must build");
    let wrong = app_with_observability(test_database(), runtime)
        .oneshot(
            Request::builder()
                .uri("/metrics")
                .header("authorization", "Bearer wrong")
                .body(Body::empty())
                .expect("request must be valid"),
        )
        .await
        .expect("router must respond");
    assert_eq!(wrong.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn metrics_use_template_routes_and_fixed_status_classes() {
    let runtime = ObservabilityConfig::with_metrics_token("m".repeat(32))
        .expect("token must be valid")
        .build()
        .expect("observability runtime must build");
    let app = app_with_observability(test_database(), runtime);

    let topic_id = "019fc900-0000-7000-8000-000000000101";
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/topics/{topic_id}"))
                .body(Body::empty())
                .expect("request must be valid"),
        )
        .await
        .expect("router must respond");
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);

    let metrics = app
        .oneshot(
            Request::builder()
                .uri("/metrics")
                .header("authorization", format!("Bearer {}", "m".repeat(32)))
                .body(Body::empty())
                .expect("request must be valid"),
        )
        .await
        .expect("router must respond");
    assert_eq!(metrics.status(), StatusCode::OK);
    assert_eq!(
        metrics.headers()["content-type"],
        "text/plain; version=0.0.4; charset=utf-8"
    );
    let body = to_bytes(metrics.into_body(), 1024 * 1024)
        .await
        .expect("metrics body must be readable");
    let text = String::from_utf8(body.to_vec()).expect("metrics must be UTF-8");
    assert!(text.contains("daoyun_http_requests_total"));
    assert!(text.contains("route=\"/api/v1/topics/{topic_id}\""));
    assert!(text.contains("status_class=\"5xx\""));
    assert!(!text.contains(topic_id));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn metrics_include_database_queue_risk_and_operations_state(pool: PgPool) {
    let runtime = ObservabilityConfig::with_metrics_token("p".repeat(32))
        .expect("token must be valid")
        .build()
        .expect("observability runtime must build");
    let app = app_with_observability(Database::from_pool(pool), runtime);
    let metrics = app
        .oneshot(
            Request::builder()
                .uri("/metrics")
                .header("authorization", format!("Bearer {}", "p".repeat(32)))
                .body(Body::empty())
                .expect("request must be valid"),
        )
        .await
        .expect("router must respond");
    assert_eq!(metrics.status(), StatusCode::OK);
    let body = to_bytes(metrics.into_body(), 1024 * 1024)
        .await
        .expect("metrics body must be readable");
    let text = String::from_utf8(body.to_vec()).expect("metrics must be UTF-8");
    for expected in [
        "daoyun_database_ready 1",
        "daoyun_database_pool_connections",
        "daoyun_database_pool_idle_connections",
        "daoyun_outbox_events{status=\"pending\"} 0",
        "daoyun_outbox_events{status=\"processing\"} 0",
        "daoyun_outbox_events{status=\"dead\"} 0",
        "daoyun_risk_alerts{status=\"open\"} 0",
        "daoyun_operations_alerts{status=\"open\"} 0",
        "daoyun_operations_alerts{status=\"acknowledged\"} 0",
    ] {
        assert!(text.contains(expected), "missing metric: {expected}");
    }
}

fn test_app() -> Router {
    app(test_database())
}

fn test_database() -> Database {
    let pool = PgPoolOptions::new()
        .acquire_timeout(Duration::from_millis(100))
        .connect_lazy("postgresql://daoyun@127.0.0.1:1/daoyun")
        .expect("the unavailable database URL must be valid");
    Database::from_pool(pool)
}

fn is_traceparent(value: &str) -> bool {
    let parts = value.split('-').collect::<Vec<_>>();
    parts.len() == 4
        && parts[0] == "00"
        && parts[1].len() == 32
        && parts[2].len() == 16
        && matches!(parts[3], "00" | "01")
        && parts[1]
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        && parts[2]
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn contains_bytes(haystack: &[u8], needle: &[u8]) -> bool {
    haystack
        .windows(needle.len())
        .any(|candidate| candidate == needle)
}

fn decode_hex(value: &str) -> Vec<u8> {
    value
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let high = (pair[0] as char).to_digit(16).expect("hex must be valid");
            let low = (pair[1] as char).to_digit(16).expect("hex must be valid");
            ((high << 4) | low) as u8
        })
        .collect()
}
