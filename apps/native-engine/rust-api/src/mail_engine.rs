use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AdapterProvider {
    EmailEngine,
    Native,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EmailEngineAdapterConfig {
    pub base_url: String,
    pub webhook_secret: String,
}

#[derive(Debug, Clone)]
pub struct MailEngineAdapter {
    provider: AdapterProvider,
    config: EmailEngineAdapterConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EngineHealth {
    pub provider: AdapterProvider,
    pub ok: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CreateAuthSessionInput {
    pub provider: String,
    pub redirect_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AuthSession {
    pub id: Uuid,
    pub authorize_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AuthCallbackInput {
    pub code: String,
    pub state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ImapSmtpAccountInput {
    pub email: String,
    pub imap_host: String,
    pub smtp_host: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConnectedAccount {
    pub id: Uuid,
    pub email: String,
    pub provider: String,
    pub sync_state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConnectionTest {
    pub ok: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SyncOptions {
    pub since: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ResyncScope {
    pub mailbox_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SyncJob {
    pub id: Uuid,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SyncState {
    pub account_id: String,
    pub status: String,
    pub last_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Mailbox {
    pub id: String,
    pub name: String,
    pub role: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ListMessagesInput {
    pub account_id: String,
    pub mailbox_id: Option<String>,
    pub page_size: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Page<T> {
    pub items: Vec<T>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MessageSummary {
    pub id: String,
    pub subject: String,
    pub sender: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GetMessageInput {
    pub account_id: String,
    pub message_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MessageFull {
    pub id: String,
    pub subject: String,
    pub body_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AttachmentStream {
    pub filename: String,
    pub content_type: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GetAttachmentInput {
    pub account_id: String,
    pub attachment_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MessageMutationInput {
    pub account_id: String,
    pub message_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MoveMessageInput {
    pub account_id: String,
    pub message_id: String,
    pub mailbox_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LabelMutationInput {
    pub account_id: String,
    pub message_id: String,
    pub labels: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SendMessageInput {
    pub from: String,
    pub to: Vec<String>,
    pub subject: String,
    pub body_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SendResult {
    pub message_id: String,
    pub queued: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DraftInput {
    pub from: String,
    pub to: Vec<String>,
    pub subject: String,
    pub body_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Draft {
    pub id: Uuid,
    pub subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MailEngineEvent {
    pub event_type: String,
    pub account_id: Option<String>,
    pub message_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WebhookRequest {
    pub signature: Option<String>,
    pub body: String,
}

#[derive(Debug, Error)]
pub enum AdapterError {
    #[error("adapter method is not wired to EmailEngine yet")]
    NotWired,
}

pub type AdapterResult<T> = Result<T, AdapterError>;

impl MailEngineAdapter {
    pub fn emailengine(config: EmailEngineAdapterConfig) -> Self {
        Self {
            provider: AdapterProvider::EmailEngine,
            config,
        }
    }

    pub fn provider(&self) -> AdapterProvider {
        self.provider
    }

    pub async fn health(&self) -> EngineHealth {
        EngineHealth {
            provider: self.provider,
            ok: !self.config.base_url.is_empty(),
            detail: format!("adapter boundary ready: {}", self.config.base_url),
        }
    }

    pub async fn create_auth_session(
        &self,
        input: CreateAuthSessionInput,
    ) -> AdapterResult<AuthSession> {
        Ok(AuthSession {
            id: Uuid::new_v4(),
            authorize_url: format!(
                "{}/oauth?provider={}&redirect={}",
                self.config.base_url, input.provider, input.redirect_url
            ),
        })
    }

    pub async fn complete_auth_callback(
        &self,
        input: AuthCallbackInput,
    ) -> AdapterResult<ConnectedAccount> {
        Ok(ConnectedAccount {
            id: Uuid::new_v4(),
            email: format!("{}@pending.local", input.state),
            provider: "oauth".to_string(),
            sync_state: "reauth_required".to_string(),
        })
    }

    pub async fn add_password_account(
        &self,
        input: ImapSmtpAccountInput,
    ) -> AdapterResult<ConnectedAccount> {
        Ok(ConnectedAccount {
            id: Uuid::new_v4(),
            email: input.email,
            provider: "imap_smtp".to_string(),
            sync_state: "queued".to_string(),
        })
    }

    pub async fn test_connection(&self, account_id: String) -> AdapterResult<ConnectionTest> {
        Ok(ConnectionTest {
            ok: !account_id.is_empty(),
            message: "connection test queued".to_string(),
        })
    }

    pub async fn start_sync(&self, _account_id: String, _opts: Option<SyncOptions>) -> AdapterResult<()> {
        Ok(())
    }

    pub async fn full_resync(
        &self,
        _account_id: String,
        _scope: Option<ResyncScope>,
    ) -> AdapterResult<SyncJob> {
        Ok(SyncJob {
            id: Uuid::new_v4(),
            status: "queued".to_string(),
        })
    }

    pub async fn get_sync_state(&self, account_id: String) -> AdapterResult<SyncState> {
        Ok(SyncState {
            account_id,
            status: "idle".to_string(),
            last_cursor: None,
        })
    }

    pub async fn list_mailboxes(&self, _account_id: String) -> AdapterResult<Vec<Mailbox>> {
        Ok(vec![
            Mailbox {
                id: "inbox".to_string(),
                name: "收件箱".to_string(),
                role: "inbox".to_string(),
            },
            Mailbox {
                id: "sent".to_string(),
                name: "已发送".to_string(),
                role: "sent".to_string(),
            },
        ])
    }

    pub async fn list_messages(
        &self,
        _input: ListMessagesInput,
    ) -> AdapterResult<Page<MessageSummary>> {
        Ok(Page {
            items: Vec::new(),
            next_cursor: None,
        })
    }

    pub async fn get_message(&self, input: GetMessageInput) -> AdapterResult<MessageFull> {
        Ok(MessageFull {
            id: input.message_id,
            subject: "pending mirror message".to_string(),
            body_text: String::new(),
        })
    }

    pub async fn get_attachment(
        &self,
        input: GetAttachmentInput,
    ) -> AdapterResult<AttachmentStream> {
        Ok(AttachmentStream {
            filename: input.attachment_id,
            content_type: "application/octet-stream".to_string(),
            bytes: Vec::new(),
        })
    }

    pub async fn mark_read(&self, _input: MessageMutationInput) -> AdapterResult<()> {
        Ok(())
    }

    pub async fn star(&self, _input: MessageMutationInput) -> AdapterResult<()> {
        Ok(())
    }

    pub async fn archive(&self, _input: MessageMutationInput) -> AdapterResult<()> {
        Ok(())
    }

    pub async fn move_message(&self, _input: MoveMessageInput) -> AdapterResult<()> {
        Ok(())
    }

    pub async fn trash(&self, _input: MessageMutationInput) -> AdapterResult<()> {
        Ok(())
    }

    pub async fn apply_labels(&self, _input: LabelMutationInput) -> AdapterResult<()> {
        Ok(())
    }

    pub async fn send_message(&self, input: SendMessageInput) -> AdapterResult<SendResult> {
        Ok(SendResult {
            message_id: format!("queued:{}", input.subject),
            queued: true,
        })
    }

    pub async fn create_draft(&self, input: DraftInput) -> AdapterResult<Draft> {
        Ok(Draft {
            id: Uuid::new_v4(),
            subject: input.subject,
        })
    }

    pub async fn normalize_webhook(
        &self,
        input: serde_json::Value,
    ) -> AdapterResult<Vec<MailEngineEvent>> {
        let event_type = input
            .get("event")
            .and_then(|value| value.as_str())
            .unwrap_or("unknown")
            .to_string();

        Ok(vec![MailEngineEvent {
            event_type,
            account_id: input
                .get("account")
                .and_then(|value| value.as_str())
                .map(ToOwned::to_owned),
            message_id: input
                .get("message")
                .and_then(|value| value.as_str())
                .map(ToOwned::to_owned),
        }])
    }

    pub async fn verify_webhook(&self, input: WebhookRequest) -> bool {
        match input.signature {
            Some(signature) => signature == self.config.webhook_secret,
            None => self.config.webhook_secret.is_empty(),
        }
    }
}
