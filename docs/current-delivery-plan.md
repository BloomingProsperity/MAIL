# Current Delivery Plan

Date: 2026-06-17

## Scope

This plan covers the current Email Hub delivery slice: keep EmailEngine as the
fast production path, keep Native Engine progressing behind provider adapters,
connect frontend surfaces to existing backend contracts, and verify the stack
with more than smoke-level tests.

## Module Plans

### 1. EmailEngine Launch Path

- Trigger: user adds Gmail, Outlook, 163, QQ, iCloud, Proton Bridge, or a custom
  domain mailbox.
- State: `connected_accounts`, `onboarding_tasks`, `provider_message_refs`,
  `mailboxes`, `message_locations`, `message_state`, `sync_jobs`.
- API: onboarding, webhook, mail read, actions, compose, sync center, account
  transfer, CSV import.
- Worker: EmailEngine sync account, mirror store, command outbox, scheduled
  send, attachment extraction.
- Failure: missing token, invalid mailbox credential, webhook replay, provider
  delete/move ambiguity, retry/dead-letter.
- Tests: route tests, webhook burst/idempotency, IMAP/SMTP smoke with
  GreenMail, sync queue stress, worker command tests.
- Current launch-gate status: the repository now exposes layered
  EmailEngine-first verification commands. `verify:emailengine-launch:offline`
  builds backend/frontend, runs backend/frontend tests, runs the heavy sync
  queue stress gate, and validates the strict production compose overlay
  without writing interpolated secrets to disk. Docker self-hosting now pins
  the default EmailEngine image to `postalsys/emailengine:v2.71.0@sha256:4f732fd40e39f8e3af0b3d1580f1972a7e7270741be510f217a6b07eac5b0efc` through
  `EMAILENGINE_IMAGE` instead of following `latest`; operators can override to a
  newer version tag or immutable digest only after rerunning the launch gate.
  Production self-hosted starts use `compose:up:prod` or
  `compose:up:prod:detached` so the strict EmailEngine readiness overlay is
  active from boot.
  `verify:emailengine-launch:live` checks the running API `/health`,
  EmailEngine readiness, token-backed onboarding/download/send capabilities,
  provider identity, API health status, host-reachable web/API endpoints,
  required Docker Compose service health for `postgres`, `redis-engine`,
  `emailengine`, `api`, `worker`, and `web`, and the signed webhook idempotency
  smoke. The Docker health verifier now follows `API_BIND`/`WEB_BIND` when
  explicit host probe base URLs are omitted and sends `EMAILHUB_API_TOKEN` to
  protected API probes without echoing it in the JSON report. It can also wait
  through bounded transient Docker/HTTP startup states while failing
  immediately on proven configuration gaps such as degraded EmailEngine
  readiness. The launch verifier CLI now keeps the legacy script entrypoint but
  routes top-level failures through a tested runner that redacts bearer tokens,
  API tokens, PAT-shaped strings, URL userinfo/query fragments, and private
  host details before writing JSON errors. The Docker health gate also reads a
  small whitelist of running-container environment variables to prove the prod
  overlay is actually active at runtime: API runs with `NODE_ENV=production`,
  dev secrets disabled, API token enforcement enabled, and worker health checks
  requiring the EmailEngine token. The Docker health CLI now uses the same
  testable runner shape and shared error redaction helper as the launch
  verifier, so top-level Docker/HTTP failures do not echo bearer tokens,
  configured base URLs, userinfo, query strings, PAT-shaped strings, or private
  host details.
  `verify:emailengine-launch:strict-db`
  requires `TEST_DATABASE_URL` and runs the real Postgres `sync_jobs`
  concurrency gate, failing immediately instead of silently skipping when no
  disposable test database is configured.
  `verify:emailengine-launch:greenmail` groups the IMAP/SMTP onboarding smoke,
  real EmailEngine webhook smoke, outgoing worker send smoke, attachment
  download smoke, and user mail-action/outbox worker smoke against the
  GreenMail test stack. The mail-action smoke uses a fresh mailbox by default,
  delivers a unique message, queues a Sync Center manual resync, calls the
  public `mark_read` route, and requires the returned engine command id to reach
  a `processed` worker diagnostic in the `engine_commands` lane, so local
  optimistic state alone cannot satisfy the gate. The real webhook smoke also
  requires fallback `read_model_sync` evidence to have an EmailEngine webhook
  diagnostic at or after the smoke delivery start, so stale account diagnostics
  cannot satisfy the gate. Real webhook, send, attachment-download, and
  mail-action smokes now default to fresh generated GreenMail mailboxes and only
  reuse a fixed mailbox when the operator sets the corresponding
  `EMAILHUB_SMOKE_*` address and reuse flag explicitly. The shared IMAP/SMTP
  onboarding smoke helper now redacts failed connection-test, onboarding, and
  Sync Center response summaries before they can reach CLI output, so echoed
  mailbox credentials, bearer tokens, PAT-shaped strings, URL credentials, query
  strings, and private hosts do not leak from GreenMail gate failures. The
  EmailEngine webhook, real webhook, send, attachment-download, mail-action, and
  IMAP/SMTP smoke CLI entrypoints now use a shared smoke failure report helper,
  so top-level failures get the same redaction boundary before JSON output.
  Real webhook and roundtrip smoke helpers also sanitize direct helper response
  bodies, worker diagnostic error text, and attachment-download response text
  before throwing, covering structured secret fields, bearer/basic auth text,
  token/password fragments, PAT-shaped strings, URL credentials, query strings,
  and private hosts. The default
  `verify:emailengine-launch` now runs the core gate, strict DB gate, and
  GreenMail checks, while `verify:emailengine-launch:core` remains available for
  faster iteration before final sign-off.

