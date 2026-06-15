# Spark-Like Backend Chain

## Purpose

Email Hub should feel Spark-like because the backend preserves the same product chain:

```text
connect accounts
-> sync and mirror mail
-> classify into readable sections
-> expose fast list/detail/search APIs
-> let the user act in one step
-> let Hermes assist, never silently mutate
-> learn from corrections
-> recover from sync/auth/provider failures
```

This file is the backend contract for that chain. Frontend work should consume these contracts, not invent parallel state.

For implementation-level granularity, use `docs/backend-micro-chain-spec.md`.
Every backend slice must name trigger, state, DTO, worker, failure states, and
tests before code changes.

## Spark Reference Granularity

Spark-level parity is not one feature called "AI sorting". It is a set of small loops:

- Smart Inbox aggregates accounts and sorts new mail into categories such as Personal, Notifications, and Newsletters; read mail falls to Seen.
- Users can customize displayed Smart Inbox cards and switch back to chronological Classic Inbox.
- User corrections matter: moving a message to another Smart Inbox category should influence future mail from the same sender.
- Gatekeeper handles first-time senders with accept/block decisions.
- Mark as Done is a first-class action, supports category-level/bulk processing, and has a short undo window.
- Composer supports normal send, drafts, attachments, follow-up reminders, and Send Later.
- +AI supports compose, reply, edit/rewrite, summarize, translate, quick replies, and writing-style matching.
- AI Assistant-style behavior means natural-language search over mail context, summaries, actions, and source/audit trace.

## End-To-End Chains

### 1. Add Mailbox

```text
POST /api/accounts/imap-smtp/test
-> resolve provider preset or explicit IMAP/SMTP settings
-> EmailEngine verifyAccount
-> return check result only

POST /api/accounts/imap-smtp
-> create onboarding task with redacted payload
-> EmailEngine account register
-> upsert connected account
-> enqueue initial sync_account job
-> Sync Center shows pending/syncing/failure state
```

OAuth accounts follow the same shape:

```text
POST /api/accounts/oauth/:provider/start
-> create auth session with state and login hint
-> user grants access
POST /api/accounts/oauth/:provider/callback
-> exchange code
-> resolve profile email
-> store secret ref, not token material in public DTOs
-> create connected account
-> enqueue initial sync_account job
-> native Gmail / Outlook starts with native_folder_discovery
-> discovery writes provider mailbox refs and queues one folder_resync per label/folder
```

Required providers:

- Gmail: OAuth, native Gmail path first where available.
- Outlook: OAuth, Microsoft Graph path first where available.
- 163 / QQ: IMAP/SMTP authorization code.
- iCloud: IMAP/SMTP app-specific password.
- Proton: Proton Bridge only.
- Personal domain mailbox: explicit IMAP/SMTP plus auto-discovery later.

Provider capability catalog:

```text
GET /api/mail-providers/capabilities
GET /api/mail-providers/capabilities/:provider
```

The catalog is the backend contract for the Add Mailbox page. The UI should not
hard-code provider behavior. It should read capability flags such as web login,
scan login, mailbox password, labels, contacts, calendar, server search,
recall, read receipts, large attachments, cloud attachments, online archive,
group sending, send-on-behalf, local bridge requirement, and setup hints.

Normal user copy from this route must not expose implementation words such as
OAuth, Graph, IMAP, SMTP, or API. Diagnostics may still contain redacted
technical details.

### 2. Sync And Mirror

```text
EmailEngine webhook
-> verify signature
-> normalize provider event
-> idempotent mail_engine_events insert
-> idempotent sync_jobs insert
-> worker claims due job with lease
-> fetch provider message/mailboxes
-> mirror app-owned tables
-> classify baseline Smart Inbox
-> expose app DTOs
```

The UI must read local app DTOs only:

- `mailboxes`
- `messages`
- `threads`
- `message_locations`
- `message_state`
- `message_classification`
- `attachments`
- `search_documents`

Do not expose EmailEngine IDs or raw provider payloads as UI identifiers.

### 3. Smart Inbox Read Model

Spark has user-visible sections; Email Hub stores explainable buckets:

```text
P0 Pinned
P1 Urgent
P2 Important
P3 Needs Action
P4 FYI / Updates
P5 Transactions
P6 Feed
P7 Screen
Seen / Done is message_state, not a provider-only folder assumption
```

Read chain:

```text
GET /api/messages?sort=smart
-> aggregate visible messages across all connected accounts
-> use this for the main unified inbox

GET /api/accounts/:accountId/messages?sort=smart
-> filter to one connected account or account-specific folder view
-> filter visible message_locations
-> exclude deleted rows
-> join message_state
-> join message_classification
-> order by priority_score, received_at, id
-> return reason chips
```

Reason chips must be specific enough for Spark-level trust:

- Directly sent to you.
- You often reply to this sender.
- VIP or manually important sender.
- Deadline detected.
- Needs reply.
- From project label.
- Newsletter/bulk sender.
- User moved this sender to Feed before.

