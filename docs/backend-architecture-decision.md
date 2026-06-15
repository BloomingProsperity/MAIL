# Backend Architecture Decision

## Decision

Email Hub MVP uses a TypeScript/Node backend for the API and worker, with EmailEngine as the first mail protocol provider. Rust is not the main API language for the MVP; it remains a later sidecar option for native mail engine work, local search, or desktop-focused performance pieces.

## Why TypeScript/Node Now

- EmailEngine is already the fastest route for Gmail, Outlook, IMAP/SMTP, webhooks, and Docker self-hosting.
- The immediate backend work is orchestration: OAuth onboarding, webhook ingest, queueing, Postgres mirroring, CSV import, priority scoring, and Hermes skill calls.
- TypeScript keeps API contracts close to the React frontend and lowers delivery cost for product iteration.
- Rust would be useful later, but the current Rust code is mostly a contract sketch with no real EmailEngine HTTP, database, OAuth, or queue path.

## Service Split

- `apps/api-node`: public API, health routes, EmailEngine webhook verification, normalized event boundary.
- `apps/worker-node`: background job process for sync, mirror, Hermes, and import lanes.
- `apps/web`: React/Vite frontend, unchanged by this backend decision.
- `apps/api` and `apps/worker`: legacy Rust skeleton kept as reference until replaced or moved into a native sidecar spike.
- `emailengine`: external provider in Docker for MVP mail protocol handling.
- `postgres`: canonical app mirror for accounts, messages, states, classifications, Hermes, aliases, and domains.

## Runtime Ledger

API and worker logs are structured JSON lines. Runtime code should use the
shared logger rather than `console.log`; log entries include timestamp, level,
service, and event name. API request logs must include `requestId`, sanitized
path, status code, and duration, and every API response must echo the
`x-request-id` header. Logger sanitization redacts credentials, tokens,
cookies, authorization headers, and sensitive query parameters before writing
stdout. Docker passes `LOG_LEVEL` to both API and worker so production debugging
can be raised to `debug` without rebuilding images.

The API now ingests EmailEngine webhooks through a provider-neutral boundary:

```text
verify signature
-> normalize notification
-> derive delivery idempotency key from X-EE-Wh-Event-Id, payload eventId, or stable raw payload hash
-> insert mail_engine_events by delivery idempotency_key
-> enqueue sync_jobs by job idempotency
-> return 202 quickly
```

The webhook handler must not fetch messages, advance cursors, or run provider mutations inline. Unknown provider notifications are stored as `unknown_notification` events instead of being treated as normal sync facts.

All API request bodies are bounded before route parsing. The default limit is
1 MiB and oversized requests return `413 request_body_too_large` before
webhook ingestion or any business service is called. This protects webhook,
CSV, Hermes, onboarding, and mutation routes from unbounded memory growth
during high-volume self-hosted deployments.

`mail_engine_events.idempotency_key` represents a webhook delivery/event
instance, not a message resource. Do not build it from only
`account + normalized kind + provider_message_id`: the same message can emit
`messageNew`, `messageUpdated`, flags, and labels changes that must all enqueue
work. Exact webhook redelivery should dedupe through `X-EE-Wh-Event-Id`,
payload `eventId`, or the stable payload hash fallback.
The API test suite includes a burst test that sends 64 concurrent deliveries
with the same EmailEngine event id; only one event and one sync job may remain.

EmailEngine message identity is stored separately from delivery idempotency.
`provider_message_id` remains the EmailEngine API locator from `data.id`.
`provider_email_id` stores EmailEngine `emailId` when available and is the
preferred cross-folder resource signal. `rfc_message_id` stores the RFC
`Message-ID` header and must not be used as an EmailEngine API locator or a
hard uniqueness constraint. `provider_uid + provider_path` stores IMAP
folder-scoped identity. The normalized event also carries
`resourceIdentity` with explicit names:

```text
emailengineMessageId -> EmailEngine /message/:id locator
emailengineEmailId   -> stable cross-folder EmailEngine resource id when available
internetMessageId    -> RFC Message-ID header, useful for high-confidence dedupe only
imapUid + mailboxPath -> IMAP folder-scoped fallback
resourceKey          -> app-level lookup key, not a webhook idempotency key
```

`sync_jobs.payload.resourceIdentity` is the worker handoff contract. The
EmailEngine worker must fetch and delete using `emailengineMessageId`; it
must never call EmailEngine with `internetMessageId`.

The EmailEngine mirror path keeps `messages.provider_message_id` as the current
EmailEngine API locator, not the canonical cross-folder identity. When fetched
messages include `emailId`, `apps/worker-node` first looks up
`provider_message_refs.emailengine_email_id` and updates the existing local
message instead of inserting a duplicate. When `emailId` is missing, it falls
back to the old `provider_message_id` path. RFC `internetMessageId` is stored
on both `messages` and provider refs as a search/dedupe signal, but it remains
a non-unique fallback.

EmailEngine `messageDeleted` is a provider/ref fact, not always a canonical
message deletion. EmailEngine can emit `messageDeleted` for the source folder
of a move, followed by `messageNew` for the destination folder. The worker
therefore always records a provider tombstone, only marks `message_state`
deleted through the deleted EmailEngine locator, and clears
`message_state.deleted_at` whenever the same canonical message is seen again.
Full folder-level truth should move to `message_locations`; until then, do not
treat a single old provider locator disappearing as proof that the user-facing
message is gone.

`message_locations` is now the first folder visibility ledger. `messageNew` /
message upsert writes the seen mailbox path into `message_locations` after
mailboxes have been mirrored. `messageDeleted` with a mailbox path removes only
that old mailbox location, then marks the canonical message deleted only when
no locations remain. A delete event without mailbox path is treated as a
tombstone only; the worker must not guess which folder disappeared.

The API exposes the first read-only mailbox surface from Postgres mirror data:

```text
GET /api/accounts/:accountId/mailboxes
GET /api/accounts/:accountId/messages?mailboxId=:mailboxId&limit=50
GET /api/accounts/:accountId/messages?sort=smart
GET /api/messages?sort=smart&limit=50
GET /api/accounts/:accountId/messages/:messageId
```

These routes must only return local app DTOs. They use local `mailboxes.id` and
`messages.id`, filter visible messages through `message_locations`, and exclude
`message_state.deleted_at` rows. They must not call EmailEngine or expose
`provider_message_id`, EmailEngine `emailId`, raw provider payloads, or mailbox
paths as product API identifiers.
`/api/messages` is the global aggregated list used by the main Smart Inbox; it
omits the account filter and returns visible, non-deleted messages across all
connected accounts. Account-scoped routes remain the boundary for drilling into
one Gmail, Outlook, iCloud, IMAP, or domain mailbox group.