### 2. Native Engine Track

- Trigger: Gmail/Outlook OAuth account completes and account settings select
  native where supported.
- State: account credentials, provider refs, sync cursors, account provider
  settings.
- API: same Email Hub DTOs as EmailEngine; no frontend provider payloads.
- Worker: Gmail read adapter, Graph read adapter, native sync processor, native
  command processor.
- Failure: token refresh failure, cursor mismatch, provider rate limits,
  partial folder discovery.
- Tests: provider contract tests, adapter tests, native sync processor tests,
  native command processor tests.
- Current status: native Gmail/Outlook/IMAP identities can now feed the same
  provider-aware mirror writer used by EmailEngine. Native sync writes provider
  refs, tombstones, local messages, message state, locations, search documents,
  Smart Inbox classification, Gatekeeper sender screening, and attachment text
  extraction jobs through the unified read model.
- Current send status: worker scheduled-send jobs now carry account engine
  routing, use EmailEngine for EmailEngine accounts, and can use native Gmail,
  Microsoft Graph, or IMAP/SMTP send transports for native accounts. Gmail
  native send uses RFC 2822 MIME encoded for `messages.send`; Graph native send
  uses `/me/sendMail`; IMAP native accounts submit through SMTP with
  `smtp_password` preferred over `imap_password`, deterministic Message-ID, Bcc
  kept in the SMTP envelope, and sanitized provider errors. After successful
  SMTP delivery, worker send jobs make a best-effort IMAP append into the Sent
  mailbox using a separate `imap_password` when present, preserving the same
  Message-ID, Bcc, reply headers, bodies, and attachments in the RFC 822 copy.
  Sent append failures do not fail the already accepted SMTP send, preventing
  duplicate retries. OAuth authorization and Microsoft refresh scopes include
  the send scopes needed by these transports. Worker immediate-queue and
  scheduled native sends detect Gmail/Graph auth, permission, missing refresh
  credential, rejected OAuth refresh failures, and SMTP password/auth failures,
  mark the account `reauth_required`, and create or reuse Sync Center
  reauthorization tasks.
- Current API send status: API-process immediate sends validate the draft,
  account state, and From identity, then create an immediate `queued`
  `scheduled_sends` outbox row with a stable idempotency key. Provider
  submission, native transport dispatch, OAuth refresh, SMTP delivery, and Sent
  append now happen in the worker scheduled-send lane. Sync Center exposes
  native-send reauthorization tasks and starts the existing
  OAuth or IMAP/SMTP recovery flows from the frontend.
