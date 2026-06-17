# Email Hub

Email Hub is a self-hosted email aggregation workspace. The MVP uses EmailEngine for protocol-heavy mail access, mirrors app-owned state into Postgres, and keeps Hermes as the single AI entry point for search, summaries, reply drafts, priority explanations, and user habit learning.

## Current Implementation

- `apps/web`: React/Vite/TypeScript frontend workspace.
- `apps/api-node`: TypeScript/Node API for health routes, IMAP/SMTP onboarding, CSV import, OAuth onboarding, Hermes, and EmailEngine webhook ingestion.
- `apps/worker-node`: TypeScript/Node worker entry for sync, mirror, Hermes, and import lanes.
- `apps/api` and `apps/worker`: legacy Rust skeletons kept as future native-engine reference.
- `infra/docker-compose.yml`: web, api, worker, postgres, emailengine, and redis-engine.
- `redis-engine` is configured with RDB snapshots and `maxmemory-policy noeviction` so EmailEngine state is not evicted under self-hosted load.
- Docker compose waits for Postgres, Redis, EmailEngine, and API health checks before starting dependent services.
- `infra/migrations/0001_core.sql`: core tables for accounts, messages, state, classification, search, Hermes, aliases, and domains.

## Local Development

```powershell
npm install
npm run dev
```

Backend commands:

```powershell
npm run dev:api
npm run test:backend
npm run build:backend
```

Self-hosted Docker startup should use the repo scripts so compose always loads
the intended env file:

```powershell
cp .env.example .env
npm run compose:up
npm run compose:up:detached
```

Set `EMAILHUB_ENV_FILE=/path/to/env` when using a non-default env file.

IMAP/SMTP account onboarding is available at:

```text
POST /api/accounts/imap-smtp/test
POST /api/accounts/imap-smtp
```

The test endpoint resolves provider presets and verifies IMAP/SMTP credentials through EmailEngine without creating onboarding tasks, accounts, or sync jobs. The onboarding endpoint creates an onboarding task, registers the account in EmailEngine with `POST /v1/account`, and stores the connected account in Postgres. Set `EMAILENGINE_ACCESS_TOKEN` before using either path against a real EmailEngine instance. For unattended Docker startup, also set `EENGINE_PREPARED_TOKEN` so the EmailEngine container imports the same token on boot. If the raw token is missing, both routes return `503 emailengine_configuration_required` with `capability: "imap_smtp_onboarding"` and `missing: ["EMAILENGINE_ACCESS_TOKEN"]`; token values are never returned.
Common IMAP/SMTP providers can use backend presets. `provider: "163"`, `"qq"`, `"icloud"`, or `"proton_bridge"` accepts `email`, optional `username`, and `secret`; the API fills the provider IMAP/SMTP hosts before registering the account. Proton support is Bridge-only and uses local Bridge ports.
After EmailEngine accepts an IMAP/SMTP account, the Postgres runtime completes
the local account and queues the initial bootstrap sync in one transaction, so
the UI does not see a completed mailbox without first sync work.

The onboarding smoke check exercises the real API route through EmailEngine and
a local GreenMail IMAP/SMTP server. Start the normal stack with the test compose
file included, then run:

```powershell
$env:EMAILHUB_API_BASE_URL = "http://127.0.0.1:8080"
docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.test.yml up --build
npm run smoke:imap-smtp-onboarding
```

The smoke check first calls `/api/accounts/imap-smtp/test`, then creates the
account through `/api/accounts/imap-smtp`, and finally verifies the account and
initial sync job are visible from `/api/sync-center/accounts`.

Mailbox read APIs use app-owned Postgres DTOs only:

```text
GET /api/accounts/:accountId/mailboxes
GET /api/accounts/:accountId/messages?mailboxId=:mailboxId&limit=50
GET /api/accounts/:accountId/messages?sort=smart
GET /api/accounts/:accountId/messages/:messageId
POST /api/accounts/:accountId/messages/:messageId/actions
POST /api/accounts/:accountId/messages/:messageId/smart-inbox/feedback
```