Message list DTOs include app-owned Smart Inbox classification:
`classification.bucket`, `classification.priorityScore`, and
`classification.reasons`. Default list order is `(received_at DESC, id DESC)`.
`sort=smart` orders by `(priority_score DESC, received_at DESC, id DESC)` from
`message_classification` and encodes `priorityScore` into the opaque cursor.
Smart cursors without a priority score are rejected so switching sort modes
cannot silently repeat or skip messages. Hermes may generate summaries and
reason text, but the product API sorts only by stored, inspectable
classification rows.

When a search query includes the body scope, message list DTOs may also include
`searchPreview` generated from local `search_documents.raw_text` with Postgres
`ts_headline`. This preview is app-owned indexed text, not a provider payload,
and it lets the web app and Hermes show why a body or attachment match was
returned. Sender/subject-only searches do not generate body previews or touch
the `search_documents.document` predicate.

`apps/worker-node/src/smart-inbox/classifier.ts` owns the first rules-based
classification pass. The EmailEngine mirror store calls it after every message
upsert and writes `message_classification` with `classified_by='rules'`. This
baseline intentionally favors direct, urgent, actionable customer mail and
pushes newsletters/bulk senders down. Before writing classification, the mirror
store also reads `smart_inbox_sender_rules` with case-insensitive sender
matching so "always important" and muted sender feedback applies to future
mail. Future Hermes memory and feedback loops should update the same table or
create reviewed rule candidates; they must not replace the app DTO with opaque
model output.

The API exposes the first Smart Inbox correction loop:

```text
POST /api/accounts/:accountId/messages/:messageId/smart-inbox/feedback
```

Accepted actions are `mark_important`, `mark_not_important`, `move_to_feed`,
`always_important_sender`, and `mute_sender`. The route verifies the message is
visible for the account, writes `feedback_events`, updates
`message_classification` with `classified_by='user_feedback'`, and stores
sender rules for "always important" or muted senders. This creates an explicit
learning trail for Hermes and future rule suggestion without making sorting an
uninspectable model decision.

Every accepted Smart Inbox feedback event also inserts a Hermes
`contact_memory` scoped as `sender:<email>`. The memory content records the
feedback event id, account id, message id, sender, action, resulting bucket,
score, and a short preference string. Strong sender-level actions
(`always_important_sender`, `mute_sender`) use higher confidence than one-off
message corrections. This keeps user habit learning explicit and editable
through `/api/hermes/memories`.

The API now exposes the first provider-neutral message action surface:

```text
POST /api/accounts/:accountId/messages/:messageId/actions
-> action: mark_read, mark_unread, star, unstar, archive, trash, move, apply_labels
-> verify the local message belongs to the account and is visible
-> update message_state, message_locations, or label_assignments locally
-> insert idempotent engine_commands row for provider sync
-> return app-owned state snapshot and command status
```

This is the organizing backbone for Spark-like archive, trash, move, star, and
label workflows. It is intentionally app-first: local DTOs update immediately,
while provider mutation execution can be retried by a worker and later routed
to EmailEngine or Native Engine. Routes accept only local message, mailbox, and
label ids. They must not accept EmailEngine message ids, raw provider mailbox
paths, SMTP credentials, or provider payloads from the web app.

The worker now consumes the `engine_commands` outbox with the same durability
contract as sync jobs:

```text
engine_command
-> claim queued or expired running command with FOR UPDATE SKIP LOCKED
-> keep one unexpired running command per account
-> resolve local message/mailbox/label ids to provider refs
-> EmailEngine: update flags/labels, move, or delete the provider message
-> Native Gmail: messages.modify / messages.trash
-> Native Graph: PATCH message / move message
-> success: status=done, completed_at
-> failure: queued with capped exponential backoff, then dead_letter
```

EmailEngine command execution uses the official Message API: `PUT
/v1/account/:account/message/:message` for flags and labels, `PUT
/v1/account/:account/message/:message/move` for mailbox moves, and `DELETE
/v1/account/:account/message/:message?force=false` for trash. The dispatcher
does not accept provider ids from the web app; it resolves them from
`provider_message_refs`, `provider_mailbox_refs`, and local labels.

Native command execution is now active for Gmail and Microsoft Graph accounts:

```text
Gmail mark read/unread/star/unstar/archive/apply labels
-> POST /gmail/v1/users/me/messages/:id/modify

Gmail trash
-> POST /gmail/v1/users/me/messages/:id/trash

Graph mark read/unread/star/unstar/categories
-> PATCH /v1.0/me/messages/:id

Graph move/archive/trash
-> POST /v1.0/me/messages/:id/move
```

Graph category application first reads existing `categories` and appends local
label names so applying a label does not drop existing Outlook categories.
Native IMAP command execution remains a later slice because flag, folder, and
UIDVALIDITY behavior need a separate IMAP mutation engine.

The API exposes the first sync center read model:

```text
GET /api/sync-center/accounts
-> list connected_accounts with latest sync_jobs status
-> derive nextAction: none, wait_for_sync, fix_sync_error, or reauthorize

GET /api/sync-center/reauthorizations
-> list pending/failed OAuth or transfer-import onboarding_tasks
-> return only safe payload fields needed to resume authorization
```

These routes are read-only status surfaces for the future Sync Center UI. They
must not call EmailEngine, start jobs, mutate account state, or read
`stored_secrets` / `account_credentials`. The UI should use these DTOs instead
of inferring status from raw task JSON, provider payloads, or EmailEngine Redis.

The API also exposes the first recovery actions for those tasks:

```text
POST /api/sync-center/reauthorizations/:taskId/oauth/start
-> verify the task is pending/failed and recoverable
-> update the same onboarding_tasks row with fresh state and redirectUri
-> return provider authorizationUrl

POST /api/sync-center/reauthorizations/:taskId/imap-smtp
-> verify the task is pending/failed and recoverable
-> accept a fresh authorization code or app-specific password
-> register the account through EmailEngine
-> complete the original task and enqueue initial_bootstrap sync
```

Recovery must reuse the existing task instead of creating a new task. OAuth
callback completion still uses the normal OAuth callback path, which upserts
`connected_accounts` by `(email, provider)` and then enqueues sync. IMAP/SMTP
recovery must never write the submitted secret into task JSON or return it in a
response; only EmailEngine registration receives it.

IMAP/SMTP recovery failures return the same provider-specific diagnostics as
Add Mail connection tests: QQ and 163 authorization-code requirements, iCloud
app-specific passwords, Proton Bridge reachability, or generic server and
credential recovery actions. The API records
`reauthorization_imap_smtp_failed` operational events in the
`account_reauthorization` lane with redacted errors and diagnostics, so Sync
Center can show the next action without exposing app passwords or
authorization codes.

Sync Center also owns account-level sync control actions:

```text
POST /api/sync-center/accounts/:accountId/resync
-> enqueue sync_account with payload kind=manual_resync
-> return an existing queued/running sync_account for the account instead of duplicating it

POST /api/sync-center/accounts/:accountId/pause
-> set connected_accounts.sync_state=paused

POST /api/sync-center/accounts/:accountId/resume
-> set connected_accounts.sync_state=syncing

POST /api/sync-center/accounts/:accountId/retry-failed
-> reset failed/dead_letter sync_jobs to queued with attempts=0
-> do nothing while the same account already has queued/running sync work
```