- Current send identity status: compose now exposes account send identities
  through `/api/accounts/:accountId/send-identities`. The default account
  address is always available, and domain aliases are available only when the
  domain is verified, the alias is enabled, and the alias routes to a verified
  destination matching the current account email. Provider-native send-as
  identities now have a durable `provider_send_identities` cache and enter the
  same compose identity DTO only when enabled and verified. Gmail native mailbox
  discovery hydrates that cache from Gmail `sendAs.list`, including the primary
  address and verified custom From aliases, and disables stale Gmail aliases
  when they disappear upstream. Microsoft Graph shared mailbox and
  send-on-behalf permissions cannot be enumerated from the authenticated user
  through Graph, so Outlook/Graph now uses an explicit candidate flow instead
  of pretending to auto-discover shared mailboxes. The compose API can register
  a user-entered Graph shared mailbox or send-on-behalf candidate as
  pending/disabled, and the compose panel exposes a compact Outlook shared
  From control. Candidates only become selectable From identities after the
  user runs an explicit Graph verification test send and Microsoft Graph
  accepts it; `ErrorSendAsDenied` and other Graph failures mark the candidate
  failed/disabled. Graph verification records whether the identity was proven
  through `/me/sendMail` or is explicitly eligible for
  `/users/{id | userPrincipalName}/sendMail`. The compose panel now lets a
  base-verified Outlook shared sender run a second target-mailbox verification
  for Full Access/Sent Items behavior. That verification sends through the
  requested `/users/{target}/sendMail` endpoint with `saveToSentItems=true` and
  only then writes `sendMailTargetMode=users`, `userSendMailEligible=true`, and
  `targetMailbox` capabilities. If the target verification fails, the From
  identity remains usable through `/me/sendMail + from`, but the `/users` target
  is not enabled. API immediate native sends and worker scheduled native sends
  both re-resolve the current verified provider identity at submit time. They
  only target `/users/{shared}/sendMail` when the identity capabilities
  explicitly state `sendMailTargetMode=users`, `userSendMailEligible=true`, and
  provide a target mailbox id or UPN. Otherwise they keep the safer
  `/me/sendMail` plus Graph `from` behavior that was actually verified. Draft
  creation, draft updates, scheduling, API immediate send, and API send-now
  re-check the selected From address before queueing. The worker
  scheduled-send path re-checks it again before provider submission.
  EmailEngine, native Gmail, native Graph, native SMTP, and scheduled-send
  worker paths all carry the selected From identity; SMTP keeps the
  authenticated account as the envelope sender while allowing the verified alias
  in the visible From header. Gmail
  authorization now explicitly includes `gmail.settings.basic`, and Outlook
  authorization plus refresh flows include `Mail.Send.Shared` for
  shared-mailbox submissions when Exchange grants exist. The compose API also
  exposes a read-only Graph shared-sender diagnostics endpoint at
  `/api/accounts/:accountId/send-identities/provider-candidates/:candidateId/diagnostics`.
  It reports the verified From state, selected send path, Sent Items behavior,
  explicit-candidate/discovery limitation, sanitized Graph rejection code, and
  next operator actions without sending another test message. The compose panel
  has a matching `诊断` action so users can inspect shared-mailbox readiness
  before choosing a provider-native path.
- Current threading status: reply and reply-all drafts now persist provider
  threading metadata on `email_drafts` before send. EmailEngine sends use its
  native `reference` object, Gmail native sends include both RFC 2822
  `In-Reply-To` / `References` headers and Gmail `threadId`, Microsoft Graph
  threaded replies use MIME `/me/sendMail` so standard Internet headers are
  preserved, and IMAP/SMTP sends include sanitized reply headers in
  Nodemailer. Mirrored messages now persist `In-Reply-To` and the complete RFC
  `References` chain from EmailEngine, Gmail metadata, Graph Internet headers,
  and IMAP envelope/header data. The same metadata is hydrated by worker
  scheduled-send claims, so delayed replies keep threading after retries or
  process restarts.