Message list items include `classification.bucket`, `classification.priorityScore`, and `classification.reasons` for Smart Inbox reason chips. `sort=smart` orders by stored priority score first, then received time and local message id. The API does not expose EmailEngine message ids or raw provider payloads.

Message actions support `mark_read`, `mark_unread`, `star`, `unstar`,
`archive`, `trash`, `move`, `apply_labels`, `done`, `undo_done`, and
`undone`. The API updates local
Postgres state immediately and writes an idempotent `engine_commands` outbox
row for provider sync. The web app sends only local message, mailbox, and
label ids; it must not send EmailEngine ids.
`done` is an app-level Spark-style action: it stores `done_at`,
`last_action_token`, and `undo_expires_at`, then queues provider `archive`.
`undo_done` and `undone` clear that state and queue provider `move` back to the
local Inbox mailbox.

The worker also consumes `engine_commands`. Commands use Postgres leases,
account-aware concurrency, exponential backoff, and dead-lettering after
`max_attempts`. EmailEngine commands resolve local ids to provider refs before
calling message update, move, or delete APIs. Native Gmail commands use Gmail
`messages.modify` and `messages.trash`; native Outlook commands use Microsoft
Graph message update and move actions. Native IMAP command execution remains a
later engine slice.

The worker writes a rules-based baseline classification whenever a message is mirrored. This keeps Smart Inbox usable before Hermes learning is added: direct customer requests, urgent deadlines, starred messages, transactions, and newsletters are separated with explainable reason strings.

Smart Inbox feedback accepts `mark_important`, `mark_not_important`,
`move_to_personal`, `move_to_notifications`, `move_to_newsletters`,
`move_to_feed`, `always_important_sender`, and `mute_sender`. Feedback is
stored in `feedback_events`, updates `message_classification` immediately, and
writes sender rules for sender-level/category corrections. The worker reads
those sender rules on future mirrored messages using case-insensitive sender
matching.
Each feedback event also writes a scoped Hermes `contact_memory` record such as `sender:client@example.com`. This gives Hermes an inspectable learning trail for future summaries, translations, replies, and priority explanations.

Hermes memory management is available at:

```text
GET /api/hermes/memories?layer=:layer&scope=:scope&limit=50
PATCH /api/hermes/memories/:id
DELETE /api/hermes/memories/:id
```

Memories are app-owned records in Postgres. Users can review, edit, and delete learned preferences before Hermes uses them in skills.
Hermes skills can also load scoped memory context, for example `memoryScope: "global"` and `memoryLayers: ["writing_style_profile"]`. The backend injects a short memory section into the Hermes prompt and records the exact `memoryIds` used in `hermes_audit_events`.

Hermes read/write skill execution is available at:

```text
GET /api/hermes/skills
GET /api/hermes/resource-profile
PATCH /api/hermes/skills/:skillId/settings
POST /api/hermes/skills/translate_text/run
POST /api/hermes/skills/email_search_qa/run
POST /api/hermes/skills/thread_summarize/run
POST /api/hermes/skills/action_item_extract/run
POST /api/hermes/skills/label_suggest/run
POST /api/hermes/skills/priority_triage/run
POST /api/hermes/skills/followup_tracker/run
POST /api/hermes/skills/newsletter_cleanup/run
POST /api/hermes/skills/reply_draft/run
POST /api/hermes/skills/quick_reply/run
POST /api/hermes/skills/rewrite_polish/run
POST /api/hermes/drafts/feedback
POST /api/hermes/rules/suggest
GET /api/hermes/rule-candidates
POST /api/hermes/rules/:candidateId/simulate
POST /api/hermes/rules/:candidateId/approve
```

`GET /api/hermes/resource-profile` summarizes the current enabled skill count,
per-run context and memory limits, retention cleanup policy, and self-hosted
machine guidance. Settings shows the same profile above the editable skill
cards so operators can see the pressure created by Hermes before raising
budgets.