The worker must read `connected_accounts.sync_state` before dispatching a
`sync_account` job and skip paused accounts without calling EmailEngine or a
native provider. Manual resync and retry actions must not read credentials,
tokens, app passwords, raw provider payloads, or EmailEngine Redis state.
Retrying old failed jobs must preserve the one-active-sync-per-account rule
instead of creating duplicate account sync pressure. Manual resync has the same
stampede guard: repeated clicks reuse the current active sync job for that
account.

`apps/worker-node` consumes `sync_jobs` with a durable claim/lease loop:

```text
claim due queued job or expired running lease
-> set status=running, lease_owner, lease_expires_at, attempts+1
-> run the job handler
-> success: status=done, completed_at
-> failure: queued with backoff, or dead_letter after max_attempts
```

This keeps retry state in Postgres, not in EmailEngine Redis or process memory. The in-memory and Postgres queue implementations now share the same retry contract: a job can retry through `max_attempts`, uses exponential backoff capped at 15 minutes, and dead-letters only on the exhausted attempt.

Worker concurrency is account-aware. A worker may claim several jobs in one
tick through `WORKER_CONCURRENCY`, but the queue skips queued jobs for an
account that already has an unexpired running lease. This prevents two jobs
from advancing the same account cursor at the same time while still allowing
different accounts to sync in parallel. The worker poller also skips overlapping
ticks so a slow provider call cannot multiply effective concurrency beyond the
configured batch size.

The worker consumes `sync_jobs` when `DATABASE_URL` is configured. It now resolves each `sync_account` job through `connected_accounts` and `account_provider_settings`:

```text
sync_account job
-> load local account sync plan
-> sync_state=paused: skip provider calls
-> engine_provider=emailengine: run EmailEngine handler
-> engine_provider=native + native_provider=gmail: run native processor
-> invalid/missing/conflicting settings: fail the job for retry and diagnostics
```

EmailEngine API calls use `/v1/account/:account/mailboxes`,
`/v1/account/:account/messages`, and `/v1/account/:account/message/:message`
with Bearer authentication. If `EMAILENGINE_ACCESS_TOKEN` is missing, the
worker still starts so future native accounts are not blocked, but EmailEngine
account jobs fail with a clear configuration error until the token is set.
Self-hosted Docker deployments must also pass `EENGINE_PREPARED_TOKEN` to the
EmailEngine service so the container imports the same raw token during
unattended startup. `EMAILENGINE_ACCESS_TOKEN` is the raw token used by Email
Hub API and worker clients; `EENGINE_PREPARED_TOKEN` is the EmailEngine-imported
representation of that token.
The bundled Redis service uses RDB snapshots and `maxmemory-policy noeviction`;
evicting EmailEngine keys is treated as data loss because it can discard mail
sync state, credentials, or indexes and force expensive re-syncs.
Docker compose health checks gate the startup chain: EmailEngine waits for
Redis, API and worker wait for a healthy EmailEngine plus completed migrations,
and the web container waits for a healthy API. The public `GET /health` route
is an API readiness check: production wiring runs a Postgres `SELECT 1` and
returns `503` with `checks.database="unavailable"` when the database is not
reachable. Unit tests may omit this dependency probe when they only need route
process health.

`GET /api/mail-engine/health` reports capability-level readiness instead of a
single vague boolean. It returns `urlConfigured`, `accessTokenConfigured`,
`imapSmtpOnboarding`, `attachmentDownload`, `send`, and a `missing` list such as
`["EMAILENGINE_ACCESS_TOKEN"]`. The response must never include token values.
This lets Docker users see why 163/QQ/iCloud/Proton Bridge onboarding is not
available even when the API and EmailEngine containers are running.

IMAP/SMTP onboarding routes must surface the same configuration boundary. When
`EMAILENGINE_ACCESS_TOKEN` is missing, both `/api/accounts/imap-smtp/test` and
`/api/accounts/imap-smtp` return `503 emailengine_configuration_required` with
`capability="imap_smtp_onboarding"` and the missing environment variable list.
If the token is configured but the onboarding service is not wired, the route
keeps `account_onboarding_unavailable` so deployment configuration errors and
internal wiring bugs remain distinguishable.

EmailEngine initial bootstrap is now paginated instead of webhook-only:

```text
initial_bootstrap sync_account job
-> list and mirror all EmailEngine mailboxes
-> list the first message page for each mailbox with pageSize 50
-> upsert message summaries into Postgres with message_locations
-> enqueue emailengine_mailbox_continuation jobs for nextPageCursor
-> continuation jobs pull one mailbox page at a time
```

Webhook `messageNew` / `messageUpdated` jobs still fetch the single message
with `/message/:id` and do not trigger a full mailbox scan. This keeps the
fast path cheap while allowing newly authorized accounts to backfill large
mailboxes through durable `sync_jobs`.

The API also exposes IMAP/SMTP connection testing and onboarding:

```text
POST /api/accounts/imap-smtp/test
-> resolve provider preset or explicit IMAP/SMTP settings
-> verify credentials through EmailEngine POST /v1/verifyAccount
-> return app-owned check results without creating tasks, accounts, or sync jobs

POST /api/accounts/imap-smtp
-> validate account settings
-> create onboarding_tasks row with redacted payload
-> register the account in EmailEngine through POST /v1/account
-> upsert connected_accounts row
-> enqueue idempotent sync_account initial_bootstrap job
-> return the task, account, and sync job

npm run smoke:imap-smtp-onboarding
-> POST /api/accounts/imap-smtp/test against GreenMail or another test mailbox
-> POST /api/accounts/imap-smtp
-> require the response to include the initial sync job
-> GET /api/sync-center/accounts and require the account plus latest sync job
```

For the Postgres-backed runtime, the local completion step is atomic:
`connected_accounts`, `onboarding_tasks`, and the initial `sync_jobs` row are
written inside one transaction after EmailEngine account registration succeeds.
This prevents a completed local account from existing without the first
bootstrap sync job.

This is the first concrete "Add Mailbox" backend path for 163, QQ, iCloud,
Proton Bridge, and generic personal-domain mailboxes. The test route is meant
for fast UI preflight and support diagnostics; it must not store credentials or
enqueue sync work. Gmail and Outlook OAuth queues remain separate onboarding
paths.

Common IMAP/SMTP providers use backend presets rather than requiring users to
type server hosts on the first screen:

```text
163            -> imap.163.com:993 SSL, smtp.163.com:465 SSL
qq             -> imap.qq.com:993 SSL, smtp.qq.com:465 SSL
icloud         -> imap.mail.me.com:993 SSL, smtp.mail.me.com:587 STARTTLS
proton_bridge  -> 127.0.0.1:1143 STARTTLS, 127.0.0.1:1025 STARTTLS
```

