use std::net::SocketAddr;

use tower_http::{cors::CorsLayer, trace::TraceLayer};

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "email_hub_api=info,tower_http=info".into()),
        )
        .init();

    let port = std::env::var("API_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(8080);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let app = email_hub_api::routes::router()
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http());
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("bind api listener");

    tracing::info!(%addr, "email hub api listening");
    axum::serve(listener, app).await.expect("serve api");
}