`email_search_qa` searches app-owned Postgres message DTOs first, then asks Hermes to answer from those matches. It returns `answerText`, `searchQuery`, and match summaries, and records the matched message ids in `hermes_audit_events`.
The web app routes the compact bottom Hermes dock through this same
`email_search_qa` contract for natural-language mail questions. Dock answers
show cited app-owned messages and can pass the resolved `searchQuery` into the
Search workspace; Hermes does not execute provider mutations from this path.
`thread_summarize` summarizes a mail thread with optional focus, language, read message ids, and memory scope. It returns `summaryText` only and records the memory ids used in the audit trail.
The message reader calls `thread_summarize` for action-point summaries and
`translate_text` for Chinese translations, rendering both as read-only Hermes
preview blocks above the original message body.
`action_item_extract` returns structured action items with title, owner, due date text, priority, status, and source quote. It does not create tasks or mutate mail state; task persistence is a later API.
`label_suggest` returns suggested labels and preview-only organization actions such as apply label, keep in inbox, archive, snooze, move to feed, or mark important. It does not mutate mail state.
`priority_triage` returns preview-only priority, Smart Inbox bucket, score, reasons, and optional explanation. It does not update `message_classification`; stored sorting remains a separate explicit write path.
`followup_tracker` returns preview-only follow-up state, owner, confidence, reasons, optional deadline, and next action. It does not create tasks, send mail, or mutate mail state.
`newsletter_cleanup` returns preview-only cleanup suggestions for subscriptions and marketing mail, limited to safe actions such as move to Feed, archive, keep in inbox, unsubscribe later, or mark not important. It does not delete, move, or unsubscribe from provider mail.
`reply_draft` uses the same Hermes provider boundary and memory context as translation. It returns editable `draftText` only; it does not send mail or mutate provider state.
After the user edits a Hermes draft, `POST /api/hermes/drafts/feedback` records the before/after text in `hermes_feedback`. Meaningful edits create `writing_style_profile` memories so future drafts can learn concise wording, sign-off preferences, and similar habits.

Hermes rule learning is review-first. `POST /api/hermes/rules/suggest` scans repeated Smart Inbox feedback for one account and creates `shadow` candidates with evidence message ids. `simulate` records a shadow run and returns sample matches without changing mail. `approve` converts a candidate into an enabled app-owned rule; provider mutations and automatic sending are still separate explicit flows. The worker reads enabled `classify_sender` Hermes rules during message mirroring and writes only `message_classification` bucket, score, reasons, and `classified_by='hermes_rules'`.

Mail compose APIs are preview-first:

```text
GET  /api/accounts/:accountId/compose/drafts
POST /api/accounts/:accountId/compose/drafts
POST /api/accounts/:accountId/compose/drafts/:draftId/send
POST /api/accounts/:accountId/compose/drafts/:draftId/schedule
GET  /api/accounts/:accountId/outbox
POST /api/accounts/:accountId/outbox/:scheduledId/send-now
PATCH /api/accounts/:accountId/outbox/:scheduledId
DELETE /api/accounts/:accountId/outbox/:scheduledId
```

The draft list route returns app-owned ordinary drafts only. The draft create
route stores local recipients, subject, body, source, optional reply target, and
optional Hermes skill run id. It does not call a provider. The web app can
auto-save ordinary drafts after the user pauses with valid recipients and body;
scheduled outbox drafts still require an explicit save/send/reschedule action.
The send route validates an existing draft and inserts an immediate `queued`
`scheduled_sends` outbox row with a stable idempotency key; it does not call a
provider in the API request. The schedule route moves a valid draft into a
durable `scheduled_sends` outbox row. The worker claims queued or due scheduled
sends with a lease, submits through the account transport, and marks the row
sent, failed, or dead-lettered. The web app must never call EmailEngine submit
directly.

CSV account import is available at:

```text
POST /api/accounts/import/csv/preview
POST /api/accounts/import/csv
```

The preview endpoint validates rows without writing tasks. The import endpoint creates pending onboarding tasks for valid IMAP/SMTP rows and Gmail/Outlook OAuth rows; invalid rows are reported without blocking the valid rows. Completed IMAP/SMTP and OAuth onboarding both enqueue an idempotent `sync_account` bootstrap job.

Sync center read APIs are available at:

```text
GET /api/sync-center/accounts
GET /api/sync-center/reauthorizations
POST /api/sync-center/accounts/:accountId/resync
POST /api/sync-center/accounts/:accountId/pause
POST /api/sync-center/accounts/:accountId/resume
POST /api/sync-center/accounts/:accountId/retry-failed
```

