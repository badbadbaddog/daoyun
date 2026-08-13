use daoyun_api::{
    AuthConfig, CacheConfig, MfaRuntime, ObservabilityConfig, OperationsAlertWorker,
    OperationsAlertWorkerConfig, OutboxHandler, OutboxWorker, OutboxWorkerConfig, PluginRuntime,
    SiteBrandingCacheInvalidationHandler, UserRestrictionWorker, UserRestrictionWorkerConfig,
    app_with_all_runtimes,
};
use infrastructure::Database;
use std::{net::SocketAddr, sync::Arc};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Source: https://docs.rs/tracing-subscriber/0.3.23/tracing_subscriber/filter/struct.EnvFilter.html#method.try_from_default_env
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    tracing_subscriber::fmt().with_env_filter(filter).init();

    let database_url = std::env::var("DATABASE_URL").map_err(|_| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "DATABASE_URL is required")
    })?;
    let database = Database::connect_and_migrate(&database_url).await?;

    let auth_config = AuthConfig::from_environment()
        .map_err(|message| std::io::Error::new(std::io::ErrorKind::InvalidInput, message))?;
    let cache_config = CacheConfig::from_environment()?;
    let cache_enabled = cache_config.is_enabled();
    let cache = cache_config.build()?;
    let mfa = MfaRuntime::from_environment()?;
    let observability = ObservabilityConfig::from_environment()?.build()?;
    let plugins = PluginRuntime::from_environment()?;
    tracing::info!(
        redis_cache_enabled = cache_enabled,
        mfa_enabled = mfa.is_enabled(),
        metrics_enabled = observability.metrics_enabled(),
        traces_enabled = observability.traces_enabled(),
        plugins_enabled = plugins.is_enabled(),
        "Application runtimes configured"
    );

    let handlers: Vec<Arc<dyn OutboxHandler>> = vec![Arc::new(
        SiteBrandingCacheInvalidationHandler::new(cache.clone()),
    )];
    let worker = OutboxWorker::new(database.clone(), handlers, OutboxWorkerConfig::default())?;
    let operations_worker = OperationsAlertWorker::new(
        database.clone(),
        observability.clone(),
        OperationsAlertWorkerConfig::default(),
    )?;
    let restriction_worker =
        UserRestrictionWorker::new(database.clone(), UserRestrictionWorkerConfig::default())?;
    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
    let operations_shutdown_rx = shutdown_rx.clone();
    let restriction_shutdown_rx = shutdown_rx.clone();
    let worker_task = tokio::spawn(async move { worker.run(shutdown_rx).await });
    let operations_worker_task =
        tokio::spawn(async move { operations_worker.run(operations_shutdown_rx).await });
    let restriction_worker_task =
        tokio::spawn(async move { restriction_worker.run(restriction_shutdown_rx).await });

    let bind_address =
        std::env::var("DAOYUN_BIND_ADDR").unwrap_or_else(|_| "127.0.0.1:3000".to_owned());
    let listener = tokio::net::TcpListener::bind(&bind_address).await?;
    tracing::info!(address = %bind_address, "DaoYun API listening");

    // Source: https://docs.rs/axum/0.8.9/axum/fn.serve.html
    // Source: https://docs.rs/axum/0.8.9/axum/routing/struct.Router.html#method.into_make_service_with_connect_info
    let server = axum::serve(
        listener,
        app_with_all_runtimes(
            database,
            auth_config,
            cache,
            mfa,
            observability.clone(),
            plugins,
        )
        .into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(async move {
        if let Err(error) = tokio::signal::ctrl_c().await {
            tracing::error!(error = %error, "Shutdown signal listener failed");
        }
        let _ = shutdown_tx.send(true);
    })
    .await;
    let worker_result = worker_task.await;
    let operations_worker_result = operations_worker_task.await;
    let restriction_worker_result = restriction_worker_task.await;
    let tracing_shutdown_result = observability.shutdown_traces().await;
    worker_result?;
    operations_worker_result?;
    restriction_worker_result?;
    server?;
    tracing_shutdown_result?;
    Ok(())
}
