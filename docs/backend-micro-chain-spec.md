# Backend Micro-Chain Specification

## Purpose

This document is the required granularity for Email Hub backend work. A backend
slice is not ready to implement until it names:

- user trigger;
- preconditions;
- local state fields;
- API route and DTO;
- worker or async command;
- failure and empty states;
- tests that prove the loop.

Spark defines the target user feel. Open source email systems define the
implementation discipline. Email Hub must keep the API/worker/Postgres split,
must keep UI-facing state local, and must keep Hermes as the only AI entry.

## Implementation Gate

Every new backend feature must answer these questions before code:

1. What exact user action starts the chain?
2. Which local rows prove the current state?
3. Which provider facts are mirrored, and which app facts are app-owned?
4. Which command/job is durable, idempotent, leased, retried, and dead-lettered?
5. Which IDs are returned to the frontend? They must be local IDs.
6. What is the undo, retry, partial failure, and empty-state behavior?
7. Which tests fail before implementation and pass after implementation?

## Internal-Test Acceptance Boundaries

Thunderbird is the boundary reference for account, identity, folder, search,
filter, and privacy semantics. Foxmail and Spark remain experience references
for low-friction account setup, practical recovery, fast compose, and Smart
Inbox speed. Before an internal-test module is treated as ready, it must keep
these invariants true:

1. Unified Inbox and Smart Inbox are views over local rows, not merged accounts.
   Message list, reader, compose reply, search result, and diagnostics must
   preserve local `accountId`, mailbox/view source, and provider group.
2. Saved views are virtual live views. Creating, editing, hiding, or deleting a
   saved view must not copy, move, archive, delete, or otherwise mutate source
   messages.
3. Top search is cross-account deterministic search; list filters are scoped to
   the current mailbox or saved view. Hermes may explain, draft, translate,
   summarize, and generate search parameters, but deterministic search remains
   the backend source of truth.
4. Compose always routes through explicit user action: choose From identity,
   save draft, preview warnings, send now, or schedule. Hermes may write or
   polish draft text, but it cannot send, schedule, delete, forward, or mutate
   mail without the user confirming the normal app action.
5. Provider capabilities drive UI visibility. Gmail, Outlook, 163, QQ, iCloud,
   Proton Bridge, and personal-domain flows must hide unsupported actions and
   avoid normal-user copy such as OAuth, IMAP, SMTP, Graph, backend API, or raw
   provider payload names.
6. Privacy defaults are conservative. Remote content, diagnostic output, and
   Hermes context/audit surfaces must be explicit, redacted where needed, and
   account-scoped when the operation reads account mail.
7. Docker self-hosting evidence must include persisted local state: synced mail
   remains readable/searchable when a provider is unavailable, drafts/outbox
   survive process restarts, and launch diagnostics do not leak secrets.

## Spark-Level Mailbox Loops

### Inbox Modes And Smart Cards

User trigger:

- Settings changes inbox mode: `classic`, `smart_unread_cards`, or
  `focused_list`.
- Card actions: mark visible card items as read, done, or deleted.
- Sender correction: show a sender in the primary list.

Preconditions:

- Account sync has mirrored folders, messages, state, classification, and
  locations.
- Smart sections are projections over local rows, not provider folders.

State:

- `user_mail_preferences.inbox_mode`
- `message_state.unread`
- `message_state.done_at`
- `message_classification.bucket`
- `smart_inbox_sender_rules.rule_type`
- `smart_inbox_card_actions.action`

DTO:

```text
InboxViewDto {
  mode,
  sections: [{ key, title, count, messageIds, items }],
  emptyState?
}

BulkCardActionDto {
  acceptedCount,
  skippedCount,
  undoToken?,
  undoExpiresAt?
}
```

Worker:

- `classify_inbox_category` after message mirror.
- `rebuild_inbox_projection` after feedback or preference changes.
- `bulk_card_action` over explicit visible local message ids only.

Errors and empty states:

- No unread smart-card mail returns `emptyState: "no_new_mail"`.
- Classic mode returns chronological list without smart card group actions.
- Bulk card action must reject non-visible message ids.

Tests:

- Unread people mail appears in a people/main section.
- Read mail leaves unread smart cards and can appear in Seen.
- Card bulk action mutates only visible ids.
- Classic inbox ignores smart card grouping.
- Sender "show in primary" affects future mail from that sender.

### Smart Inbox Feedback

User trigger:

- Mark important/not important.
- Move sender/message to Personal, Notifications, Newsletters, or Feed.
- Always important sender.
- Mute sender.

Preconditions:

- Message belongs to account and is visible.
- Deleted messages reject feedback.

State:

- `feedback_events.event_type = smart_inbox.<action>`
- `message_classification.bucket`
- `message_classification.priority_score`
- `message_classification.reasons`
- `smart_inbox_sender_rules`
- `hermes_memories(layer='contact_memory')`

Actions:

```text
mark_important
mark_not_important
move_to_personal
move_to_notifications
move_to_newsletters
move_to_feed
always_important_sender
mute_sender
```

DTO:

```text
SmartInboxFeedbackResult {
  feedbackEventId,
  accountId,
  messageId,
  classification: { bucket, priorityScore, reasons },
  senderRule?
}
```

Worker:

- Future message classification reads sender rules before default rules.
- Hermes may read contact memory, but cannot replace stored classification.

Errors:

- Unknown action -> `invalid_smart_inbox_feedback`.
- Missing store -> `smart_inbox_feedback_unavailable`.
- Not visible -> 404 or undefined result.

Tests:

- Each action writes `feedback_events`.
- Personal/Notifications/Newsletters map to stable buckets.
- Sender-level actions create or replace sender rules.
- Feedback writes editable Hermes memory.
- Future classification reads sender rule case-insensitively.

### Gatekeeper

User trigger:

- New sender card shows Accept, Block Sender, or Block Domain.
- Bulk accept/block only applies in the top New Senders mode.

Preconditions:

- Sender has no accepted/blocked decision.
- Gatekeeper mode is not `off_accept_all`.

State:

- `gatekeeper_settings.mode = before_inbox | inside_email | off_accept_all`
- `sender_screening_rules.status = unknown | accepted | blocked`
- `sender_screening_rules.scope = email | domain`
- `sender_screening_events.action`
- `message_classification.bucket = P7 Screen`

Routes:

```text
GET  /api/screening/senders?accountId=:accountId
POST /api/screening/senders/bulk
POST /api/screening/senders/:senderId/accept
POST /api/screening/senders/:senderId/block
POST /api/screening/domains/:domain/block
```

Bulk payloads must include `accountId`, `senderIds`, and `action`; the service
only allows bulk accept/block in `before_inbox` mode. Sender ids from another
account are treated as missing and must not generate events.
Single sender and domain decisions must also include `accountId`; when
Gatekeeper is `off_accept_all`, the service rejects decisions before writing
rules, events, classifications, or Hermes memory.

DTO:

```text
GatekeeperSenderDto {
  senderId,
  email,
  domain,
  status,
  messageCount,
  latestMessageId,
  bulkAvailable
}
```

Worker:

- `screen_new_sender` runs after message mirror.
- Accepted senders are released into normal Smart Inbox buckets.
- Blocked senders are hidden or routed to blocked projection without notifying
  the sender.

Errors:

- Gatekeeper off -> no New Senders rows.
- Block domain is distinct from address-level block.
- Subscription downgrade must keep existing blocked rules but may disallow new
  blocks if feature gating is later added.

Tests:

- First-time sender enters Screen.
- Accept releases current and future messages.
- Block sender does not notify sender.
- Block domain affects other addresses on same domain.
- Bulk accept/block rejects unavailable modes.

### Done, Undo, And Undone

User trigger:

- Press Done on a message/thread/category.
- Click Undo within the short toast window.
- Click Undone from Archive/Done view after the undo window.

Preconditions:

- Message or thread is visible and not deleted.
- Undo token has not expired.

State:

- `message_state.archived`
- `message_state.done_at`
- `message_state.last_action_token`
- `message_state.undo_expires_at`
- `engine_commands.command_type = archive | move`

Routes:

```text
POST /api/accounts/:accountId/messages/:messageId/actions
  { action: "done" }

POST /api/accounts/:accountId/messages/:messageId/actions
  { action: "undo_done", undoToken }

POST /api/accounts/:accountId/messages/:messageId/actions
  { action: "undone" }
```