`/accounts` combines `connected_accounts` with the latest durable `sync_jobs` row so the UI can show syncing, waiting, failed, or reauthorization-required accounts from app-owned state. `/reauthorizations` lists pending or failed OAuth and transfer-import tasks that need user action. Both routes are read-only and never return OAuth tokens, app passwords, authorization codes, secret references, or raw provider payloads.
The control routes enqueue a manual resync, pause or resume account sync, or requeue failed/dead-letter sync jobs. Manual resync returns the existing queued/running sync job for the same account instead of inserting duplicates. Retry skips old failed jobs while the same account already has queued or running sync work, so one account does not stampede itself under repeated clicks. Paused accounts stay visible in Sync Center, and the worker skips their queued account sync jobs until they are resumed.

Reauthorization recovery is available at:

```text
POST /api/sync-center/reauthorizations/:taskId/oauth/start
POST /api/sync-center/reauthorizations/:taskId/imap-smtp
```

The OAuth route reuses the existing onboarding task, writes a fresh `state` and `redirectUri`, and returns a provider authorization URL. The IMAP/SMTP route accepts a fresh authorization code or app-specific password, registers the account in EmailEngine, completes the original task, and enqueues an idempotent bootstrap sync job. Neither route reuses old secrets or returns secrets in the response.

Account transfer is available at:

```text
POST /api/accounts/transfer/export
POST /api/accounts/transfer/import
```

The export endpoint returns only safe account configuration such as email, provider, display name, labels, group, and engine provider. It does not export OAuth tokens, app passwords, authorization codes, or stored secret references. The import endpoint creates pending onboarding tasks with `reauthRequired: true`, so every transferred account must be authorized again before sync resumes.

Domain alias control-plane APIs are available at:

```text
GET  /api/domains
POST /api/domains
POST /api/domains/:domainId/destinations
GET  /api/domains/:domainId/aliases
POST /api/domains/:domainId/aliases
PUT  /api/domains/:domainId/catch-all
GET  /api/domains/:domainId/delivery-logs?limit=50
```

This is a control plane, not a full mail server. It stores domains, DNS guidance, destination mailboxes, alias routes, catch-all rules, and delivery logs in Postgres. A unique catch-all index prevents multiple catch-all rules for the same domain; MX gateway and actual forwarding workers remain later slices.

Alias routing worker primitives are now available in `apps/worker-node/src/alias-routing`:

```text
alias-router
-> normalize inbound recipient
-> match exact alias, then catch-all rule
-> write delivery_logs
-> enqueue idempotent alias_delivery_jobs
```

`alias_delivery_jobs` use leases, attempts, backoff, and dead-letter status so a future MX gateway or SMTP delivery worker can run high-volume forwarding without duplicating destinations for the same inbound message fingerprint. Set `ALIAS_DELIVERY_WEBHOOK_URL` to let the worker hand claimed jobs to an external forwarding service; when it is empty, the worker leaves alias delivery jobs queued instead of pretending delivery is configured.

Attachment download uses local attachment ids from message detail DTOs:

```text
GET /api/accounts/:accountId/attachments/:attachmentId/download
```

The API resolves the internal provider attachment id server-side and streams the file from EmailEngine without exposing provider ids to the web app.

## Docker

```powershell
Copy-Item .env.example .env
docker compose --env-file .env -f infra/docker-compose.yml up --build
```

Run the compose command from the repository root. The compose file lives under
`infra/`, so `--env-file .env` is required to interpolate the root `.env`
values for EmailEngine tokens, webhook secrets, and host port bindings.
Email Hub pins the default EmailEngine image to
`postalsys/emailengine:v2.71.0@sha256:4f732fd40e39f8e3af0b3d1580f1972a7e7270741be510f217a6b07eac5b0efc` instead of `latest` so a self-hosted launch is
repeatable. Override `EMAILENGINE_IMAGE` with a newer `v2.x.x` tag or immutable
digest only after running the launch verifier against that image.

For production-style self-hosting, add the strict overlay:

```powershell
docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.prod.yml up --build -d
```