### 4. User Correction Loop

```text
POST /api/accounts/:accountId/messages/:messageId/smart-inbox/feedback
-> verify visible local message
-> write feedback_events
-> update message_classification immediately
-> write smart_inbox_sender_rules when action is sender-level
-> write Hermes contact_memory
-> future worker classifications read sender rules
```

Supported corrections:

- `mark_important`
- `mark_not_important`
- `move_to_personal`
- `move_to_notifications`
- `move_to_newsletters`
- `move_to_feed`
- `always_important_sender`
- `mute_sender`

Next required Spark-level corrections:

- `screen_sender_accept`
- `screen_sender_block`
- `screen_domain_block`

### 5. Gatekeeper / Screen

Spark Gatekeeper is not spam filtering. It is a user-level first-sender permission loop.

Backend target:

```text
new mirrored sender not seen before
-> classify P7 Screen
-> create sender_screening row
-> UI shows Accept / Block / Block Domain
-> accepted sender can enter normal buckets
-> blocked sender gets local hidden/dropped state
-> decision creates sender/domain rule and Hermes memory
```

Tables to add:

- `sender_screening_rules`
- `sender_screening_events`

Routes to add:

```text
GET  /api/screening/senders?accountId=:accountId
POST /api/screening/senders/:senderId/accept
POST /api/screening/senders/:senderId/block
POST /api/screening/domains/:domain/block
```

### 6. Message Actions

Current actions already use local IDs and provider outbox commands:

```text
POST /api/accounts/:accountId/messages/:messageId/actions
-> update local state immediately
-> enqueue engine_commands
-> worker resolves provider refs
-> execute through EmailEngine or native provider
-> retry/dead-letter without duplicating user-visible state
```

Spark-level action granularity:

- Mark read/unread.
- Star / pin.
- Archive.
- Done as an app action that writes `done_at`, `last_action_token`, and
  `undo_expires_at`, then queues provider `archive`.
- Undo Done within the short toast window using the matching local
  `undoToken`, then queues provider `move` back to Inbox.
- Undone after the short window, also queued as provider `move` back to Inbox.
- Smart Inbox card bulk Done through
  `POST /api/accounts/:accountId/smart-inbox/cards/:bucket/actions`; payload
  must contain `action="done"` and explicit local `messageIds`. The backend
  deduplicates ids, caps the request at 50, applies the same local Done path per
  message, and reports succeeded/failed rows.
- Trash.
- Move.
- Apply label.
- Snooze / set aside.
- Bulk action for category sections.

Backend rule: local state changes first, provider mutation follows through outbox.
The API action vocabulary is not the same as provider command vocabulary:
`done` maps to `archive`, while `undo_done` and `undone` map to `move`.

### 7. Compose / Reply / Send Later

```text
POST /api/accounts/:accountId/compose/drafts
-> create local draft
-> optional Hermes run id
-> no provider mutation

POST /api/accounts/:accountId/compose/drafts/:draftId/send
-> atomically claim draft
-> submit through account transport
-> record provider queue/message ids

POST /api/accounts/:accountId/compose/drafts/:draftId/schedule
-> validate draft/account
-> mark draft scheduled
-> insert durable scheduled_sends row

GET  /api/accounts/:accountId/outbox
-> list app-owned scheduled rows

POST /api/accounts/:accountId/outbox/:scheduledId/send-now
-> claim schedule and draft once
-> submit with schedule idempotency key

PATCH /api/accounts/:accountId/outbox/:scheduledId
-> reschedule scheduled/failed rows

DELETE /api/accounts/:accountId/outbox/:scheduledId
-> cancel schedule and release draft
```

Table:

- `scheduled_sends`

Worker lane:

```text
scheduled_send due
-> claim row with FOR UPDATE SKIP LOCKED and lease
-> submit draft through EmailEngine/native transport
-> mark sent or retry/dead-letter
```

### 8. Follow-Up / Reminders

Spark exposes reminders/follow-up as a folder-level workflow, not just an AI result.

Backend target:

```text
Hermes followup_tracker preview
-> user confirms reminder
-> create follow_up_reminders row
-> reminder appears in Tasks / Reminders / message detail
-> worker checks due reminders
-> if no reply detected, message is promoted back to Needs Action
```

Routes to add:

```text
POST /api/accounts/:accountId/messages/:messageId/follow-ups
GET  /api/follow-ups?accountId=:accountId&status=open
PATCH /api/follow-ups/:id
DELETE /api/follow-ups/:id
```

### 9. Hermes Chain

Hermes is the only AI backend entry:

```text
UI asks Hermes
-> API validates skill input
-> load allowed local message DTOs
-> load explicit memory context
-> call Hermes-compatible provider
-> normalize result
-> record hermes_skill_runs
-> record hermes_audit_events with read_message_ids and memory_ids
-> return preview/draft, not provider mutation
```