DTO:

```text
DoneActionDto {
  messageId,
  doneState,
  undoToken?,
  undoExpiresInMs,
  providerTarget
}
```

Worker:

- Done updates local state first and enqueues provider archive/move command.
- Undo enqueues move back to inbox if provider command already ran.
- Bulk Done uses explicit visible ids and should cap large batches.

Errors:

- Expired undo -> `undo_expired`.
- Search result bulk Done -> reject until search-bulk semantics are explicit.
- Provider partial failure leaves command retry/dead-letter evidence.

Tests:

- Done hides Inbox item locally and returns undo token.
- Undo within window restores Inbox.
- Expired undo fails without changing state.
- Category bulk Done touches only visible ids.
- Provider archive command is idempotent.

### Send Later And Outbox

User trigger:

- Composer schedules a draft.
- Outbox lets user edit time, edit draft, send now, or delete schedule.

Preconditions:

- Draft is valid and not already sent.
- `scheduled_at` is within max allowed future window.
- Account can send.

State:

- `scheduled_sends.status = scheduled | queued | sending | sent | cancelled | failed`
- `scheduled_sends.scheduled_at`
- `scheduled_sends.draft_id`
- `scheduled_sends.attempts`
- `scheduled_sends.not_before`
- `scheduled_sends.last_error`

Routes:

```text
POST   /api/accounts/:accountId/compose/drafts/:draftId/schedule
GET    /api/accounts/:accountId/outbox
POST   /api/accounts/:accountId/outbox/:scheduledId/send-now
PATCH  /api/accounts/:accountId/outbox/:scheduledId
DELETE /api/accounts/:accountId/outbox/:scheduledId
```

DTO:

```text
ScheduledSendDto {
  id,
  accountId,
  draftId,
  scheduledAt,
  status,
  canEdit,
  canSendNow,
  canDelete,
  lastError?
}
```

Worker:

- `scheduled_send_due` claims due rows.
- Submit through the same compose/send transport.
- Mark sent or retry/dead-letter.

Errors:

- Too far in future -> `schedule_too_far`.
- Paused/reauth account -> `send_later_unavailable`.
- Cancelled schedule must never send.

Tests:

- Schedule appears in Outbox.
- Due row sends once under concurrent workers.
- Send-now cancels schedule and sends once.
- Delete prevents later send.
- Failed provider call retries then dead-letters.

## Hermes Micro-Loops

### Summary

User trigger:

- Generate summary for a thread with mode: short, detailed, or action points.
- Optional preference: always summarize messages from a sender.

State:

- `hermes_skill_runs.skill = thread_summarize`
- `hermes_audit_events.read_message_ids`
- `hermes_memories(scope='sender:<email>')` for auto-summary preference

DTO:

```text
ThreadSummaryDto {
  skillRunId,
  threadId,
  mode,
  language,
  summaryText,
  actionItems?
}
```

Tests:

- Each mode uses a distinct structured prompt contract.
- Empty thread returns `nothing_to_summarize`.
- Auto-summary sender preference queues future summaries.
- Audit records read message ids and memory ids.

### Reply, Compose, And Writing Style

User trigger:

- Generate reply draft.
- Quick reply: interested, not interested, thanks, custom.
- Rewrite/proofread/expand/shorten/tone.
- User edits generated draft and sends.

State:

- `email_drafts.source = hermes_reply | manual`
- `email_drafts.hermes_skill_run_id`
- `hermes_feedback.feedback_type = reply_draft_revision`
- `hermes_memories(layer='writing_style_profile')`

DTO:

```text
HermesDraftDto {
  skillRunId,
  draftText,
  scenario,
  editable: true,
  sendsDirectly: false
}
```

Worker:

- None for preview generation.
- Draft send remains explicit compose/send.
- Draft diff can write memory after feedback.

Tests:

- Hermes reply never sends directly.
- Quick reply creates editable text.
- Draft diff writes style memory when meaningfully changed.
- Prompt history/memory usage is auditable.

### Translate

User trigger:

- Translate full thread or single message.
- Show original.
- Always translate or never translate a source language.

State:

- `hermes_skill_runs.skill = translate_text`
- `translation_preferences.source_language`
- `translation_preferences.mode = always | never`
- view-level `showing_original`

DTO:

```text
TranslationDto {
  scope,
  threadId,
  messageId?,
  sourceLanguage,
  targetLanguage,
  translatedText,
  originalAvailable
}
```

Tests:

- Message translation does not overwrite thread translation.
- Show Original switches view state without deleting result.
- Always/Never language rules affect future auto-translation.
- Audit records the exact message ids used.

### Rule Learning And Automation

Reference model:

- Inbox Zero stores rule, action, executed rule, executed action, scheduled
  action, thread tracker, draft send log, and automation run evidence.
- Email Hub must keep the safer path: simulation and approval before automation.

State:

- `hermes_rule_candidates.status = shadow | approved | dismissed`
- `hermes_rule_runs.mode = shadow | active`
- `hermes_rules.enabled`
- `hermes_audit_events`
- `executed_actions.status = skipped | applying | applied | error`

Worker:

- Provider webhook or mirror event can enqueue `rule_evaluation`.
- Shadow mode writes matches without provider mutation.
- First live phase is classification-only.

Tests:

- No-match writes skipped evidence.
- Match writes applying then applied/error.
- Delayed action executes once.
- Rule simulation never mutates mail.
- AI cannot send, delete, block, or unsubscribe without explicit approval.

## Mail Sync, Cache, And Search

### Physical Provider Facts

Rule:

- Unified inbox is a read model, not a virtual provider folder.
- Physical uniqueness is account plus provider folder plus provider uid/ref.

State:

- `mailboxes.path`
- `mailboxes.delimiter`
- `mailboxes.parent_path`
- `mailboxes.role`
- `mailboxes.selectable`
- `mailboxes.subscribed`
- `mailboxes.uid_validity`
- `mailboxes.uid_next`
- `mailboxes.highest_modseq`
- `message_locations.mailbox_id`
- `provider_message_refs.provider_uid`

Worker:

- `folder_discovery`
- `mailbox_sync`
- `message_body_fetch`

### Provider Capability Catalog

Trigger:

- Add Mailbox page load.
- Provider card click.
- Compose and account settings capability checks.

Routes:

- `GET /api/mail-providers/capabilities`
- `GET /api/mail-providers/capabilities/:provider`

State:

- In-code first-party catalog for MVP.
- Later optional DB overrides for deployment-specific provider support.

Fields:

- Provider label and connection label.
- Web login, scan login, mailbox password, local bridge.
- Labels, contacts, calendar, server search.
- Recall, read receipts, large attachments, cloud attachments.
- Online archive, junk filtering.
- Group sending and send-on-behalf.
- User-facing setup hints.

Tests:

- Catalog includes Gmail, Outlook, iCloud, 163, QQ, Tencent Exmail,
  Proton Bridge, and custom domain.
- API response does not contain OAuth, Graph, IMAP, SMTP, or API wording.
- Aliases such as `qqmail`, `exmail`, `office365`, and `proton` resolve.
- Unsupported providers return 404 without inventing capabilities.
- `attachment_metadata`
- `thread_builder`
- `search_index`
- `action_reconcile`

Tests:

- Folder delimiter and special-use roles mirror correctly.
- UIDVALIDITY reset triggers folder rebuild.
- Rename/delete folder preserves local message identity where possible.
- Unified Inbox sorts across accounts without copying rows.

### Flags And Actions

State:

- `message_state.unread`
- `message_state.starred`
- `message_state.archived`
- `message_state.deleted_at`
- future flags: answered, draft, junk, forwarded, important, hasAttachments

Action distinctions:

- Mark read/unread.
- Star/unstar.
- Move to Trash.
- Expunge from Trash.
- Move folder.
- Copy folder.
- Archive/Done.

Tests:

- Delete outside Trash moves to Trash.
- Delete inside Trash expunges when provider supports it.
- Move returns new provider uid/ref when provider gives one.
- Cross-account move is either unsupported or compensating copy/delete, never
  silent partial success.
- Provider command idempotency prevents duplicate mutations.

### Search

State:

- `search_documents.subject`
- `search_documents.sender`
- `search_documents.recipients`
- `search_documents.body_text`
- `search_documents.attachment_text`
- `search_documents.message_id`
- `search_documents.indexed_at`