The production overlay changes API container health to require
`/api/mail-engine/health` with `readiness.status=ready`, and forces the worker to
require both `EMAILENGINE_ACCESS_TOKEN` and `EENGINE_PREPARED_TOKEN`. A stack with
missing EmailEngine tokens, rejected API auth, missing prepared token, or the
default webhook secret will stay unhealthy instead of appearing launched.

Default entry points:

- Web: http://127.0.0.1:5173
- API: http://127.0.0.1:8080/health

Suggested self-hosted sizing for EmailEngine-first deployments:

- Small external-Hermes setup: 2 CPU cores, 4 GB RAM, 20 GB disk for a small
  mailbox set where Hermes calls an external provider.
- Standard external-Hermes setup: 2 CPU cores, 6 GB RAM, 30 GB disk when most
  built-in Hermes skills are enabled with the default 24k context budget.
- Local model setup: start at 6 CPU cores, 24 GB RAM, 80 GB disk for the app
  stack plus a local OpenAI-compatible Hermes model. Larger models or higher
  context budgets need more RAM/GPU headroom.

Use Settings -> Hermes skill options or `GET /api/hermes/resource-profile` to
inspect the current profile. Lower per-skill `maxContextChars` and
`memoryLimit` first when a self-hosted node is memory constrained.

For an EmailEngine-first launch, set these values in `.env` before onboarding
real mailboxes:

- `EMAILENGINE_ACCESS_TOKEN`: raw token used by the Email Hub API and worker.
- `EMAILENGINE_IMAGE`: pinned EmailEngine container image, defaulting to
  `postalsys/emailengine:v2.71.0@sha256:4f732fd40e39f8e3af0b3d1580f1972a7e7270741be510f217a6b07eac5b0efc`.
- `EENGINE_PREPARED_TOKEN`: EmailEngine prepared token for unattended container startup.
- `EMAILENGINE_WEBHOOK_SECRET` and `EENGINE_SECRET`: rotate both away from
  `dev-emailhub-secret` for production.

Then check the launch readiness endpoint:

```powershell
Invoke-RestMethod http://127.0.0.1:8080/api/mail-engine/health
```

The response includes `readiness.status`, `missing`, `warnings`, and
`readiness.setupActions`. It reports both the raw API token and the prepared
Docker token so operators can catch a stack where Email Hub has a token but the
EmailEngine container did not import it. Token and secret values are never returned. The web
app also shows the same EmailEngine setup status in Add Mail and Sync Center so
operators can see why onboarding, sync, attachment download, or send is not
available.

For a repeatable EmailEngine-first launch gate, run the layered verifier instead
of relying on a handwritten checklist:

```powershell
npm run verify:emailengine-launch:offline
```

The offline gate builds the backend and frontend, runs both backend and frontend
tests, runs the heavy sync-queue stress gate, and validates the production Docker
compose overlay. It uses `.env` by default for compose interpolation and falls
back to `.env.example`; set `EMAILHUB_ENV_FILE=/path/to/env` when validating a
specific deployment file.

After the Docker stack is running, run the live gate from the host:

```powershell
$env:EMAILHUB_API_BASE_URL = "http://127.0.0.1:8080"
npm run verify:emailengine-launch:live
```

The live gate calls `/health`, `/api/mail-engine/health`, and the signed webhook
smoke. It fails if API readiness is down, EmailEngine launch readiness is not
`ready`, or token-backed onboarding, attachment download, and send capabilities
are not all available.

For quick core regression while iterating on the launch path, run:

```powershell
npm run verify:emailengine-launch:core
```

For final EmailEngine-first sign-off, include the strict Postgres queue gate and
the GreenMail-backed real onboarding and webhook checks:

```powershell
$env:TEST_DATABASE_URL = "postgres://emailhub_test:emailhub_test@127.0.0.1:55432/emailhub_sync_jobs_test"
npm run verify:emailengine-launch
```

That default full gate runs `:core`, `:strict-db`, and the GreenMail gate below,
so the final launch check cannot accidentally skip real Postgres sync-queue
concurrency, EmailEngine account registration, webhooks back into Email Hub,
worker send submission, or attachment download through the public app route.
Use `verify:emailengine-launch:core` for faster iteration when the disposable
test database is not running.