Existing skills:

- `thread_summarize`
- `reply_draft`
- `rewrite_polish`
- `quick_reply`
- `email_search_qa`
- `action_item_extract`
- `priority_triage`
- `label_suggest`
- `newsletter_cleanup`
- `followup_tracker`
- `translate_text`
- `memory_review`

Spark-level requirements:

- Summary modes: short, detailed, action points.
- Reply modes: quick replies such as interested, not interested, thanks.
- Writing style: learned from sent mail and draft diffs.
- AI Assistant: search mail, attachments, and later calendar/task context with citations.
- Inbox actions: suggest archive/move/feed, but only execute after explicit user action or approved rule.

### 10. Search Chain

```text
GET /api/accounts/:accountId/messages?q=:query
-> Postgres search over subject/sender/snippet
-> later search_documents body/attachment index

POST /api/hermes/skills/email_search_qa/run
-> local search first
-> Hermes answers only from matches
-> return answer and cited match ids
-> audit read messages
```

Next backend granularity:

- `search_documents` worker population.
- Attachment text extraction jobs are queued during message mirroring for
  searchable document attachments. The worker now claims due jobs, downloads
  attachment bytes through EmailEngine, runs a pluggable extractor, and merges
  extracted text into `search_documents`. The default extractor handles
  text-like files (`text/*`, CSV, JSON, XML, logs, markdown) and marks binary
  formats such as PDF/Office as non-retryable until dedicated parsers are
  enabled.
- Source citations in Hermes responses.
- Filter dimensions: account, mailbox, label, date, attachment, sender, bucket.

### 11. Learning And Rules

Learning must be inspectable:

```text
explicit feedback
-> feedback_events
-> smart_inbox_sender_rules or hermes_rule_candidates
-> shadow simulation
-> user approval
-> worker applies classification-only rules
```

Memory layers:

- `working_memory`
- `semantic_profile`
- `writing_style_profile`
- `contact_memory`
- `procedural_memory`
- `episodic_examples`

High-risk actions must stay preview/confirm:

- send
- delete
- unsubscribe
- block sender/domain
- provider-wide rule creation

### 12. Sync Center / Recovery

```text
GET /api/sync-center/accounts
-> connected_accounts + latest sync_jobs
-> nextAction: none, wait_for_sync, fix_sync_error, reauthorize

GET /api/sync-center/reauthorizations
-> pending/failed OAuth or transfer tasks
-> no secrets

POST recovery route
-> reauthorize
-> enqueue initial sync
```

Spark-level detail:

- account status must be visible independently from mailbox list.
- stale token, provider auth failure, bridge unavailable, and IMAP disabled must be distinct error classes.
- user action should be one click from sync center.
- failed IMAP/SMTP reauthorization must return redacted provider diagnostics,
  not a generic bad request or raw protocol error.

## Implementation Order

1. Finish the Smart Inbox correction vocabulary: move to Personal / Notifications / Newsletters, Done, undo.
2. Add Gatekeeper sender/domain screening.
3. Add scheduled sends and Outbox.
4. Add persisted follow-up reminders.
5. Populate `search_documents` with body and attachment text.
6. Add Hermes summary modes and quick reply modes.
7. Add Hermes citations for search QA.
8. Continue Native Engine folder coverage: mailbox refs, explicit Gmail label /
   Graph folder sync jobs, mailbox-scoped cursor lookup, and provider folder
   discovery queues are wired; Graph folder discovery pagination is covered;
   next add IMAP folder discovery.
9. Add provider-specific onboarding diagnostics for 163, QQ, iCloud, Proton Bridge, and personal domains.

## Current Non-Negotiables

- Frontend must not call EmailEngine.
- Frontend must not call OpenAI/Ollama/model APIs.
- All IDs returned to the UI are Email Hub local IDs.
- AI outputs are preview-first unless a reviewed rule explicitly enables a low-risk classification action.
- Every provider mutation goes through a durable outbox.
- Every sync job and command has idempotency, lease, retry, and dead-letter behavior.
- Docker self-hosting must work without hidden SaaS dependencies except the configured provider APIs.

## Sources

- Spark Smart Inbox customization: https://support.readdle.com/spark/personalization/customize-your-smart-inbox
- Spark Gatekeeper: https://support.readdle.com/spark/spark-onboarding/accept-or-block-new-senders
- Spark Mark as Done: https://support.readdle.com/spark/spark-onboarding/mark-as-done-ios-android
- Spark compose options: https://support.readdle.com/spark/sending-emails/write-an-email
- Spark Send Later: https://support.readdle.com/spark/sending-emails/schedule-an-email-to-send-later
- Spark +AI: https://support.readdle.com/spark/tips-tricks/spark-ai
- Spark +AI summary/translate: https://sparkmailapp.com/help/spark-ai/summarize-and-translate-emails-with-ai
- Spark AI feature page: https://sparkmailapp.com/features/spark-ai
