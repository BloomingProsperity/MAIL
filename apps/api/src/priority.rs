use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct PrioritySignals {
    pub directness: f32,
    pub relationship: f32,
    pub actionability: f32,
    pub urgency: f32,
    pub thread_momentum: f32,
    pub user_context: f32,
    pub noise: f32,
    pub negative_history: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PriorityResult {
    pub score: i32,
    pub bucket: String,
    pub reasons: Vec<String>,
}

pub fn score_message(signals: PrioritySignals) -> PriorityResult {
    let score = 35.0 * clamp01(signals.directness)
        + 25.0 * clamp01(signals.relationship)
        + 20.0 * clamp01(signals.actionability)
        + 15.0 * clamp01(signals.urgency)
        + 10.0 * clamp01(signals.thread_momentum)
        + 10.0 * clamp01(signals.user_context)
        - 35.0 * clamp01(signals.noise)
        - 25.0 * clamp01(signals.negative_history);

    let mut reasons = Vec::new();
    if signals.directness >= 0.75 {
        reasons.push("直接发给你".to_string());
    }
    if signals.relationship >= 0.75 {
        reasons.push("你常回复此发件人".to_string());
    }
    if signals.actionability >= 0.75 {
        reasons.push("Hermes 识别为需要回复".to_string());
    }
    if signals.urgency >= 0.75 {
        reasons.push("今天 17:00 截止".to_string());
    }
    if signals.user_context >= 0.65 {
        reasons.push("来自项目标签".to_string());
    }
    if signals.noise >= 0.65 {
        reasons.push("newsletter / bulk sender 扣分".to_string());
    }
    if signals.negative_history >= 0.65 {
        reasons.push("你过去常忽略此类邮件".to_string());
    }

    let rounded = score.round() as i32;
    let bucket = if signals.noise >= 0.72 {
        "P6 Feed"
    } else if signals.negative_history >= 0.85 && rounded < 20 {
        "P7 Screen"
    } else if rounded >= 90 || signals.urgency >= 0.85 {
        "P1 Urgent"
    } else if rounded >= 68 {
        "P2 Important"
    } else if signals.actionability >= 0.7 {
        "P3 Needs Action"
    } else {
        "P4 FYI / Updates"
    };

    PriorityResult {
        score: rounded,
        bucket: bucket.to_string(),
        reasons,
    }
}

fn clamp01(value: f32) -> f32 {
    value.clamp(0.0, 1.0)
}