After the stack is healthy, run the EmailEngine webhook smoke check from the
host:

```powershell
$env:EMAILHUB_API_BASE_URL = "http://127.0.0.1:8080"
npm run smoke:emailengine-webhook
```

The smoke check sends a signed EmailEngine-style `messageNew` webhook to the
API, verifies that a `sync_account` job is queued, sends the same delivery id
again, and verifies the duplicate does not enqueue another job.

For the real IMAP/SMTP onboarding smoke check, include the test compose file so
EmailEngine can reach GreenMail on the Docker network:

```powershell
docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.test.yml up --build
$env:EMAILHUB_API_BASE_URL = "http://127.0.0.1:8080"
npm run smoke:imap-smtp-onboarding
```

This uses `greenmail-test:3143` for IMAP and `greenmail-test:3025` for SMTP by
default. Override the `EMAILHUB_SMOKE_*` variables when pointing the smoke at a
different test mailbox.

To prove the EmailEngine container really emits webhooks, run the real webhook
smoke after the same compose stack is healthy:

```powershell
$env:EMAILHUB_API_BASE_URL = "http://127.0.0.1:8080"
$env:EMAILHUB_SMOKE_DELIVERY_SMTP_HOST = "127.0.0.1"
$env:EMAILHUB_SMOKE_DELIVERY_SMTP_PORT = "3025"
npm run smoke:emailengine-real-webhook
```

This first onboards the GreenMail account through the public API, then delivers a
unique message to GreenMail from the host, and finally polls both
`/api/diagnostics/events` and `/api/accounts/:accountId/messages`. The smoke
passes only when a current `emailengine_webhook_ingested` diagnostic exists for
the account and the exact smoke subject has reached the local mail read model.
When the message detail exposes `bodyText`, `bodyHtml`, or `snippet`, the smoke
also requires that text to contain the unique smoke id. If EmailEngine emits a
matching `message_upserted` event, the result is reported as
`message_upserted_webhook`; if the message arrives through the initial
sync/read-model path, it is reported as `read_model_sync`. By default this smoke
uses a unique `emailhub-smoke-<uuid>@example.com` mailbox so repeated runs do not
reuse old onboarding or sync-center state; set `EMAILHUB_SMOKE_MAIL_EMAIL` when
you need a fixed mailbox.

To prove the outgoing EmailEngine submit path, worker scheduled-send lane, SMTP
delivery, webhook/sync, and read model all work together, run:

```powershell
npm run smoke:emailengine-send
```

This creates a draft through `/api/accounts/:accountId/compose/drafts`, queues it
through `/send`, waits for the worker to submit it through EmailEngine, and
passes only when the unique sent message appears in a separate GreenMail
recipient account's read model. By default the sender uses a fresh
`emailhub-send-<uuid>@example.com` mailbox and the recipient uses a fresh
`emailhub-recipient-<uuid>@example.com` mailbox, so a Sent-folder copy in the
sender mailbox cannot satisfy the smoke by itself. Set
`EMAILHUB_SMOKE_MAIL_EMAIL` or `EMAILHUB_SMOKE_RECIPIENT_EMAIL` only when you
intentionally need fixed test mailboxes.

To prove app-owned attachment ids can be downloaded without exposing provider
attachment ids, run:

```powershell
npm run smoke:emailengine-attachment-download
```

This delivers a unique MIME attachment to GreenMail, waits for EmailEngine sync
to mirror the attachment metadata, then calls
`/api/accounts/:accountId/attachments/:attachmentId/download` and verifies the
downloaded bytes match the smoke attachment content. By default this smoke
creates a fresh `emailhub-attachment-<uuid>@example.com` mailbox; set
`EMAILHUB_SMOKE_MAIL_EMAIL` only when intentionally reusing a fixed test
mailbox.

To prove user mail actions are not only applied to the local read model but also
leave the provider command outbox and finish in the worker, run:

```powershell
npm run smoke:emailengine-mail-action
```

