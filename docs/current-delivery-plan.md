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
  kept in the SMTP envelope, and sanitized provider errors. OAuth authorization
  and Microsoft refresh scopes include the send scopes needed by these
  transports. API immediate sends and worker scheduled native sends now detect
  Gmail/Graph auth, permission, missing refresh credential, rejected OAuth
  refresh failures, and SMTP password/auth failures, mark the account
  `reauth_required`, and create or reuse Sync Center reauthorization tasks.
- Current API send status: API-process immediate sends now have a native
  transport dispatcher. It reads `account_provider_settings.native_provider`,
  refreshes OAuth access tokens through `account_credentials` and
  `stored_secrets`, sends Gmail mail through `users.messages.send`, and sends
  Outlook mail through Microsoft Graph `/me/sendMail`, and sends native IMAP
  account mail through SMTP using stored provider settings and stored secrets.
  Sync Center exposes native-send reauthorization tasks and starts the existing
  OAuth or IMAP/SMTP recovery flows from the frontend.
- Remaining gap: send identities, aliases-as-from, rich attachments, IMAP Sent
  folder append, and deeper command semantics still need focused backend slices
  and tests before Native Engine can be promoted from parallel track to default
  path. Native provider APIs do not provide the same idempotency guarantee as
  EmailEngine's submit endpoint yet.

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
  To/Cc/Bcc, save draft, send now, send later, Hermes quick reply through
  `/api/hermes/skills/quick_reply/run`, and Hermes rewrite/polish through
  `/api/hermes/skills/rewrite_polish/run`. The outbox panel loads
  `/api/accounts/:accountId/outbox`, and each row routes reschedule, send now,
  and cancel to the matching backend contract. API client route tests and App
  behavior tests cover the full create/send/schedule/list/reschedule/send-now/
  cancel flow plus Cc/Bcc draft payloads, editable Hermes quick replies, and
  editable Hermes polishing.
- Current backend status: outbox listing now returns active queue items only
  (`scheduled`, `queued`, `sending`, `failed`) instead of mixing terminal sent,
  cancelled, or dead-lettered rows into the user-facing queue.
- Remaining gap: the current compose panel is intentionally compact; rich
  editor, attachments, reply-all/forward modes, preview, send-as, and
  Sent-folder provider parity are still separate slices.

## Product References

- Thunderbird: use local ownership, unified inbox, saved searches, filters,
  tags, privacy-first boundaries, and rebuildable search/index concepts.
- Foxmail: use low-friction Chinese provider setup, large-mailbox performance,
  server search awareness, concise account wording, templates, delayed send,
  alias and enterprise-mail details.
- Spark: target Smart Inbox, Gatekeeper, Done/Undo, Send Later, AI-assisted
  write/search/organize, and habit learning with explicit user confirmation.

## Immediate Delivery Order

1. Expand Compose into a full production editor: rich editor, attachments,
   reply-all, forward, preview, send-as, and writing-style feedback for
   rewrite/polish through the single AI entry.
2. Harden Native IMAP/SMTP send with provider capability gating, live
   GreenMail/high-volume SMTP smoke, Sent-folder append, and tests around
   QQ/163/custom-domain recovery behavior.
3. Keep EmailEngine onboarding and sync center as the primary user path while
   Native Engine continues behind adapter boundaries.
4. Continue running frontend tests/build, backend tests/build, Docker compose
   config validation, and targeted stress/smoke commands in the kaifa workspace.