- Remaining gap: chunked/object-storage uploads for larger attachments,
  tenant-level Graph shared-mailbox discovery/admin permission inventory, deeper
  command semantics, and live high-volume IMAP/SMTP provider smoke tests still
  need focused backend slices before Native Engine can be promoted from parallel
  track to default path. Native provider APIs do not provide the same
  idempotency guarantee as EmailEngine's submit endpoint yet.

### 3. Hermes Single AI Entry

- Trigger: translate, summarize, search QA, write reply, polish, triage, label
  suggest, follow-up, newsletter cleanup.
- State: Hermes runtime settings, runs, audit events, editable memories,
  draft feedback, reviewed rules.
- API: `/api/hermes/*` skills, runtime, providers, memories, rules, audit log.
- Security boundary: account-scoped API tokens may run only account-bound mail
  and Hermes operations. Scoped mail search, translation preferences, Hermes
  audit log, memory review, and rule-run history must carry `accountId` and are
  rejected when the token is not allowed for that account. Hermes runtime
  settings, provider probe/configuration, resource profile, skill list/settings,
  global direct skill runs, action-plan/admin rule surfaces, and other global AI
  management routes require the admin API token. Non-account operational
  surfaces, including maintenance cleanup/status, EmailEngine health/readiness,
  and provider capability catalogs, also require the admin token.
- Current data-boundary status: `hermes_memories`, `hermes_skill_runs`, and
  `hermes_audit_events` now have structure-level `account_id` columns for new
  data. Account-bound skill runs write that scope into both run and audit rows,
  memory context queries pass `accountId` into the store, and Postgres run
  storage verifies referenced `readMessageIds` and `memoryIds` belong to the
  same account before writing audit rows. Legacy NULL-scope Hermes rows remain
  admin-only migration/cleanup data and are not loaded for account-scoped
  prompts.
- Resource guardrails: every built-in Hermes skill has backend-owned editable
  options for enabled state, body-read permission, memory-write permission,
  confirmation requirement, memory limit, and context character budget. Message
  body context is capped before prompt construction and before skill run/audit
  persistence, with a 24k character default when no per-skill override exists.
  The per-skill memory limit is now applied at runtime when loading memory
  context for direct skill runs and message-scoped reader skills, so Settings
  changes reduce prompt memory fan-out instead of only changing UI metadata.
  `memoryLimit=0` is a hard off switch for memory lookup, and requested memory
  layers are deduplicated and capped before any database query to prevent
  layer-by-scope query fan-out under load.
  The per-skill memory-write permission is enforced before state-changing
  learning paths write memories or preferences: translation preference
  confirmation checks `translate_text`, draft feedback checks the originating
  draft skill, and action-plan creation/confirmation checks `action_plan`.
  New Hermes skills must ship with editable settings, defaults, frontend
  controls, and route tests before they are considered complete.
- Worker: no silent write actions; worker only consumes explicit mail actions
  and scheduled jobs. A `hermes_retention_cleanup` lane prunes expired Hermes
  translation/summary caches, completed action plans, feedback, audit events,
  and skill runs using `HERMES_RETENTION_DAYS`,
  `HERMES_RETENTION_CLEANUP_INTERVAL_MS`, and
  `HERMES_RETENTION_CLEANUP_LIMIT`. The API and Settings data-maintenance panel
  expose the same bounded Hermes retention boundary through
  `GET /api/maintenance/hermes-retention` and
  `POST /api/maintenance/hermes-retention/cleanup`, with capped per-table
  expired-row estimates so small self-hosted machines can inspect and prune
  Hermes cache/audit/skill-run pressure without full-table maintenance scans.
- Failure: missing endpoint/model/key, external auth required, provider failure,
  prompt output parse failure.
- Tests: provider catalog/probe, runtime config, audit log, memory context,
  editable skill settings, context-budget truncation, retention cleanup, and
  each skill with preview-only assertions.