This delivers a unique message to GreenMail, queues a Sync Center manual resync
through `/api/sync-center/accounts/:accountId/resync`, waits for the message to
appear in the app-owned read model, calls
`POST /api/accounts/:accountId/messages/:messageId/actions` with
`mark_read`, and then polls `/api/diagnostics/events` for the exact
`engine_commands` worker result tied to the returned command id. The smoke
passes only when that command reaches `processed`; dead-lettered commands and
diagnostics timeouts fail the run. The API and worker containers must both be
running with durable operational events enabled. By default this smoke creates a
fresh `emailhub-action-<uuid>@example.com` mailbox; set
`EMAILHUB_SMOKE_MAIL_EMAIL` only when you intentionally want to reuse a fixed
test mailbox.

The same GreenMail-backed checks are also grouped as:

```powershell
npm run verify:emailengine-launch:greenmail
```

`/health` checks API readiness plus a Postgres `SELECT 1`; EmailEngine
capability and launch diagnostics remain at `/api/mail-engine/health`.
Postgres, Redis, and EmailEngine are internal Docker services by default. Use
`API_BIND` and `WEB_BIND` in `.env` to change the host bindings.

### High-Load Validation

Before calling a self-hosted EmailEngine-first build ready, run the sync queue
stress gates from the repository root:

```powershell
npm run stress:sync-queue
npm run stress:sync-queue:heavy
```

The default stress drains a multi-account backlog through the worker queue model.
The heavy gate runs 12,800 sync jobs across 64 accounts and 128 simulated workers
and fails if any job is duplicate-claimed or if same-account jobs overlap.

When a disposable Postgres test database is available, also run the database
concurrency gate:

```powershell
docker compose -f infra/docker-compose.test.yml up -d postgres-test
$env:TEST_DATABASE_URL = "postgres://emailhub_test:emailhub_test@127.0.0.1:55432/emailhub_sync_jobs_test"
npm run stress:sync-queue:postgres
npm run verify:emailengine-launch:strict-db
```

That Postgres gate uses the migration-backed test database and verifies the real
`sync_jobs` claim query under overlapping workers, including expired lease
reclaim behavior. The strict variant fails immediately when `TEST_DATABASE_URL`
is missing, so final launch verification cannot pass by silently skipping the
database integration test. Do not point `TEST_DATABASE_URL` at a production
database.

## Logging

API and worker services emit newline-delimited JSON logs. Set
`LOG_LEVEL=debug`, `info`, `warn`, `error`, or `silent` in `.env`; Docker
passes it to both runtime services. Every API response includes `x-request-id`,
and request completion logs include the same `requestId`, method, sanitized
path, status code, and duration. Sensitive fields such as credentials, tokens,
cookies, and authorization headers are redacted before logging.

Worker throughput is controlled with `WORKER_CONCURRENCY`, `WORKER_LEASE_SECONDS`, and `WORKER_POLL_MS`. Sync jobs and provider command outbox entries for the same account stay serial so mailbox cursors and provider mutations do not race; different accounts can run in parallel. Alias delivery jobs use the same worker concurrency budget and only run when `ALIAS_DELIVERY_WEBHOOK_URL` is configured.

The API applies a 1 MiB default request body limit before route parsing. Oversized requests return `413 request_body_too_large` and do not reach webhook ingest, onboarding, Hermes, import, or mutation services.

## Product Boundaries

- The left sidebar is only for global features: Mail, Add Mailbox, Sync Center, Search, and Settings.
- The Mail top search and Search workspace both use Email Hub message search
  contracts; they do not call provider search APIs directly.
- The compact Hermes dock is the AI entry for natural-language mail search and
  explains app-owned search results with citations before handing queries to
  deterministic Search filters.
- Tasks and Hermes configuration live inside Settings; the compact Hermes input remains a global bottom dock.
- Mail folders live only in the second column.
- The frontend and business code must use Email Hub contracts, not raw EmailEngine payloads.
- Smart Inbox sorts by buckets and scores, then shows reason chips.
- Hermes write actions create previews or drafts first; they do not send directly.
- Backend slices should follow `docs/spark-like-backend-chain.md`; open source
  implementation references are summarized in `research/open-source-email-systems.md`.
- Feature work must satisfy `docs/backend-micro-chain-spec.md` before coding:
  trigger, state, DTO, worker, failures, and tests must all be named.