Query layers:

- Local DB search for headers, subject, recipients, date, flags, labels, and
  mirrored body text.
- Provider body search only as a later fallback for missing local text.
- Hermes search QA must cite local message ids.

Attachment extraction lane:

```text
message mirror writes attachment_text_extraction_jobs
-> worker claims job with account-level serialization
-> EmailEngine attachment endpoint returns bytes
-> extractor returns text or non-retryable unsupported-format error
-> complete merges extracted text into search_documents
-> retryable failures requeue with backoff
-> non-retryable or exhausted failures dead-letter with redacted error
```

Tests:

- Local search merges header and body hits deterministically.
- Attachment text jobs are idempotent.
- Attachment extraction runner downloads, extracts, completes, retries, and
  dead-letters unsupported formats deterministically.
- Search timeout returns partial result metadata.
- Hermes answer only uses matched messages and returns citations.

### MIME And Attachments

State:

- `attachments.part_id`
- `attachments.content_id`
- `attachments.disposition`
- `attachments.content_type`
- `attachments.filename`
- `attachments.byte_size`
- `attachments.inline`
- `attachments.embedded`
- `attachments.scan_status`

Tests:

- Inline images are not shown as normal downloads unless requested.
- Attachment download uses local attachment id, not provider id.
- MIME type spoofing is recorded and does not trust extension alone.
- Oversized body/attachment metadata does not block message list rendering.

## Alias, Domain, And MX Boundary

### Domain Verification

State:

- `alias_domains.ownership_txt_token`
- `alias_domains.ownership_verified_at`
- `alias_domains.mx_verified_at`
- `alias_domains.spf_verified_at`
- `alias_domains.dkim_verified_at`
- `alias_domains.dmarc_verified_at`
- `alias_domains.sending_verified_at`
- `alias_domains.last_dns_check_at`
- `alias_domains.last_dns_error`
- `domain_dns_checks.observed_records_json`

Routes:

```text
POST /alias-domains
POST /alias-domains/:id/verify-ownership
POST /alias-domains/:id/check-dns
PATCH /alias-domains/:id
```

Tests:

- TXT ownership must pass before MX activation.
- MX pass is separate from SPF/DKIM/DMARC sending readiness.
- DNS errors are visible and timestamped.

### Destinations, Aliases, Catch-All

State:

- `alias_destinations.status = pending | verified | disabled | bouncing`
- `aliases.status = active | disabled | deleted`
- `aliases.created_mode = manual | api | catch_all | import`
- `alias_destination_links`
- `aliases.emails_forwarded`
- `aliases.emails_blocked`
- `aliases.last_forwarded_at`
- `catch_all.mode = reject | forward | auto_create | discard`

Routes:

```text
POST /destinations
POST /destinations/:id/resend-verification
POST /destinations/verify
POST /aliases
PATCH /aliases/:id
GET  /aliases/:id/logs
```

Tests:

- Unverified destination disables forwarding.
- Exact alias wins over catch-all.
- Catch-all off rejects unknown recipients.
- Catch-all auto-create marks alias `created_mode=catch_all`.

### Forward, Reply, Bounce, Loop Prevention

State:

- `reverse_aliases(alias_id, contact_email, reverse_address)`
- `inbound_messages`
- `outbound_messages`
- `delivery_logs`
- `failed_deliveries`
- `blocked_senders`

Delivery log fields:

```text
phase: forward | reply
action: forward | reply | block | bounce | reject | quarantine
status: accepted | routed | forwarded | blocked | rejected | bounced | failed
alias_id
domain_id
destination_id
reverse_alias_id
mail_from
rcpt_to
from_header
message_id
gateway_queue_id
smtp_code
diagnostic_code
spam_score
auth_results
raw_ref
```

Gateway boundary:

- API does not accept SMTP directly.
- API does not own Postfix queues, DKIM signing, SPF/DMARC/ARC verification,
  greylisting, SRS, TLS SMTP, or queue retry.
- Future `mx-gateway` owns public MX and calls API with events:
  `InboundAccepted`, `RouteDecisionRequested`, `ForwardRequested`,
  `BounceReceived`, `DeliveryFinalized`.