- Current writing-style status: Hermes reply drafts, quick replies, and
  rewrite/polish results now feed the same explicit final-edit feedback path.
  Saving, sending, scheduling, or updating a Hermes-polished compose draft
  carries the `skillRunId` and Hermes draft text into compose persistence; the
  feedback store writes `writing_style_profile` memories when the user edits
  the result and the originating draft skill allows memory writes. It records
  accepted rewrite/polish output as positive style preference without exposing
  draft body outside Hermes memory/audit tables.
- Current search QA status: the compact Hermes dock now submits natural
  language mail questions through `/api/hermes/skills/email_search_qa/run`
  using the selected account, global memory scope, and a five-result limit. The
  dock renders Hermes' answer plus cited app-owned message ids, subjects,
  senders, dates, and Smart Inbox buckets, and can hand the resolved
  `searchQuery` to the Search workspace for deterministic filtering. Hermes
  search QA now applies the editable per-skill context budget before calling
  Hermes, so large result snippets cannot create an unbounded prompt. Hermes
  search remains read-only: it answers and cites, but does not move, delete, or
  send mail.
- Current reader-assist status: the message reader now exposes Hermes summary
  and translation actions wired to message-scoped
  `/api/accounts/:accountId/messages/:messageId/summary` and
  `/api/accounts/:accountId/messages/:messageId/translate` routes. Both now read
  the message body server-side, record the selected message id in Hermes audit
  events, cache by body hash and skill options, and render read-only preview
  blocks above the original message body.
- Current compose-translation status: the compose panel now exposes Hermes
  draft translation through the single `translate_text` skill. Users can choose
  source and target languages for the current draft body, Hermes replaces the
  editable body with translated text, and the compose payload carries the
  originating skill run id and translated draft text into the same feedback
  trail used by Hermes-polished drafts.
- Current memory-management status: Settings now exposes the app-owned Hermes
  learning records. The frontend lists records through
  `/api/hermes/memories`, supports layer/scope/limit filtering, validates JSON
  object content and `0..1` confidence before saving, updates records through
  `PATCH /api/hermes/memories/:id`, and requires a second click before
  permanent deletion through `DELETE /api/hermes/memories/:id`.
- Current skill-governance status: Settings now exposes backend-owned Hermes
  skill options for each built-in skill. Users can edit enabled state,
  body-read permission, memory-write permission, confirmation requirement,
  context character budget, and memory limit through the API instead of
  changing code or environment variables. `GET /api/hermes/resource-profile`
  now summarizes enabled skill count, max per-run context budget, memory
  fan-out, retention cleanup policy, managed Hermes tables, and self-hosted
  machine guidance; Settings displays the same profile before the editable
  skill cards so operators can lower budgets before a node is under pressure.
  Saving a skill refreshes the profile immediately, and the UI surfaces the
  returned guardrails plus CPU/RAM/disk guidance for external-Hermes and local
  model deployments.
- Current action-plan status: Hermes rule candidates are now recoverable after
  refresh through `GET /api/hermes/rule-candidates`, and Settings loads shadow
  candidates alongside enabled rules. Shadow `content_label` candidates are
  editable through `PATCH /api/hermes/rule-candidates/:candidateId` for label
  name, keyword conditions, and local history backfill only; service and SQL
  layers both require `status='shadow'`. Settings clears any prior simulation
  after saving a candidate, so confirmation must create a fresh auditable Hermes
  action plan from the edited candidate id, rerun shadow simulation, then
  require explicit user confirmation before enabling the rule.

### 4. Mail Organization

- Trigger: user reads unified inbox, applies Done, fixes Smart Inbox, accepts or
  blocks a sender, searches, opens saved views.
- State: `message_classification`, `feedback_events`,
  `smart_inbox_sender_rules`, `sender_screening_rules`,
  `sender_screening_events`, `search_documents`, `hermes_rules`,
  `hermes_rule_runs`, `labels`, `label_assignments`.
- API: global `/api/messages`, saved views, quick filters, Smart Inbox
  feedback, card bulk actions, Gatekeeper sender screening, Hermes rule
  execution.
- Worker: baseline classifier after mirror, future-message sender-rule reads,
  approved Hermes content-label rules, attachment text extraction.
- Failure: hidden/deleted message, non-visible bulk ids, Gatekeeper off,
  missing indexed body.
