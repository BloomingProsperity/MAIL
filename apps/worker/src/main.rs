#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "email_hub_worker=info".into()),
        )
        .init();

    tracing::info!("email hub worker ready");
}
