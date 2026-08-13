use axum::{
    body::Body,
    http::{Request, StatusCode},
    response::Response,
};
use infrastructure::Database;
use serde_json::{Value, json};
use tower::ServiceExt;

#[test]
fn oidc_provider_configuration_requires_secure_issuers_and_unique_keys() {
    let valid = json!([
        {
            "provider_key": "google",
            "display_name": "Google",
            "issuer": "https://accounts.google.com",
            "client_id": "client-id",
            "client_secret": "client-secret",
            "redirect_uri": "https://community.example.com/api/v1/auth/oidc/google/callback"
        }
    ])
    .to_string();
    let providers = daoyun_api::OidcProviderConfig::parse_json(&valid)
        .expect("valid OIDC provider config must parse");
    assert_eq!(providers.len(), 1);
    assert_eq!(providers[0].provider_key(), "google");
    assert_eq!(providers[0].display_name(), "Google");
    assert!(!format!("{:?}", providers).contains("client-secret"));

    let insecure = valid.replace("https://accounts.google.com", "http://accounts.google.com");
    assert!(daoyun_api::OidcProviderConfig::parse_json(&insecure).is_err());

    let duplicate = format!("[{0},{0}]", &valid[1..valid.len() - 1]);
    assert!(daoyun_api::OidcProviderConfig::parse_json(&duplicate).is_err());

    let blank_display_name =
        valid.replace("\"display_name\":\"Google\"", "\"display_name\":\"   \"");
    assert!(daoyun_api::OidcProviderConfig::parse_json(&blank_display_name).is_err());
}

#[test]
fn oidc_provider_configuration_allows_loopback_http_callbacks_only() {
    let config = json!([
        {
            "provider_key": "local",
            "display_name": "本地身份服务",
            "issuer": "https://issuer.example.com",
            "client_id": "client-id",
            "client_secret": "client-secret",
            "redirect_uri": "http://127.0.0.1:3000/api/v1/auth/oidc/local/callback"
        }
    ])
    .to_string();
    assert!(daoyun_api::OidcProviderConfig::parse_json(&config).is_ok());

    let remote_http = config.replace("http://127.0.0.1:3000", "http://community.example.com");
    assert!(daoyun_api::OidcProviderConfig::parse_json(&remote_http).is_err());

    let callback_with_query = config.replace("/callback", "/callback?tenant=local");
    assert!(daoyun_api::OidcProviderConfig::parse_json(&callback_with_query).is_err());
}

#[tokio::test]
async fn oidc_provider_metadata_is_public_and_does_not_expose_credentials() {
    let config = daoyun_api::AuthConfig::default()
        .with_secure_cookies(false)
        .with_oidc_provider_json(
            json!([
                {
                    "provider_key": "google",
                    "display_name": "Google",
                    "issuer": "https://accounts.google.com",
                    "client_id": "client-id",
                    "client_secret": "client-secret",
                    "redirect_uri": "https://community.example.com/api/v1/auth/oidc/google/callback"
                }
            ])
            .to_string(),
        )
        .expect("OIDC provider config must be accepted");
    let app = daoyun_api::app_with_config(Database::from_pool(unavailable_database()), config);
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/auth/providers")
                .body(Body::empty())
                .expect("provider request must be valid"),
        )
        .await
        .expect("provider route must respond");
    assert_eq!(response.status(), axum::http::StatusCode::OK);
    let payload = response_json(response).await;
    assert_eq!(
        payload["data"],
        json!([{ "provider_key": "google", "display_name": "Google" }])
    );
    assert!(!payload.to_string().contains("client-secret"));
    assert!(!payload.to_string().contains("client-id"));
}

#[tokio::test]
async fn oidc_provider_metadata_is_empty_when_not_configured() {
    let app = daoyun_api::app(Database::from_pool(unavailable_database()));
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/auth/providers")
                .body(Body::empty())
                .expect("provider request must be valid"),
        )
        .await
        .expect("provider route must respond");
    assert_eq!(response.status(), axum::http::StatusCode::OK);
    assert_eq!(response_json(response).await["data"], json!([]));
}

#[tokio::test]
async fn oidc_http_routes_reject_unknown_providers_and_unbound_callbacks_generically() {
    let config = daoyun_api::AuthConfig::default()
        .with_secure_cookies(false)
        .with_oidc_provider_json(
            json!([{
                "provider_key": "google",
                "display_name": "Google",
                "issuer": "https://accounts.google.com",
                "client_id": "client-id",
                "client_secret": "client-secret",
                "redirect_uri": "https://community.example.com/api/v1/auth/oidc/google/callback"
            }])
            .to_string(),
        )
        .expect("OIDC provider config must be accepted");
    let app = daoyun_api::app_with_config(Database::from_pool(unavailable_database()), config);

    let missing_provider = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/auth/oidc/unknown/start")
                .body(Body::empty())
                .expect("start request must be valid"),
        )
        .await
        .expect("start route must respond");
    assert_eq!(missing_provider.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        response_json(missing_provider).await["error"]["code"],
        "auth.oidc_provider_not_found"
    );

    let invalid_callback = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/auth/oidc/google/callback?state=invalid&error=access_denied&error_description=provider-secret")
                .body(Body::empty())
                .expect("callback request must be valid"),
        )
        .await
        .expect("callback route must respond");
    assert_eq!(invalid_callback.status(), StatusCode::BAD_REQUEST);
    assert!(
        invalid_callback
            .headers()
            .get_all("set-cookie")
            .iter()
            .any(|value| value
                .to_str()
                .is_ok_and(|value| value.contains("daoyun_oidc=") && value.contains("Max-Age=0")))
    );
    let callback_payload = response_json(invalid_callback).await;
    assert_eq!(callback_payload["error"]["code"], "auth.oidc_failed");
    assert!(!callback_payload.to_string().contains("provider-secret"));
    assert!(!callback_payload.to_string().contains("access_denied"));
}

async fn response_json(response: Response) -> Value {
    let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .expect("response body must be readable");
    serde_json::from_slice(&bytes).expect("response body must be JSON")
}

fn unavailable_database() -> sqlx::PgPool {
    sqlx::postgres::PgPoolOptions::new()
        .acquire_timeout(std::time::Duration::from_millis(100))
        .connect_lazy("postgresql://daoyun@127.0.0.1:1/daoyun")
        .expect("unavailable database URL must be valid")
}