- Tests: global search, quick filter scope, feedback memory trail, Gatekeeper
  mode restrictions, bulk action visibility.
- Current search status: the Mail top-bar search now launches the global Search
  workspace with the submitted query and immediately calls the same
  `/api/messages?q=...&sort=smart` contract used by the Search page. The Search
  workspace keeps Thunderbird-style scope controls for sender, recipients,
  subject, and body/indexed attachment text plus quick filters such as unread
  and attachments.
- Current Hermes rule execution status: confirmed Hermes `content_label`
  rules create local account labels/left-side groups, can backfill matching
  synced history during action-plan confirmation, apply matching labels to
  newly mirrored messages in the worker, and now expose a manual active run
  path through `POST /api/hermes/rules/:ruleId/run` plus recent execution
  reads through `GET /api/hermes/rule-runs`. Pending rule candidates are read
  through `GET /api/hermes/rule-candidates` so Settings can show unapproved
  drafts after reload. Manual runs reuse the same
  idempotent local `label_assignments` write path, record and list `active`
  `hermes_rule_runs` results with matched/applied counts and sample message
  ids, and are wired into the Settings rule manager. Hermes rules still do not
  create provider-side Gmail/Outlook labels or queue provider writeback by
  default.

### 5. Accounts, Domains, And Migration

- Trigger: CSV preview/import, account transfer export/import, domain alias
  setup, catch-all, delivery log review.
- State: onboarding tasks, transfer packages without secrets, domains,
  destinations, aliases, delivery logs, alias delivery jobs.
- API: CSV import, account transfer, domains, aliases, catch-all, delivery logs.
- Worker: alias router and delivery runner; future MX gateway can feed the same
  durable job table.
- Failure: invalid CSV row, OAuth rows requiring reauth, transfer import always
  requiring fresh secrets, missing destination, duplicate catch-all.
- Tests: CSV validation, transfer secret redaction, domain route tests, alias
  router and delivery queue tests.
- Current domain control-plane status: Settings now exposes a backend-wired
  domain and alias console. The frontend can create domains, read generated DNS
  guidance, switch the active domain, add forwarding destinations, create
  aliases, read and update catch-all routing, and review recent delivery logs.
  The API now has a read contract for the current catch-all rule
  (`GET /api/domains/:domainId/catch-all`) in addition to the existing write
  path, and the Postgres store reads the durable `routing_rules` row without
  writing a default rule.
- Current migration UX status: Add Mail now renders backend CSV import previews
  as row-level tables with ready/OAuth/disabled/invalid status, errors, warnings,
  summary counts, and created task counts after execution. Account transfer can
  select export accounts from Sync Center, export a transfer-safe JSON package,
  import a JSON file back into the textarea, show imported reauthorization task
  details, and offer a direct Sync Center handoff when CSV OAuth rows or
  transfer imports require authorization. Sync Center now lets password-based
  reauthorization tasks submit a fresh authorization code or dedicated password
  directly against the task, with optional custom IMAP/SMTP endpoint overrides
  for personal domains and bridge deployments.
  CSV import now also includes a downloadable template, a safe public task DTO
  with source row numbers, and row-level "continue authorization" actions for
  imported web-login rows. Sync diagnostics now default to user-facing titles
  and recovery hints instead of raw operational event names.
- Remaining migration gap: inline row editing/fix-and-retry for CSV previews,
  richer sanitized provider diagnostics per failure code, and a less raw
  primary UX for transfer JSON remain useful follow-up polish.

### 6. Frontend Wiring

- Trigger: user navigates Mail, Add Mailbox, Sync Center, Search, Settings.
- State: React local state mirrors API DTOs only; preview data is a fallback.
- API: consume provider capabilities, top-bar global search, Hermes dock
  search QA, reader summary/translation, Search workspace filters, CSV import,
  transfer,
  Gatekeeper senders, Sync Center diagnostics and reauthorization tasks, Hermes
  settings, domains, self-hosted data maintenance.
