# Current Delivery Plan

Date: 2026-06-15

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
  SMTP delivery, both API immediate sends and worker scheduled sends now make a
  best-effort IMAP append into the Sent mailbox using a separate
  `imap_password` when present, preserving the same Message-ID, Bcc, reply
  headers, bodies, and attachments in the RFC 822 copy. Sent append failures do
  not fail the already accepted SMTP send, preventing duplicate retries. OAuth
  authorization and Microsoft refresh scopes include the send scopes needed by
  these transports. API immediate sends and worker scheduled native sends now
  detect Gmail/Graph auth, permission, missing refresh credential, rejected
  OAuth refresh failures, and SMTP password/auth failures, mark the account
  `reauth_required`, and create or reuse Sync Center reauthorization tasks.
- Current API send status: API-process immediate sends now have a native
  transport dispatcher. It reads `account_provider_settings.native_provider`,
  refreshes OAuth access tokens through `account_credentials` and
  `stored_secrets`, sends Gmail mail through `users.messages.send`, and sends
  Outlook mail through Microsoft Graph `/me/sendMail`, and sends native IMAP
  account mail through SMTP using stored provider settings and stored secrets.
  Sync Center exposes native-send reauthorization tasks and starts the existing
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
  `/users/{id | userPrincipalName}/sendMail`; API immediate native sends and
  worker scheduled native sends both re-resolve the current verified provider
  identity at submit time. They only target `/users/{shared}/sendMail` when the
  identity capabilities explicitly state `sendMailTargetMode=users`,
  `userSendMailEligible=true`, and provide a target mailbox id or UPN. Otherwise
  they keep the safer `/me/sendMail` plus Graph `from` behavior that was
  actually verified. Draft creation, draft updates, scheduling, API immediate
  send, API send-now, and the worker scheduled-send path re-check the selected
  From address against the current verified identity set before provider
  submission. EmailEngine, native Gmail, native Graph, native SMTP, and
  scheduled-send worker paths all carry the selected From identity; SMTP keeps
  the authenticated account as the envelope sender while allowing the verified
  alias in the visible From header. Gmail authorization now explicitly includes
  `gmail.settings.basic`, and Outlook authorization plus refresh flows include
  `Mail.Send.Shared` for shared-mailbox submissions when Exchange grants exist.
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
- Remaining gap: chunked/object-storage uploads for larger attachments, Graph
  `/users/{shared}/sendMail` verification UI/admin workflow for Full Access
  Sent Items placement, deeper command semantics, and live high-volume
  IMAP/SMTP provider smoke tests still need focused backend slices before
  Native Engine can be promoted from parallel track to default path. Native
  provider APIs do not provide the same idempotency guarantee as EmailEngine's
  submit endpoint yet.

### 3. Hermes Single AI Entry

- Trigger: translate, summarize, search QA, write reply, polish, triage, label
  suggest, follow-up, newsletter cleanup.
- State: Hermes runtime settings, runs, audit events, editable memories,
  draft feedback, reviewed rules.
- API: `/api/hermes/*` skills, runtime, providers, memories, rules, audit log.
- Worker: no silent write actions; worker only consumes explicit mail actions
  and scheduled jobs.
- Failure: missing endpoint/model/key, external auth required, provider failure,
  prompt output parse failure.
- Tests: provider catalog/probe, runtime config, audit log, memory context,
  each skill with preview-only assertions.
- Current writing-style status: Hermes reply drafts, quick replies, and
  rewrite/polish results now feed the same explicit final-edit feedback path.
  Saving, sending, scheduling, or updating a Hermes-polished compose draft
  carries the `skillRunId` and Hermes draft text into compose persistence; the
  feedback store writes `writing_style_profile` memories when the user edits
  the result and records accepted rewrite/polish output as positive style
  preference without exposing draft body outside Hermes memory/audit tables.

### 4. Mail Organization

- Trigger: user reads unified inbox, applies Done, fixes Smart Inbox, accepts or
  blocks a sender, searches, opens saved views.
- State: `message_classification`, `feedback_events`,
  `smart_inbox_sender_rules`, `sender_screening_rules`,
  `sender_screening_events`, `search_documents`.
- API: global `/api/messages`, saved views, quick filters, Smart Inbox
  feedback, card bulk actions, Gatekeeper sender screening.
- Worker: baseline classifier after mirror, future-message sender-rule reads,
  attachment text extraction.
- Failure: hidden/deleted message, non-visible bulk ids, Gatekeeper off,
  missing indexed body.
- Tests: global search, quick filter scope, feedback memory trail, Gatekeeper
  mode restrictions, bulk action visibility.

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

### 6. Frontend Wiring

- Trigger: user navigates Mail, Add Mailbox, Sync Center, Search, Settings.
- State: React local state mirrors API DTOs only; preview data is a fallback.
- API: consume provider capabilities, global search, CSV import, transfer,
  Gatekeeper senders, Sync Center diagnostics and reauthorization tasks, Hermes
  settings, domains.