The API accepts `email`, optional `username`, and `secret` for these presets.
163 and QQ use authorization codes. iCloud uses an Apple app-specific password.
Proton support is explicitly Bridge-only; it does not promise Proton cloud
direct-connect. If full `imap` and `smtp` settings are provided, the API
respects those explicit settings instead of forcing the preset.

Connection-test failures also return a user-recoverable `diagnostics` array.
The API records the same sanitized diagnostics in operational events so support
can inspect the failed step without exposing app passwords or authorization
codes:

```text
qq_authorization_code_required       -> enable_qq_mail_authorization_code
netease_163_authorization_code_required -> enable_163_mail_authorization_code
icloud_app_specific_password_required   -> create_apple_app_specific_password
proton_bridge_unreachable              -> start_proton_bridge
mail_server_unreachable                -> check_mail_server_connection
mail_credentials_rejected              -> check_mailbox_credentials
```

These messages are intentionally provider-specific. The UI can show the
diagnostic message as the next step while keeping raw protocol names in the
diagnostic log details only.

CSV import is exposed as:

```text
POST /api/accounts/import/csv/preview
POST /api/accounts/import/csv
```

The preview route parses and validates CSV rows without writing. The import
route creates pending onboarding tasks for valid enabled rows and reports
invalid rows without blocking partial success. IMAP/SMTP rows use redacted
payloads and never store secrets in task JSON; Gmail/Outlook OAuth rows become
authorization-queue tasks with `loginHint`.

Account transfer is a configuration handoff, not credential migration:

```text
POST /api/accounts/transfer/export
-> read transfer-safe fields from connected_accounts only
-> return schemaVersion 1 package without token, app password, or secret refs

POST /api/accounts/transfer/import
-> validate schemaVersion 1 package
-> create pending onboarding tasks with reauthRequired=true
-> keep history/index data untouched until the user reauthorizes the account
```

The transfer store must not join `stored_secrets`, `account_credentials`, raw
provider payloads, or EmailEngine Redis state. Import payloads are intentionally
small: provider, email, display name, group/labels/notes, engine provider, and
optional provider preset or username. OAuth accounts get `loginHint`; password
accounts still require a fresh authorization code or app-specific password.

Alias and domain management now has a backend control plane:

```text
GET  /api/domains
POST /api/domains
POST /api/domains/:domainId/destinations
GET  /api/domains/:domainId/aliases
POST /api/domains/:domainId/aliases
PUT  /api/domains/:domainId/catch-all
GET  /api/domains/:domainId/delivery-logs?limit=50
```

The API owns domains, DNS guidance, destination addresses, alias routes,
catch-all rules, and delivery-log reads. It is intentionally not a full MTA:
the first slice does not receive MX traffic, run spam filtering, or perform
provider delivery. `0016_domain_alias_indexes.sql` adds the unique catch-all
rule index and read-path indexes so future `mx-gateway` and `alias-router`
workers can attach without changing the control-plane contract.

The worker now has alias routing primitives in `apps/worker-node/src/alias-routing`:

```text
inbound recipient + message fingerprint
-> exact alias match
-> catch-all fallback
-> delivery_logs audit events
-> idempotent alias_delivery_jobs rows
```

`0017_alias_delivery_jobs.sql` creates the durable job table with unique
`idempotency_key`, lease metadata, attempt counts, retry scheduling, and
dead-letter status. The router does not send SMTP itself; it prepares a
deduplicated delivery queue that a later delivery worker can claim with
`FOR UPDATE SKIP LOCKED`, complete, retry, or dead-letter.

The worker now includes an `alias_delivery` lane. `alias-delivery-runner`
claims `alias_delivery_jobs`, calls a configured delivery transport, writes
`delivery_logs`, and completes or fails the lease. `ALIAS_DELIVERY_WEBHOOK_URL`
enables the HTTP handoff transport for an external forwarding service. If it is
unset, the worker does not claim alias delivery jobs; this prevents retry churn
and keeps the queue ready until a real forwarder is configured.

The API now has the first native OAuth onboarding path:

```text
POST /api/accounts/oauth/:provider/start
-> create onboarding task and state
-> return provider authorizationUrl

GET /api/accounts/oauth/:provider/callback?state=...&code=...
-> exchange code at provider token endpoint
-> fetch provider profile email
-> store refresh token in stored_secrets as db:...
-> write connected_accounts, account_credentials, and account_provider_settings
-> enqueue idempotent sync_account native_folder_discovery job
```

Gmail and Outlook OAuth do not call EmailEngine. They create native accounts:
Gmail uses native provider `gmail`, Outlook uses native provider `graph`.
The first queued job discovers provider mailboxes before any folder bootstrap,
so newly connected OAuth accounts do not silently sync only the default Inbox.

The left navigation now has a backend-owned summary endpoint:

```text
GET /api/mail-navigation/summary
-> group connected_accounts into Gmail, Outlook, iCloud, 163 / QQ, Proton, and personal-domain families
-> count common quick categories such as verification codes, receipts, shipping, travel, notifications, newsletters, and social mail
```

The frontend consumes this endpoint for the Add Mail provider list and common
mail categories, so adding accounts and mirroring messages can update the
navigation without hard-coded UI counts.

Hermes now has a backend skill registry in `apps/api-node` with translation as
a first-class built-in skill:

```text
GET  /api/hermes/skills
POST /api/hermes/skills/translate_text/run
POST /api/hermes/translation-preferences
POST /api/hermes/skills/email_search_qa/run
POST /api/hermes/skills/thread_summarize/run
POST /api/hermes/skills/action_item_extract/run
POST /api/hermes/skills/label_suggest/run
POST /api/hermes/skills/priority_triage/run
POST /api/hermes/skills/followup_tracker/run
POST /api/hermes/skills/newsletter_cleanup/run
POST /api/hermes/skills/reply_draft/run
POST /api/hermes/skills/rewrite_polish/run
POST /api/hermes/drafts/feedback
POST /api/hermes/rules/suggest
POST /api/hermes/rules/:candidateId/simulate
POST /api/hermes/rules/:candidateId/approve
```

The Hermes provider catalog is also backend-owned:

```text
GET  /api/hermes/providers
POST /api/hermes/providers/:providerKey/probe
GET  /api/hermes/runtime
PUT  /api/hermes/runtime
POST /api/hermes/runtime/test
GET  /api/hermes/runtime/version
POST /api/hermes/runtime/update/check
```

Each catalog item includes a stable `requestProtocol` so direct model calls do
not depend on URL guessing:

- `openai_chat_completions`: Hermes service, LiteLLM, OpenRouter, Ollama,
  vLLM, LM Studio, llama.cpp, SGLang, LocalAI, and custom gateways.
- `openai_responses`: OpenAI Responses-style providers.
- `anthropic_messages`: Anthropic Messages.
- `gemini_generate_content`: Gemini generateContent.
- `external_oauth` / `aws_bedrock`: listed for configuration, but direct
  health checks return external-auth status instead of pretending to call them.