- Failure: backend unavailable keeps preview state with visible status.
- Tests: API client route contracts, App behavior tests for each connected
  module, mobile/desktop layout checks where UI changes are visual.

### 7. Compose, Send Later, And Outbox

- Trigger: user drafts a reply, sends now, schedules send later, edits an
  outbox item, or sends a scheduled item immediately.
- State: `email_drafts`, `scheduled_sends`, account engine provider settings,
  OAuth refresh credentials, provider submit result ids.
- API: compose drafts, list saved drafts, send draft, schedule draft, list
  outbox, reschedule, cancel, send scheduled now.
- Worker: scheduled send runner, EmailEngine submit transport, native Gmail,
  Graph, and SMTP send transports.
- Failure: account paused, reauthorization required, missing native provider,
  missing send scope, provider submit rejection, retry/dead-letter after
  exhausted scheduled send attempts.
- Tests: compose service idempotency, EmailEngine submit contract, Gmail raw
  MIME send, Graph sendMail payload, SMTP envelope/auth failure handling,
  provider-aware scheduled runner, scheduled-store routing, OAuth send scopes,
  frontend outbox contract tests.
- Current frontend status: Mail now exposes a backend-wired compose panel for
  From identity, To/Cc/Bcc, ordinary draft auto-save, manual save draft, send
  now, send later, Hermes quick reply through
  `/api/hermes/skills/quick_reply/run`, and Hermes rewrite/polish through
  `/api/hermes/skills/rewrite_polish/run`. The compose editor now has compact
  production helpers for reusable follow-up/meeting/handoff templates, inline
  bold/italic/list/link/quote formatting that emits the existing `bodyHtml`
  draft field through a tested `features/compose` helper, and Hermes draft
  translation through `/api/hermes/skills/translate_text/run`. The send preview
  is now a compact review panel that renders the current controlled rich-text
  body, delivery warnings, estimated size, and attachment checklist before the
  user saves, sends, or schedules.
  The outbox panel loads
  `/api/accounts/:accountId/outbox`, and each row routes reschedule, send now,
  cancel, and edit-draft to the matching backend contract. Scheduled outbox
  edits load the app-owned draft detail, preserve the existing `draftId` and
  `scheduledId`, and update the same outbox row before save, send-now, or
  reschedule; they are intentionally excluded from background auto-save to avoid
  racing the scheduled-send state machine. A saved-drafts panel loads
  `/api/accounts/:accountId/compose/drafts`, lists ordinary `status=draft`
  rows outside the scheduled outbox, and loads a selected draft into the same
  compose editor so save/send/schedule continue updating the existing
  `draftId`. API client route tests and App behavior tests cover the full
  create/list/auto-save/update/send/schedule/list-outbox/edit/reschedule/send-now/cancel
  flow plus send-as, Cc/Bcc draft payloads, editable Hermes quick replies,
  provider-native send-as identities, editable Hermes polishing with
  writing-style feedback, backend-generated reply/reply-all/forward seeds, and
  backend compose preview.
- Current backend status: `GET /api/accounts/:accountId/compose/drafts`
  returns only ordinary editable draft rows for the account, ordered by newest
  update, with the same public draft DTO used by save/update/send paths. Outbox
  listing now returns active queue items only
  (`scheduled`, `queued`, `sending`, `failed`) instead of mixing terminal sent,
  cancelled, or dead-lettered rows into the user-facing queue. Compose now has
  pure seed/preview endpoints: `/api/accounts/:accountId/messages/:messageId/compose/reply`,
  `/reply-all`, `/forward`, and `/api/accounts/:accountId/compose/preview`.
  Seeds are generated from the app-owned mail read model, exclude verified
  self identities on reply-all, preserve `source_message_id`, and do not call
  provider transports. They become persisted ordinary drafts only after the user
  edits enough valid content for compose auto-save, explicitly saves, sends, or
  schedules.
- Current threaded reply status: saving a reply/reply-all draft resolves the
  source message's RFC Message-ID, historical `References` chain, and provider
  refs from the app-owned read model, stores them on the draft, and sends them
  through EmailEngine, native Gmail, native Graph, or native SMTP. Scheduled
  send claims hydrate the same `threading` object, so send-now, queued
  immediate sends, and scheduled worker delivery share the same provider
  threading behavior.
