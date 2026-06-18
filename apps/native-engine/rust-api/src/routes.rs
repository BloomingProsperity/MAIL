use axum::{Json, Router, routing::get};
use serde::Serialize;

use crate::{
    API_NAME,
    hermes::{hermes_skills, memory_layers},
    mail_engine::{EmailEngineAdapterConfig, MailEngineAdapter},
};

#[derive(Debug, Serialize)]
struct HealthResponse {
    service: &'static str,
    ok: bool,
}

pub fn router() -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/api/hermes/skills", get(skills))
        .route("/api/hermes/memories", get(memories))
        .route("/api/mail-engine/health", get(mail_engine_health))
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        service: API_NAME,
        ok: true,
    })
}

async fn skills() -> Json<Vec<crate::hermes::HermesSkill>> {
    Json(hermes_skills())
}

async fn memories() -> Json<Vec<crate::hermes::MemoryLayer>> {
    Json(memory_layers())
}

async fn mail_engine_health() -> Json<crate::mail_engine::EngineHealth> {
    let adapter = MailEngineAdapter::emailengine(EmailEngineAdapterConfig {
        base_url: std::env::var("EMAILENGINE_URL")
            .unwrap_or_else(|_| "http://emailengine:3000".to_string()),
        webhook_secret: std::env::var("EMAILENGINE_WEBHOOK_SECRET")
            .unwrap_or_else(|_| "dev-emailhub-secret".to_string()),
    });

    Json(adapter.health().await)
}