The UI may show provider names and fields from this catalog, but model secrets
must remain in `stored_secrets`, and frontend code must not call provider APIs
directly.

`POST /api/hermes/runtime/test` returns the selected `providerKey` and
`requestProtocol` together with endpoint and model. The same fields are written
to the operational event context on successful checks, so support logs can tell
whether a failure belongs to Hermes, OpenAI-compatible chat, Responses,
Anthropic, Gemini, or a custom gateway without exposing API keys.

`translate_text` is designed for Spark-like reading and writing workflows:
translate a full message, selected text, or a draft while preserving paragraph
breaks, names, dates, numbers, signatures, and intent.

`POST /api/hermes/translation-preferences` is the explicit learning loop for
"以后都这样" translation behavior. It stores `always` and `never` choices as
editable `procedural_memory` records, for example "translate English to Chinese
by default" or "do not auto-translate Japanese unless asked." Future Hermes
translation calls can load that memory through the same scoped memory context
and audit the memory ids used.

`email_search_qa` is the first search assistant skill. The backend searches
app-owned Postgres message DTOs with `MailReadStore.listMessages` first, using
Smart Inbox ordering by default, then passes only the matched summaries to
Hermes. It returns `answerText`, `searchQuery`, and match summaries. The audit
event records both explicit read message ids and the matched message ids, so
natural-language search remains inspectable.

`thread_summarize` is the first Spark-like read assistant skill. It accepts
subject, thread text, optional focus, language, read message ids, and memory
scope. It returns `summaryText` only, writes a `thread_summarize` skill run,
and records the exact read messages and memory ids used in
`hermes_audit_events`.

`action_item_extract` is the first task assistant skill. It accepts subject,
thread text, language, current time, read message ids, and memory scope. It
asks Hermes for a JSON array and normalizes each item into title, owner,
deadline text, optional ISO deadline, priority, status, and source quote. It
does not create persisted tasks or mutate mail state; that keeps extraction
preview-first until the task API is added.

`label_suggest` is the first organization assistant skill. It accepts subject,
thread text, sender email, current labels, available labels, language, read
message ids, and memory scope. It asks Hermes for a JSON object and normalizes
labels plus preview-only actions such as apply label, keep in inbox, archive,
snooze, move to feed, or mark important. It does not mutate labels, folders, or
message state; mutations remain separate explicit APIs.

`priority_triage` is the first AI priority explanation skill. It accepts
subject, thread text, sender email, current bucket, score, reasons, language,
read message ids, and memory scope. It asks Hermes for a JSON object and
normalizes priority to low, medium, or high; bucket to one of the P0-P7 Smart
Inbox buckets; score to 0-100; plus reasons and optional explanation. It is
preview-only and does not write `message_classification`.

`followup_tracker` is the first follow-up assistant skill. It accepts subject,
thread text, user email, participants, current time, language, read message ids,
and memory scope. It asks Hermes for a JSON object and normalizes status to
`needs_reply`, `waiting_on_them`, `no_followup`, or `done`; owner to `me`,
`them`, or `unknown`; confidence to 0-1; plus reasons, optional deadline,
source quote, and next action. It is preview-only and does not create tasks,
send mail, or mutate mail state.

`newsletter_cleanup` is the subscription and marketing-mail cleanup assistant.
It accepts subject, thread text, sender email, list id, current bucket,
language, read message ids, and memory scope. It asks Hermes for a JSON object
and normalizes classification, confidence, reasons, and preview-only actions
limited to move to Feed, archive, keep in inbox, unsubscribe later, or mark not
important. It does not delete mail, unsubscribe, move messages, or call provider
APIs.

`reply_draft` is the first write-assist skill. It accepts subject, thread text,
optional user instruction, tone, language, read message ids, and memory scope.
It calls Hermes with user memory context and returns editable `draftText`; it
does not create provider drafts and cannot send mail. Sending and persisted
drafts must remain separate API actions so Hermes output stays preview-first.

`rewrite_polish` is the editable draft-improvement skill. It accepts draft
text, action (`rewrite`, `polish`, `shorten`, `expand`, `tone`, or
`proofread`), optional instruction, tone, language, read message ids, and
memory scope. It returns editable `rewrittenText`, records skill and audit
events, and cannot send mail or mutate provider drafts.

The API now owns the first compose/send handoff:

```text
POST /api/accounts/:accountId/compose/drafts
-> validate local recipients and body
-> insert email_drafts row
-> return app-owned draft DTO

POST /api/accounts/:accountId/compose/drafts/:draftId/send
-> load draft with connected account state
-> reject paused, reauth-required, already sent, or failed drafts
-> atomically claim draft by changing status draft -> sending
-> submit through account engine transport
-> mark sent with provider queue/message ids, or failed with sanitized error

POST /api/accounts/:accountId/compose/drafts/:draftId/schedule
GET  /api/accounts/:accountId/outbox
POST /api/accounts/:accountId/outbox/:scheduledId/send-now
PATCH /api/accounts/:accountId/outbox/:scheduledId
DELETE /api/accounts/:accountId/outbox/:scheduledId
-> store scheduled_sends as app-owned outbox rows
-> schedule marks the draft scheduled without provider mutation
-> send-now and due worker execution claim schedule plus draft once
-> failed sends keep retry/dead-letter evidence in Postgres
```

EmailEngine sending is behind `mail-engine/email-engine-submit-client.ts` and
uses `POST /v1/account/:account/submit`. The web app gets only Email Hub draft
ids and local DTOs. It must not receive EmailEngine request bodies, queue
internals, SMTP credentials, or raw provider payloads.

The worker includes a `scheduled_send` lane. It claims due `scheduled_sends`
with `FOR UPDATE SKIP LOCKED`, applies a lease, submits through the same
transport contract, and clears or reschedules the lease based on provider
success or failure. This keeps Send Later durable across Docker restarts.

`POST /api/hermes/drafts/feedback` records how the user edited a generated
reply draft. The route requires a `reply_draft` skill run id, original draft,
and final text. It writes `hermes_feedback` for the audit trail. If the final
text differs meaningfully, it also writes a `writing_style_profile` memory with
deterministic revision signals such as shorter wording or removed formal
sign-off. This is the first non-model habit-learning loop for writing style.

Hermes rule learning is the first reviewed workflow-learning loop:

```text
POST /api/hermes/rules/suggest
-> read repeated Smart Inbox feedback for one account
-> create hermes_rule_candidates with status shadow and evidence message ids

POST /api/hermes/rules/:candidateId/simulate
-> match recent visible messages by candidate condition
-> write hermes_rule_runs in shadow mode
-> return sample message ids and action preview

POST /api/hermes/rules/:candidateId/approve
-> mark candidate approved
-> create enabled hermes_rules row
```