- Current attachment status: forward compose seeds now carry app-owned
  attachment summaries into the compose panel, draft preview, draft save, API
  send, and worker scheduled-send paths. Draft rows persist an
  `attachment_manifest` that exposes only local attachment ids to the frontend
  while keeping provider attachment ids internal for transport submission.
  EmailEngine sends reuse existing provider attachments through its submit
  `attachments[].reference` contract. Direct compose uploads now POST raw bytes
  to the API. The API streams those bytes into the shared Docker compose
  attachment volume, writes a local object-storage `storageKey` in the same
  `uploaded_file` manifest, records a sha256 checksum for new uploads, cleans
  up partial files on upload-limit failures, and avoids embedding large base64
  payloads in saved draft JSON when the backend is available. The web app keeps
  the older base64 path as a local/demo fallback. Worker queued-immediate and
  scheduled sends hydrate the referenced bytes from the shared Docker compose
  attachment volume, reject checksum mismatches for new uploads, strip internal
  storage keys from provider payloads, and keep the existing 20-file / 25 MB
  aggregate send limit. The worker now has a compose attachment cleanup lane
  that periodically queries active draft/outbox manifests, protects referenced
  `storageKey` values, and prunes stale unreferenced blob files, stale orphaned
  `.bin` files, stale `.bin.part` / `.json.part` leftovers, and stale invalid
  metadata pairs from the shared volume using bounded retention and per-run
  limits. Settings now exposes the same maintenance boundary through
  `GET /api/maintenance/compose-attachments` and bounded
  `POST /api/maintenance/compose-attachments/cleanup`, so self-hosted admins can
  inspect stale uploads, protected draft references, invalid metadata, scan
  limits, and manually prune unreferenced or broken local files without shell
  access. The same Settings maintenance panel now shows Hermes retention status
  across translation/summary caches, completed action plans, feedback, audit
  events, and skill runs, and can run bounded
  `POST /api/maintenance/hermes-retention/cleanup` batches without shell access.
  Forwarded
  provider attachments are still
  snapshotted at draft creation through the bounded EmailEngine attachment
  download adapter, so the private transport manifest keeps both
  `providerAttachmentId` and `contentBase64` while public draft DTOs expose only
  local attachment metadata. EmailEngine prefers the provider reference when
  both values exist; native Gmail, native Graph MIME, native SMTP, and the
  scheduled-send worker can use the same `contentBase64` bytes. If a native path
  receives only an EmailEngine provider reference it fails loudly instead of
  silently dropping the file.
- Remaining gap: the current compose panel is intentionally compact; rich
  editor, resumable/chunked uploads, provider-native large attachment sessions,
  tenant-level shared-mailbox discovery/admin permission inventory, and deeper
  Sent-folder parity checks are still separate slices.

## Product References

- Thunderbird: use local ownership, unified inbox, saved searches, filters,
  tags, privacy-first boundaries, and rebuildable search/index concepts.
- Foxmail: use low-friction Chinese provider setup, large-mailbox performance,
  server search awareness, concise account wording, templates, delayed send,
  alias and enterprise-mail details.
- Spark: target Smart Inbox, Gatekeeper, Done/Undo, Send Later, AI-assisted
  write/search/organize, and habit learning with explicit user confirmation.

## Immediate Delivery Order

1. Expand Compose into a full production editor: rich editor,
   resumable/chunked uploads, provider-native large attachment sessions,
   tenant-level Graph shared-mailbox discovery/admin inventory, and
   writing-style feedback for rewrite/polish through the single AI entry.
2. Harden Native IMAP/SMTP send with provider capability gating, live
   GreenMail/high-volume SMTP smoke, and tests around QQ/163/custom-domain
   recovery behavior.
3. Keep EmailEngine onboarding and sync center as the primary user path while
   Native Engine continues behind adapter boundaries.
4. Continue running frontend tests/build, backend tests/build, Docker compose
   config validation, and targeted stress/smoke commands in the kaifa workspace.