- Failure: backend unavailable keeps preview state with visible status.
- Tests: API client route contracts, App behavior tests for each connected
  module, mobile/desktop layout checks where UI changes are visual.

### 7. Compose, Send Later, And Outbox

- Trigger: user drafts a reply, sends now, schedules send later, edits an
  outbox item, or sends a scheduled item immediately.
- State: `email_drafts`, `scheduled_sends`, account engine provider settings,
  OAuth refresh credentials, provider submit result ids.
- API: compose drafts, send draft, schedule draft, list outbox, reschedule,
  cancel, send scheduled now.
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
  From identity, To/Cc/Bcc, save draft, send now, send later, Hermes quick
  reply through `/api/hermes/skills/quick_reply/run`, and Hermes rewrite/polish
  through `/api/hermes/skills/rewrite_polish/run`. The outbox panel loads
  `/api/accounts/:accountId/outbox`, and each row routes reschedule, send now,
  cancel, and edit-draft to the matching backend contract. Scheduled outbox
  edits load the app-owned draft detail, preserve the existing `draftId` and
  `scheduledId`, and update the same outbox row before save, send-now, or
  reschedule. API client route tests and App behavior tests cover the full
  create/send/schedule/list/edit/reschedule/send-now/cancel flow plus send-as,
  Cc/Bcc draft payloads, editable Hermes quick
  replies, provider-native send-as identities, editable Hermes polishing with
  writing-style feedback,
  backend-generated reply/reply-all/forward
  seeds, and backend compose preview.
- Current backend status: outbox listing now returns active queue items only
  (`scheduled`, `queued`, `sending`, `failed`) instead of mixing terminal sent,
  cancelled, or dead-lettered rows into the user-facing queue. Compose now has
  pure seed/preview endpoints: `/api/accounts/:accountId/messages/:messageId/compose/reply`,
  `/reply-all`, `/forward`, and `/api/accounts/:accountId/compose/preview`.
  Seeds are generated from the app-owned mail read model, exclude verified
  self identities on reply-all, preserve `source_message_id`, and do not call
  provider transports or persist drafts until the user explicitly saves/sends.
- Current threaded reply status: saving a reply/reply-all draft resolves the
  source message's RFC Message-ID, historical `References` chain, and provider
  refs from the app-owned read model, stores them on the draft, and sends them
  through EmailEngine, native Gmail, native Graph, or native SMTP. Scheduled
  send claims hydrate the same `threading` object, so send-now and worker
  delivery behave the same as immediate API sends.
- Current attachment status: forward compose seeds now carry app-owned
  attachment summaries into the compose panel, draft preview, draft save, API
  send, and worker scheduled-send paths. Draft rows persist an
  `attachment_manifest` that exposes only local attachment ids to the frontend
  while keeping provider attachment ids internal for transport submission.
  EmailEngine sends reuse existing provider attachments through its submit
  `attachments[].reference` contract. Direct compose uploads now enter the
  same manifest as `uploaded_file` content snapshots with decoded-size
  validation, 20-file / 25 MB limits, a compose-specific API body cap, and an
  Nginx self-hosting body cap. Forwarded provider attachments are also
  snapshotted at draft creation through the bounded EmailEngine attachment
  download adapter, so the private transport manifest keeps both
  `providerAttachmentId` and `contentBase64` while public draft DTOs expose only
  local attachment metadata. EmailEngine prefers the provider reference when
  both values exist; native Gmail, native Graph MIME, native SMTP, and the
  scheduled-send worker can use the same `contentBase64` bytes. If a native path
  receives only an EmailEngine provider reference it fails loudly instead of
  silently dropping the file.
- Remaining gap: the current compose panel is intentionally compact; rich
  editor, chunked/object-storage uploads for larger files, provider-native
  permission discovery for shared mailbox send-as, draft-list editing outside
  the outbox, and Sent-folder provider parity are still separate slices.

## Product References

- Thunderbird: use local ownership, unified inbox, saved searches, filters,
  tags, privacy-first boundaries, and rebuildable search/index concepts.
- Foxmail: use low-friction Chinese provider setup, large-mailbox performance,
  server search awareness, concise account wording, templates, delayed send,
  alias and enterprise-mail details.
- Spark: target Smart Inbox, Gatekeeper, Done/Undo, Send Later, AI-assisted
  write/search/organize, and habit learning with explicit user confirmation.

## Immediate Delivery Order

1. Expand Compose into a full production editor: rich editor, chunked/object
   storage uploads, Graph shared-mailbox Sent Items strategy, and
   writing-style feedback for rewrite/polish through the single AI entry.
2. Harden Native IMAP/SMTP send with provider capability gating, live
   GreenMail/high-volume SMTP smoke, and tests around QQ/163/custom-domain
   recovery behavior.
3. Keep EmailEngine onboarding and sync center as the primary user path while
   Native Engine continues behind adapter boundaries.
4. Continue running frontend tests/build, backend tests/build, Docker compose
   config validation, and targeted stress/smoke commands in the kaifa workspace.
