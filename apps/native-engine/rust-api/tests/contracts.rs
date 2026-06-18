use email_hub_api::hermes::{hermes_skills, memory_layers};
use email_hub_api::mail_engine::{AdapterProvider, EmailEngineAdapterConfig, MailEngineAdapter};
use email_hub_api::priority::{PrioritySignals, score_message};

#[test]
fn priority_formula_matches_product_contract() {
    let customer = score_message(PrioritySignals {
        directness: 1.0,
        relationship: 0.9,
        actionability: 1.0,
        urgency: 0.9,
        thread_momentum: 0.7,
        user_context: 0.6,
        noise: 0.0,
        negative_history: 0.0,
    });
    let newsletter = score_message(PrioritySignals {
        directness: 0.1,
        relationship: 0.1,
        actionability: 0.0,
        urgency: 0.0,
        thread_momentum: 0.1,
        user_context: 0.1,
        noise: 1.0,
        negative_history: 0.8,
    });

    assert!(customer.score > newsletter.score);
    assert_eq!(customer.bucket, "P1 Urgent");
    assert_eq!(newsletter.bucket, "P6 Feed");
    assert!(customer.reasons.contains(&"直接发给你".to_string()));
}

#[test]
fn hermes_registry_is_single_ai_entrypoint() {
    let skills: Vec<_> = hermes_skills().into_iter().map(|skill| skill.id).collect();

    assert_eq!(
        skills,
        vec![
            "thread_summarize",
            "reply_draft",
            "rewrite_polish",
            "quick_reply",
            "email_search_qa",
            "action_item_extract",
            "priority_triage",
            "label_suggest",
            "newsletter_cleanup",
            "followup_tracker",
            "rule_suggest",
            "memory_review",
        ]
    );
    assert!(memory_layers().iter().any(|layer| layer.id == "procedural_memory"));
}

#[tokio::test]
async fn emailengine_adapter_reports_provider_boundary() {
    let adapter = MailEngineAdapter::emailengine(EmailEngineAdapterConfig {
        base_url: "http://emailengine:3000".to_string(),
        webhook_secret: "dev".to_string(),
    });

    assert_eq!(adapter.provider(), AdapterProvider::EmailEngine);
    assert_eq!(adapter.health().await.provider, AdapterProvider::EmailEngine);
}