This is intentionally not a black-box automation engine. Suggestions are based
on app-owned feedback events, shadow simulation does not mutate mail, and only
explicit approval enables a rule. Later worker slices may read `hermes_rules`
to influence classification, but sending, moving, and deleting mail remain
separate explicit action APIs.

The worker now consumes approved Hermes classification rules during message
mirroring:

```text
upsert mirrored message
-> load smart_inbox_sender_rules for account + sender
-> load enabled hermes_rules where condition.senderEmail matches sender
-> classifySmartInboxMessage(...)
-> upsert message_classification with classified_by='hermes_rules' when applied
```

Only `action.type='classify_sender'` is honored. The worker applies bucket,
priority score, and reason text to app-owned `message_classification`; it does
not move, delete, archive, label, send, or call any provider APIs from a Hermes
rule.

Hermes provider access is hidden behind a backend boundary:

```text
POST /api/hermes/skills/translate_text/run
POST /api/hermes/translation-preferences
POST /api/hermes/skills/email_search_qa/run
POST /api/hermes/skills/thread_summarize/run
POST /api/hermes/skills/action_item_extract/run
POST /api/hermes/skills/label_suggest/run
POST /api/hermes/skills/priority_triage/run
POST /api/hermes/skills/followup_tracker/run
POST /api/hermes/skills/newsletter_cleanup/run
POST /api/hermes/skills/reply_draft/run
-> create Hermes prompt
-> call HERMES_CHAT_COMPLETIONS_URL
-> write hermes_skill_runs
-> write hermes_audit_events with skill_run_id, read_message_ids, memory_ids
```

This endpoint is intentionally Hermes-compatible and model-agnostic. The web
app never receives provider keys and should not call OpenAI, Ollama, OpenRouter,
or model APIs directly. When `DATABASE_URL` is available, the API persists skill
runs and audit events through `PostgresHermesRunStore`; without a database it
can still run against a configured Hermes endpoint for local smoke testing.

Hermes runtime configuration is backend-owned. `/api/hermes/providers` exposes
the provider catalog for Settings, `/api/hermes/runtime` stores the selected
provider key, endpoint URL, model, API-key secret ref, and update policy, and
`/api/hermes/providers/:provider/probe` performs sanitized connection checks.
The catalog includes Hermes, gateway routes such as OpenRouter and LiteLLM,
direct cloud providers, and local endpoints such as Ollama, vLLM, LM Studio,
llama.cpp, SGLang, and LocalAI. Chat Completions remains the default transport;
`/v1/responses` endpoints are detected and called with a Responses-compatible
payload.
The runtime HTTP provider also speaks native Anthropic Messages and Gemini
generateContent transports when the selected provider requires them. Known
native providers may define default endpoints or model-based endpoint
templates in the backend catalog, so Settings can ask for provider, model, and
key without exposing raw API path details. Unknown providers stay supported
through the custom OpenAI-compatible endpoint path. Hermes version/update
status is stored separately from provider credentials; Docker operators remain
in control of when an external Hermes service is actually upgraded.

Hermes memory management is exposed as app-owned Postgres data:

```text
GET    /api/hermes/memories?layer=:layer&scope=:scope&limit=50
PATCH  /api/hermes/memories/:id
DELETE /api/hermes/memories/:id
```

This is the first user-controlled learning surface. Memories can represent
semantic profile facts, writing style preferences, contact/domain preferences,
or procedural workflow hints. The API lets users inspect, update confidence or
content, and delete records before Hermes skills reference them through
`memoryIds`.

Hermes skill execution can now load a small, scoped memory context before
calling the model. `translate_text`, `email_search_qa`, `thread_summarize`,
`action_item_extract`, `label_suggest`, `priority_triage`, `followup_tracker`,
`newsletter_cleanup`, and `reply_draft` accept `memoryScope` and `memoryLayers`, query
`hermes_memories` through the app store boundary, add concise memory lines to
the prompt, and write the exact memory ids used into
`hermes_audit_events.memory_ids`. This keeps user habit learning inspectable:
the model can use preferences, but the audit trail shows which preferences were
read.

When a non-global `memoryScope` is requested, Hermes also loads matching
`global` memories for the same layer set. This lets global writing preferences
and sender/contact-specific preferences work together without hiding which
memory ids were used. Reply draft feedback writes learned writing style to
`recipient:<email>` when a recipient is known, and falls back to `global` only
when no recipient context exists.

`infra/migrations/0002_mail_engine_runtime.sql` adds the durable runtime tables:

- `account_credentials`
- `account_provider_settings`
- `sync_cursors`
- `sync_runs`
- `mail_engine_events`
- `sync_jobs`
- `engine_commands`

`DATABASE_URL` makes `apps/api-node` use the Postgres ingest store. Tests may inject the in-memory store, but production Docker should always use Postgres.

`infra/migrations/0004_stored_secrets.sql` adds `stored_secrets` for private self-hosted deployments. OAuth onboarding writes refresh token material there and stores only `db:...` refs in `account_credentials`. The worker resolves both `env:` and `db:` refs.

`infra/migrations/0005_hermes_runtime.sql` seeds built-in Hermes skills and
links `hermes_audit_events.skill_run_id` back to `hermes_skill_runs`.

`infra/migrations/0006_mail_engine_resource_identity.sql` adds searchable
EmailEngine resource identity columns and the `resource_identity` JSONB mirror
on `mail_engine_events`. These columns are nullable/additive except for the
JSONB default, so old webhook rows and queued jobs remain compatible.

`infra/migrations/0007_emailengine_provider_ref_identity.sql` adds
`provider_message_refs.emailengine_email_id` and `internet_message_id`, plus a
partial unique index for EmailEngine `emailId`. This is the stable ref used to
collapse folder moves where EmailEngine gives the same mail a new API `id`.

`infra/migrations/0008_mail_read_indexes.sql` adds the first read-path indexes
for high-volume inbox use:

- `(account_id, received_at DESC, id DESC)` on `messages`
- `(mailbox_id, message_id)` on `message_locations`
- trigram search indexes for `from_email`, `from_name`, and `snippet`

`infra/migrations/0009_attachment_metadata.sql` extends `attachments` with
inline-image metadata (`content_id`, `embedded`, `inline`,
`encoded_in_message`) and read indexes. This keeps Spark-like attachment chips
and future Hermes attachment reasoning separate from raw EmailEngine payloads.

`infra/migrations/0032_attachment_text_extraction_jobs.sql` adds the durable
queue for attachment body indexing. The EmailEngine mirror store enqueues
searchable non-inline document attachments such as PDF, Office files, CSV, and
plain text with an idempotency key based on account, message, and provider
attachment id. Inline images and oversized attachments are skipped so message
mirroring and list rendering are not blocked by document parsing.

`infra/migrations/0010_message_classification_priority_index.sql` adds the
priority-score index used by Smart Inbox reads. It is intentionally small:
classification remains app-owned data, while visible-message filtering still
runs through `messages`, `message_state`, and `message_locations`.