Tests:

- Reply must come from verified destination.
- Reverse alias cannot be used as normal inbound sender.
- VERP/signature tamper is rejected.
- Auto replies and MAILER-DAEMON backscatter do not loop.
- Duplicate Message-ID is idempotent.
- Bounce writes failed delivery and updates original log.

## Source Index

Spark:

- Smart Inbox and inbox modes: https://sparkmailapp.com/help/manage-your-inbox/customize-your-inbox
- Sender grouping and primary list: https://sparkmailapp.com/help/manage-your-inbox/group-emails-by-sender
- Gatekeeper: https://sparkmailapp.com/help/sending-emails/accept-or-block-new-senders
- Mark as Done: https://sparkmailapp.com/help/manage-your-inbox/mark-as-done
- Undo: https://sparkmailapp.com/help/tips-tricks/undo-the-last-action
- Send Later: https://sparkmailapp.com/help/sending-emails/schedule-an-email-to-send-later
- Spark AI enablement: https://sparkmailapp.com/help/spark-ai/how-to-enable-ai-features-in-spark-
- Spark AI desktop: https://sparkmailapp.com/help/spark-ai/spark-ai-desktop
- AI summary and translate: https://sparkmailapp.com/help/spark-ai/summarize-and-translate-emails-with-ai
- AI compose and drafts: https://sparkmailapp.com/help/spark-ai/write-new-emails-and-edit-drafts-with-ai-compose
- AI security: https://sparkmailapp.com/help/spark-ai/spark-ai-security-and-data
- Writing style: https://sparkmailapp.com/help/spark-ai/my-writing-style-for-spark-ai

Open source AI mail:

- Inbox Zero architecture: https://github.com/elie222/inbox-zero/blob/9ab072e0137ca2c95be069b2341cda8aa2f2d01a/ARCHITECTURE.md
- Inbox Zero Google webhook: https://github.com/elie222/inbox-zero/blob/9ab072e0137ca2c95be069b2341cda8aa2f2d01a/apps/web/app/api/google/webhook/route.ts
- Inbox Zero process history: https://github.com/elie222/inbox-zero/blob/9ab072e0137ca2c95be069b2341cda8aa2f2d01a/apps/web/utils/webhook/process-history-item.ts
- Inbox Zero rules: https://github.com/elie222/inbox-zero/blob/9ab072e0137ca2c95be069b2341cda8aa2f2d01a/apps/web/utils/ai/choose-rule/run-rules.ts
- Inbox Zero schema: https://github.com/elie222/inbox-zero/blob/9ab072e0137ca2c95be069b2341cda8aa2f2d01a/apps/web/prisma/schema.prisma
- Zero README: https://github.com/Mail-0/Zero/blob/64c5480c341750578da0746f2db9ad84da686334/README.md
- Zero server entry: https://github.com/Mail-0/Zero/blob/64c5480c341750578da0746f2db9ad84da686334/apps/server/src/main.ts

Webmail and sync:

- Nextcloud Mail: https://github.com/nextcloud/mail
- Roundcube: https://github.com/roundcube/roundcubemail
- Cypht: https://github.com/cypht-org/cypht
- Mailpile: https://github.com/mailpile/Mailpile

Alias and domain:

- SimpleLogin reverse alias: https://simplelogin.io/docs/getting-started/reverse-alias/
- SimpleLogin custom domain: https://simplelogin.io/docs/custom-domain/add-domain/
- SimpleLogin DNS example: https://simplelogin.io/docs/custom-domain/registrars/namecheap/namecheap/
- SimpleLogin source: https://github.com/simple-login/app
- addy.io recipient: https://addy.io/help/adding-a-recipient/
- addy.io custom domain: https://addy.io/help/adding-a-custom-domain/
- addy.io reply using alias: https://addy.io/help/replying-to-email-using-an-alias/
- docker-mailserver aliases: https://docker-mailserver.github.io/docker-mailserver/latest/config/account-management/overview/
- docker-mailserver DKIM/DMARC/SPF: https://docker-mailserver.github.io/docker-mailserver/latest/config/best-practices/dkim_dmarc_spf/
- Cloudflare Email Routing: https://developers.cloudflare.com/email-service/get-started/route-emails/
