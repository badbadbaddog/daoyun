// Public test-only RSA material in tests/fixtures is generated for this isolated IdP, never a deployment credential.
use super::*;
use axum::{
    Form,
    body::{Body, to_bytes},
    http::Request,
    routing::{get, post},
};
use infrastructure::InstallationAdministrator;
use serde_json::Value;
use sqlx::PgPool;
use tower::ServiceExt;

fn get_request(uri: &str, cookies: &str) -> Request<Body> {
    Request::builder()
        .uri(uri)
        .header(header::COOKIE, cookies)
        .body(Body::empty())
        .unwrap()
}
fn cookies(response: &Response) -> String {
    response
        .headers()
        .get_all(header::SET_COOKIE)
        .iter()
        .map(|value| value.to_str().unwrap().split(';').next().unwrap())
        .collect::<Vec<_>>()
        .join("; ")
}
async fn json_body(response: Response) -> Value {
    serde_json::from_slice(&to_bytes(response.into_body(), 32768).await.unwrap()).unwrap()
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn signed_oidc_callback_creates_revocable_sessions_and_rejects_replay(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let user = Uuid::now_v7();
    let request_id = RequestId::from(Uuid::now_v7());
    database
        .initialize_installation(InstallationAdministrator {
            id: user,
            username: "oidc_owner".into(),
            email: "oidc-owner@example.test".into(),
            display_name: "OIDC Owner".into(),
            password_hash: hash_password(Zeroizing::new("local test password".into()), request_id)
                .await
                .unwrap(),
        })
        .await
        .unwrap();
    database
        .insert_external_identity(NewExternalIdentityRecord {
            id: Uuid::now_v7(),
            user_id: user,
            provider_key: "local".into(),
            subject: "test-subject".into(),
            issuer: "https://issuer.example".into(),
            email_snapshot: None,
            email_verified: None,
        })
        .await
        .unwrap();
    let token = Arc::new(Mutex::new(String::new()));
    let served_token = token.clone();
    let jwks: Value =
        serde_json::from_str(include_str!("../tests/fixtures/oidc-test-jwks.json")).unwrap();
    let provider_app = Router::new().route("/jwks", get(move || async move { Json(jwks.clone()) }))
        .route("/token", post(move |Form(form): Form<HashMap<String, String>>| {
            let token = served_token.lock().unwrap().clone();
            async move {
                assert_eq!(form["grant_type"], "authorization_code");
                assert_eq!(form["code"], "fixture-code");
                assert!(form["code_verifier"].len() >= 43);
                Json(json!({"access_token":"test-access", "token_type":"Bearer", "id_token":token}))
            }
        }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, provider_app).await.unwrap() });
    let config = AuthConfig::default().with_secure_cookies(false).with_oidc_provider_json(json!([{
        "provider_key":"local", "display_name":"Test IdP", "issuer":"https://issuer.example",
        "client_id":"test-client", "client_secret":"test-secret", "redirect_uri":"http://127.0.0.1/api/v1/auth/oidc/local/callback"
    }]).to_string()).unwrap();
    let mut runtime = runtime(config);
    runtime.oidc = Some(OidcRuntime::for_callback_tests(
        &runtime.config.oidc_providers[0],
        address,
    ));
    let app = router(runtime)
        .with_state(database.clone())
        .layer(axum::middleware::from_fn(crate::assign_request_id));
    let der = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        include_str!("../tests/fixtures/oidc-test-rsa-private.base64").trim(),
    )
    .unwrap();
    let key = jsonwebtoken::EncodingKey::from_rsa_der(&der);
    let mut header = jsonwebtoken::Header::new(jsonwebtoken::Algorithm::RS256);
    header.kid = Some("test".into());
    for attempt in 0..2 {
        let start = app
            .clone()
            .oneshot(get_request("/api/v1/auth/oidc/local/start", ""))
            .await
            .unwrap();
        assert_eq!(start.status(), StatusCode::FOUND);
        let bound_cookie = cookies(&start);
        let url = Url::parse(start.headers()[header::LOCATION].to_str().unwrap()).unwrap();
        let params = url.query_pairs().into_owned().collect::<HashMap<_, _>>();
        let now = OffsetDateTime::now_utc().unix_timestamp();
        *token.lock().unwrap() = jsonwebtoken::encode(
            &header,
            &json!({
                "iss":"https://issuer.example", "sub":"test-subject", "aud":"test-client",
                "iat":now, "exp":now+300, "nonce":params["nonce"]
            }),
            &key,
        )
        .unwrap();
        let callback_uri = format!(
            "/api/v1/auth/oidc/local/callback?state={}&code=fixture-code",
            params["state"]
        );
        let callback = app
            .clone()
            .oneshot(get_request(&callback_uri, &bound_cookie))
            .await
            .unwrap();
        assert_eq!(callback.status(), StatusCode::FOUND);
        assert_eq!(callback.headers()[header::LOCATION], "/");
        let session_cookie = cookies(&callback);
        let current = app
            .clone()
            .oneshot(get_request("/api/v1/auth/session", &session_cookie))
            .await
            .unwrap();
        assert_eq!(current.status(), StatusCode::OK);
        assert_eq!(
            json_body(current).await["data"]["user"]["id"],
            user.to_string()
        );
        let identity_id =
            sqlx::query_scalar::<_, Uuid>("SELECT id FROM external_identities WHERE user_id=$1")
                .bind(user)
                .fetch_one(&pool)
                .await
                .unwrap();
        for path in [
            "/api/v1/auth/oidc/local/bindings".to_owned(),
            format!("/api/v1/auth/oidc/local/bindings/{identity_id}/replacement"),
        ] {
            for csrf in [None, Some("wrong-csrf")] {
                let mut request = Request::builder()
                    .method("POST")
                    .uri(&path)
                    .header(header::COOKIE, &session_cookie);
                if let Some(csrf) = csrf {
                    request = request.header("x-csrf-token", csrf);
                }
                let denied = app
                    .clone()
                    .oneshot(request.body(Body::empty()).unwrap())
                    .await
                    .unwrap();
                assert_eq!(denied.status(), StatusCode::FORBIDDEN);
                let response_request_id = denied.headers()["x-request-id"]
                    .to_str()
                    .unwrap()
                    .to_owned();
                let denied = json_body(denied).await;
                assert_eq!(denied["meta"]["request_id"], response_request_id);
                assert_eq!(denied["error"]["code"], "auth.csrf_failed");
                assert_eq!(
                    sqlx::query_scalar::<_, i64>(
                        "SELECT count(*) FROM external_identities WHERE user_id=$1"
                    )
                    .bind(user)
                    .fetch_one(&pool)
                    .await
                    .unwrap(),
                    1
                );
            }
        }
        let replay = app
            .clone()
            .oneshot(get_request(&callback_uri, &bound_cookie))
            .await
            .unwrap();
        assert_eq!(replay.status(), StatusCode::BAD_REQUEST);
        assert_eq!(json_body(replay).await["error"]["code"], "auth.oidc_failed");
        let headers = get_request("/", &session_cookie).into_parts().0.headers;
        let session_token = cookie_value(&headers, "daoyun_session").unwrap();
        assert!(
            database
                .revoke_session(&token_hash(session_token))
                .await
                .unwrap()
        );
        assert_eq!(
            app.clone()
                .oneshot(get_request("/api/v1/auth/session", &session_cookie))
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT count(*) FROM external_identities WHERE user_id=$1"
            )
            .bind(user)
            .fetch_one(&pool)
            .await
            .unwrap(),
            1
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM sessions WHERE user_id=$1")
                .bind(user)
                .fetch_one(&pool)
                .await
                .unwrap(),
            attempt + 1
        );
    }
    server.abort();
}