`infra/migrations/0011_smart_inbox_feedback_rules.sql` adds sender-level Smart
Inbox rules derived from explicit feedback. These rules are not a full
automation engine yet; they are the durable substrate for later Hermes memory,
shadow-mode rule suggestions, and worker-side classification overrides.

`infra/migrations/0012_hermes_memory_indexes.sql` adds the read index for
Hermes memory review by `layer`, `scope`, and `updated_at`.

`infra/migrations/0018_hermes_rule_learning.sql` adds account scope, rule
type, evidence ids, candidate approval metadata, and rule-run candidate links
for Hermes rule learning. It also adds account/status and account/enabled
indexes so suggestions, review lists, and worker reads stay bounded as mail
volume grows.

`infra/migrations/0013_hermes_feedback_indexes.sql` adds the lookup index for
draft feedback by `skill_run_id`, newest first.

`infra/migrations/0014_email_drafts.sql` adds app-owned compose drafts with
recipient JSON, body fields, status, optional Hermes run linkage, and provider
queue/message ids captured only after explicit send.

`apps/api-node/src/mail-read` owns the app-level read API for mailbox folders,
message lists, and message detail. Lists use keyset pagination with opaque
base64url cursors; default cursors contain `receivedAt + id`, while Smart Inbox
cursors contain `priorityScore + receivedAt + id`. Do not add offset pagination
because newly synced mail can cause duplicates or skipped rows. The first `q`
search scope is intentionally small: subject, sender email/name, and snippet.
Full body search should go through the planned search index path, not ad hoc
`body_html` scanning. This API must not expose EmailEngine message ids or raw
provider payloads.

Message detail DTOs include app-owned attachment metadata from `attachments`:
local attachment id, filename, content type, byte size, `contentId`,
`embedded`, and `inline`. The worker replaces the local attachment metadata set
on every message upsert so stale provider attachments disappear after a message
changes. EmailEngine `provider_attachment_id` stays internal and is used later
for lazy download through `/v1/account/:account/attachment/:id`; it must not be
returned in web-facing message DTOs.

Attachment downloads use a local-id boundary:

```text
GET /api/accounts/:accountId/attachments/:attachmentId/download
-> verify local attachment belongs to a visible, non-deleted message in account
-> resolve internal provider_attachment_id
-> stream EmailEngine /v1/account/:account/attachment/:providerAttachmentId
-> return file headers with local filename/content type
```

The API route must never accept or expose EmailEngine attachment ids. Missing
`EMAILENGINE_ACCESS_TOKEN` leaves the route unavailable with a 503 instead of
pretending downloads can run.

Docker Compose includes a `migrate` service based on `postgres:16-alpine`.
`api` and `worker` wait for it to complete, and every SQL file under
`infra/migrations` must stay idempotent. This keeps existing self-hosted
volumes upgradeable instead of relying only on Postgres first-boot init scripts.
Postgres, Redis, and EmailEngine stay on the Docker network by default; only
`api` and `web` publish host ports, configurable with `API_BIND` and `WEB_BIND`.

Postgres transactions must go through `apps/api-node/src/db/transaction.ts`.
When a `pg.Pool` is passed to a store, `withTransaction` checks out one client
with `pool.connect()` and runs every statement on that same connection before
release. Do not run `BEGIN` / `COMMIT` directly on `Pool.query()`.

## Native Engine Path

Native engine work should run in parallel with the EmailEngine MVP, but the first executable slice should be narrow: `NativeSyncProcessor + SyncCursorStore + GmailReadOnlyAdapter`. Gmail is the best first target because its `messageId`, `threadId`, and account-level `historyId` are already modeled, while IMAP immediately requires UIDVALIDITY reset handling, EXPUNGE, flag sync, folder rename, and MIME edge cases.

`apps/worker-node/src/mail-provider/contract.ts` defines the provider-neutral identity contract:

- Gmail message identity: `messageId`, optional `threadId`, optional `historyId`.
- Microsoft Graph message identity: `id`, optional `changeKey`, optional `conversationId`.
- IMAP message identity: mailbox path plus `uidvalidity` plus `uid`, with optional `modseq`.
- Gmail and Graph cursors stay separate from message identity: Gmail uses account-level `historyId`, Graph uses opaque `deltaLink`.
- IMAP cursors are mailbox-scoped and keep large UID/MODSEQ values as strings.
- Provider mailbox identity is first-class: Gmail uses `labelId`, Graph uses
  `folderId`, and IMAP uses mailbox `path` plus optional delimiter. Native sync
  jobs can now carry an explicit mailbox so folder-specific resyncs do not fall
  back to the default inbox.

`infra/migrations/0003_provider_refs.sql` adds provider refs so the app can mirror provider facts without flattening them into `messages.provider_message_id`:

- `provider_mailbox_refs`
- `provider_message_refs`
- `provider_message_tombstones`
- typed cursor columns on `sync_cursors`

The first native engine slice is now test-backed in `apps/worker-node`:

- `sync-cursor-store.ts` reads, upserts, and reset-marks provider cursors in `sync_cursors`.
- `mail-provider/gmail-readonly-adapter.ts` supports recent-message bootstrap,
  explicit Gmail label bootstraps, and Gmail `history.list` incremental changes.
- `mail-provider/native-sync-processor.ts` ties adapters, provider mailbox refs,
  provider message refs, tombstones, and cursor advancement together.
- `mail-provider/native-command-processor.ts` executes native Gmail and Graph
  message mutations from the `engine_commands` outbox while keeping provider
  ids resolved server-side.
- `account-provider-settings-store.ts` loads account sync plans from `connected_accounts` plus `account_provider_settings`.
- `sync-account-dispatcher.ts` routes `sync_account` jobs to EmailEngine or native providers and rejects conflicting settings instead of silently using the wrong adapter.
- Folder-scoped native jobs can include `payload.mailbox`; the dispatcher passes
  it to the native processor, and the processor passes it to the adapter while
  reading the mailbox-scoped cursor when one exists. This keeps explicit folder
  refreshes from accidentally syncing the default folder or restarting from the
  first page unnecessarily.
- Native folder discovery now has a durable queue path:
  `payload.kind='native_folder_discovery'` calls adapter mailbox discovery,
  persists `provider_mailbox_refs`, then enqueues one `folder_resync` job per
  discovered Gmail label or Graph folder. Each folder job carries the explicit
  provider mailbox identity and gets its own idempotency key, retry lifecycle,
  and mailbox-scoped cursor lookup. Microsoft Graph folder discovery follows
  `@odata.nextLink` until exhaustion before queueing folder resync work, so
  large Outlook accounts do not silently miss folders beyond the first page.
- Native provider routing uses an explicit allowlist: `gmail -> gmail`,
  `outlook -> graph`, and `imap -> imap`. This keeps Outlook product naming
  separate from the Microsoft Graph API adapter.
- `google/gmail-api-client.ts` implements the Gmail read-only HTTP boundary with Bearer auth, safe URL construction, page-size caps, and typed 404 errors for expired history cursors.
- `google/oauth-token-client.ts` implements Google OAuth refresh-token exchange with form-encoded requests and sanitized errors that do not leak refresh tokens or client secrets.
- `credentials/account-credential-store.ts` reads only credential metadata and `secret_ref` from `account_credentials`; it never reads secret material.
- `secrets/env-secret-store.ts` resolves `env:NAME` refs for local Docker deployments and keeps unsupported or missing secret errors sanitized.
- `google/access-token-provider.ts` connects credential refs, secret lookup, and Google OAuth refresh without caching or leaking refresh token values.
- `mail-provider/native-adapters.ts` is the worker composition boundary for native adapters. It registers Gmail lazily so the worker can start without Google OAuth config, while Gmail jobs fail with a clear configuration error until `GOOGLE_OAUTH_CLIENT_ID` is configured.
- Microsoft Graph now has the same native read-only path:
  `microsoft/oauth-token-client.ts` refreshes OAuth tokens,
  `microsoft/graph-api-client.ts` calls the Graph message delta endpoint, and
  `mail-provider/graph-readonly-adapter.ts` maps Graph messages/deletions into
  provider refs and tombstones. It can sync the default `inbox` or an explicit
  Graph folder with mailbox-scoped `@odata.nextLink` / `@odata.deltaLink`
  cursors.
- Native pagination uses continuation jobs, not active cursor mutation:
  adapters return `continuation` for intermediate Gmail/Graph pages,
  `NativeSyncProcessor` persists refs/tombstones but does not advance the
  durable cursor while a continuation exists, and `sync-account-dispatcher.ts`
  enqueues another `sync_account` job with `trigger_event_id = NULL`. The
  durable cursor advances only on the final page.

This slice is intentionally read-only. It does not send, mutate labels, download attachments, or own OAuth yet. A Gmail `HTTP 404` history expiry is treated as `gmail_history_expired` and marks the cursor `reset_required` so the next step can schedule a full sync instead of silently skipping mail.

OAuth and provider account identity still need tightening before native sync can run in production:

- `connected_accounts.id` should remain the canonical local account UUID.
- external provider account IDs should live in provider settings or a provider-account-ref table.
- `sync_jobs.account_id` should be migrated away from free-form text or paired with a local UUID.
- Gmail OAuth onboarding should write `auth_method='oauth'`, `engine_provider='native'`, `account_credentials`, and `account_provider_settings`.
- Gmail refresh tokens must be stored per account through `account_credentials.secret_ref`, such as `env:GMAIL_REFRESH_TOKEN_ACC_1`; do not add a global single-account `GOOGLE_REFRESH_TOKEN`.

## Development Server

Local SSH config includes `kaifa`:

```text
Host kaifa
HostName 3.112.56.50
User ubuntu
Port 22
```

The private key path is intentionally not documented here. The connection has been verified with a non-interactive SSH command. Use this host for heavier Docker testing or shared backend development when the local machine is not enough.

## Next Backend Milestones

The next slices should follow the Spark-level chain in
`docs/spark-like-backend-chain.md`, the open source reference pass in
`research/open-source-email-systems.md`, and the Thunderbird/Foxmail product
details in `research/thunderbird-foxmail-actionable-notes.md`. Their
implementation granularity is defined in `docs/backend-micro-chain-spec.md`.
Do not add isolated endpoints unless they complete one of these loops with
trigger, state, DTO, worker, failure, and test coverage.

Current completed slice:

- Hermes Spark parity now includes `quick_reply` and `rewrite_polish` as
  preview-only draft skills, plus `thread_summarize` modes `short`, `detailed`,
  and `action_points`. These paths use the configured Hermes provider boundary,
  persist skill runs, and audit read message and memory usage without sending
  mail directly.
- Smart Inbox accepts `move_to_personal`, `move_to_notifications`, and
  `move_to_newsletters`; it records feedback, updates classification, writes a
  sender rule, and stores Hermes contact memory.
- Message actions accept Spark-style `done`, `undo_done`, and `undone`.
  `done` writes local undo state and queues provider `archive`; `undo_done`
  verifies the local undo token and queues provider `move` back to Inbox;
  `undone` clears done state after the short window and also queues provider
  `move`.
- Smart Inbox card bulk Done now has an API boundary:
  `POST /api/accounts/:accountId/smart-inbox/cards/:bucket/actions` with
  `action="done"` and explicit local `messageIds`. The service deduplicates the
  visible list, caps a batch at 50 ids, applies the same single-message Done
  path, and returns succeeded/failed rows instead of expanding hidden search
  results or accepting provider ids.
- Attachment text extraction jobs are queued during EmailEngine message
  mirroring for searchable document attachments. Actual download, parsing, and
  parser wiring remain the next worker slice; the Postgres extraction store can
  already claim jobs with leases, retry/dead-letter failures, and merge
  extracted text back into `search_documents`.
- Migration `0019_message_done_undo.sql` adds `done_at`,
  `last_action_token`, and `undo_expires_at` to `message_state`.

1. Smart Inbox bulk/category loop: visible-card Done, undo toast aggregation,
   skipped ids, search-result bulk rejection, and Postgres-native batch
   optimization after product semantics settle.
2. Gatekeeper sender screening: first-sender rows, accept, block sender, block
   domain, and classification into `P7 Screen`. The public sender list must go
   through `createSenderScreeningService`, which checks
   `gatekeeper_settings.mode` before calling the Postgres sender store; when
   the mode is `off_accept_all`, it returns an empty list and must not
   materialize new-sender rows. Bulk accept/block payloads must include the
   target `accountId`; the service only permits bulk decisions in
   `before_inbox` mode, and the store constrains the lookup by `account_id` so
   cross-account sender ids are reported as missing instead of acted on.
   Single sender accept/block and domain block decisions also require
   `accountId`; the service rejects them while Gatekeeper is `off_accept_all`
   and the Postgres store loads sender rules by both local sender id and
   account id.
3. Send Later and Outbox: scheduled draft rows, due worker lane, send-now,
   edit schedule, cancel, retry, and dead-letter.
4. Follow-up reminders: persisted reminders, waiting-on-them detection, due
   promotion back into Needs Action, and Hermes preview handoff.
5. Search documents: attachment text extraction runner parser integration,
   parser limits, partial search metadata, and Hermes search citations.
6. Hermes Spark parity: broader compose context, attachment-aware writing,
   writing-style memory from draft diffs, and reviewed classification-only
   rules.
7. Native provider coverage: Gmail and Graph all visible mail folders, then
   mutation/send parity; IMAP native remains after folder identity and
   UIDVALIDITY handling are modeled.
8. Provider onboarding diagnostics: 163, QQ, iCloud, Proton Bridge, and
   personal-domain failures with distinct recovery actions.
9. Alias/domain depth: destination verification, delivery logs, bounce model,
   reverse-alias model, then optional MX gateway as a separate service.
