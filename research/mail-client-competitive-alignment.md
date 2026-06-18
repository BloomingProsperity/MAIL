# Email Client Competitive Alignment

Date: 2026-06-17

This note translates public product strengths from Thunderbird, Foxmail, and
Spark into concrete Email Hub implementation targets.

## Thunderbird

Sources:
- https://www.thunderbird.net/en-US/features/
- https://support.mozilla.org/en-US/kb/using-saved-searches
- https://support.mozilla.org/en-US/kb/organize-your-messages-using-filters
- https://support.mozilla.org/en-US/kb/profiles-where-thunderbird-stores-user-data

Useful patterns:
- Unified folders plus per-account folders let users process all mail together
  while preserving account boundaries.
- Quick Filter, global search, saved searches, tags, and message filters make
  large personal archives navigable without forcing AI into every action.
- Local profile ownership is a trust feature: users can understand where their
  mail data, settings, and extensions live.

Email Hub alignment:
- P0: Default Mail view is a unified Smart Inbox backed by `/api/messages`; all
  detail reads and mutations must use each message's own `accountId`.
- P0: Keep provider payloads behind backend DTOs and never expose EmailEngine ids
  as UI identifiers.
- P1: Add saved searches as virtual folders over the search DSL.
- P1: Add a rules engine that can tag, archive, mark read, and move messages.

## Foxmail

Sources:
- https://www.foxmail.com/win/en/
- https://www.foxmail.com/mac/en/
- https://service.foxmail.com/

Useful patterns:
- Chinese desktop users value fast setup, responsive large-mailbox performance,
  and enterprise mailbox workflows.
- Related messages, attachment sidebars, templates, quick text, delayed send,
  Exchange/server search, enterprise contacts, recall, and large attachments are
  practical daily-use features.

Email Hub alignment:
- P0: Keep EmailEngine-first onboarding for Gmail, Outlook, 163, QQ, Proton
  Bridge, and custom domains reliable before expanding native engine scope.
- P0: Preserve attachment metadata and local attachment ids; do not leak provider
  attachment ids to the frontend.
- P1: Add templates/quick text and enterprise directory connectors.
- P1: Add provider-specific capabilities such as recall and large attachments
  only behind provider adapters.

## Spark

Sources:
- https://sparkmailapp.com/help/manage-your-inbox/customize-your-inbox
- https://sparkmailapp.com/help/manage-your-inbox/use-smart-search
- https://sparkmailapp.com/help/sending-emails/accept-or-block-new-senders
- https://sparkmailapp.com/help/spark-ai/write-new-emails-and-edit-drafts-with-ai-compose
- https://sparkmailapp.com/help/privacy-data/spark-email-privacy-everything-you-need-to-know

Useful patterns:
- Smart Inbox, Priority, Done, Gatekeeper, natural-language search, Smart
  Folder, Send Later, Follow-up, and AI writing tools create a modern email
  workflow instead of just a protocol client.
- AI must be positioned as a controlled assistant with clear data handling, not
  as a hidden path around core mail contracts.

Email Hub alignment:
- P0: Mail list supports Done, archive, trash, star, mark read/unread, and
  Smart Inbox sorting through stable backend actions.
- P0: Hermes remains the only AI entry point for search, summary, translation,
  reply drafting, organization, and habit learning.
- P1: Add Gatekeeper sender review and Smart Folder saved searches.
- P1: Add Send Later and Follow-up workflows as durable jobs and reminders.

## Working Priority

1. EmailEngine-first self-hosted deployment readiness.
2. Unified Smart Inbox over app-owned messages.
3. Per-message account-safe detail reads and actions.
4. Real message rendering without preview data leakage.
5. Search, rules, labels, Done, archive, trash, star, read/unread.
6. Hermes organization actions that can write back to Smart Inbox state.
7. Native Engine as second-tier sidecar work after EmailEngine launch quality is
   stable.

## 2026-06-17 Implementation Granularity Matrix

This matrix is the working checklist for future slices. It keeps product
references at implementation granularity so work does not drift into vague
"Spark-like" or "Thunderbird-like" claims.

| Reference pattern | Email Hub product behavior | Backend/API boundary | Frontend surface | Verification evidence |
| --- | --- | --- | --- | --- |
| Thunderbird unified folders | One Mail workspace can show all accounts while every detail/action remains account-safe. | `/api/messages` returns app-owned ids plus `accountId`; detail/action routes require the owning account. | Mail list, folders, labels, and Search never expose EmailEngine ids. | Account-scoped message/action route tests and App message navigation tests. |
| Thunderbird saved searches / virtual folders | Saved views are filters over the read model, not copied mailboxes. | Persist search DSL and label filters separately from provider folders. | Search workspace can promote a query into a saved view. | Search DSL tests plus a saved-view route/UI test before release. |
| Thunderbird account-scoped ordered filters | Rules are ordered, auditable, and can be run manually without provider-side surprise writes. | Hermes confirmed rules write app-owned labels and `hermes_rule_runs`; provider label writeback remains opt-in later. | Settings rule manager shows shadow candidates, simulation, manual run, and sort order. | Hermes rule route tests, worker rule application tests, focused Settings tests. |
| Foxmail low-friction Chinese provider setup | 163/QQ/custom-domain users see concise credential guidance and recovery paths. | Provider catalog and onboarding diagnostics return provider-specific next actions without leaking secrets. | Add Mailbox flow uses provider wording rather than raw IMAP/OAuth jargon. | Onboarding diagnostics route tests and provider-specific UI tests. |
| Foxmail large-mailbox performance | Large local mirrors remain responsive and searchable. | Background sync writes normalized read models, search docs, and bounded diagnostics. | Mail/Search views page with stable cursors and quick filters. | Sync queue stress, `/api/messages` cursor tests, search route tests. |
| Foxmail extra-large attachment expectation | Normal uploads work through Docker self-host storage; large-provider sessions are a separate adapter slice. | Compose upload streams raw bytes to the shared volume, stores `storageKey`, validates checksum, and keeps provider refs private. | Compose attachment chips show local metadata and clear 25 MB limit errors. | Compose attachment blob tests, route tests, App upload tests, worker send hydration tests. |
| Spark Smart Inbox | Important people and direct mail rise above newsletters/notifications with visible reasons. | Classifier writes `message_classification`; feedback writes sender rules and Hermes memory. | Mail cards show bucket and reason chips; users can correct category. | Smart Inbox feedback tests and card behavior tests. |
| Spark Gatekeeper | First-time senders can be accepted or blocked before polluting the main inbox. | Sender screening rules/events are account-scoped and disabled when Gatekeeper mode allows all. | Gatekeeper panel lists new senders with accept/block actions. | Gatekeeper service and route tests plus App Settings/Mail tests. |
| Spark Send Later / Outbox | Scheduled mail is durable, editable, cancelable, and can send now. | `email_drafts` plus `scheduled_sends`; worker claims queue items and hydrates attachments/threading. | Compose and Outbox panels share the same draft editing flow. | Compose/outbox route tests, worker scheduled-send tests, App outbox tests. |
| Spark AI assistant | AI can search, summarize, translate, draft, polish, organize, and learn habits only through Hermes. | `/api/hermes/*` is the sole AI surface; skill settings enforce body-read, memory-write, context, and account scope. | Reader, Compose, Search dock, Settings memories/rules/skills all call backend Hermes APIs only. | Hermes route tests, API client tests, focused feature-panel tests, App integration tests. |

Native Engine remains paused for new product scope while this matrix is being
closed for the EmailEngine-first launch. Native adapter fixes are allowed only
when they preserve existing boundaries or prevent regressions in shared
contracts.

## 2026-06-18 Official-Source Refresh

This pass rechecked the public product pages before the EmailEngine-first launch
push. The goal is not to copy UI chrome; it is to turn proven mail-client
patterns into concrete acceptance checks.

### Thunderbird

Fresh official signals:

- Thunderbird's public positioning still centers one app for mail, calendars,
  and contacts, with separate-account or unified-inbox workflows.
- The current product copy emphasizes privacy and user control, including
  not selling ads in the inbox and not training AI on private conversations.
- Thunderbird 140 ESR adds more account-setup and list-management polish:
  Account Hub is enabled by default for second email setup, filters are reachable
  from the folder pane context menu, Card View row count is customizable, and
  global appearance controls cover threading and sort order.

Email Hub launch acceptance:

- The first screen must remain an actual mailbox workspace, not a marketing
  landing page.
- Unified inbox must never erase account identity. Detail reads, actions, draft
  replies, labels, memories, and audit rows keep the owning `accountId`.
- Search has two layers: deterministic query/list filtering first, Hermes
  natural-language interpretation second.
- Settings and diagnostics should be trusted surfaces: secrets redacted,
  runtime settings auditable, and AI behavior explainable.

### Foxmail

Fresh official signals:

- The Windows page currently lists Foxmail 7.2.25 dated 2026-03-31.
- Foxmail emphasizes clean UI and responsiveness at very large mailbox sizes.
- Its public changelog keeps surfacing provider-specific work details:
  QQ Mail QR/password login, Tencent Exmail group sending and send-on-behalf,
  WeDrive attachments, sender alias/contact sync, Gmail account support, server
  search, delayed send, templates, attachment preview, and related-mail views.

Email Hub launch acceptance:

- Add Mailbox copy stays user-facing. Normal users should see actions such as
  "log in", "use app password", "start Proton Bridge", "sync now", and
  "reconnect", not protocol jargon.
- Provider capability records decide which actions are visible. Unsupported
  provider-specific actions are hidden from normal UI rather than shown as
  vague placeholders.
- Compose must behave like a real mail client: identity selection, draft
  autosave, CC/BCC, attachments, schedule/send-now/cancel outbox flows, and
  explicit user send.
- Large mailbox performance is a release gate: list/search routes need stable
  cursors and bounded diagnostics, while Docker launch gates prove the worker
  and EmailEngine wiring are actually healthy.

### Spark

Fresh official signals:

- Spark's Smart Inbox settings expose grouped views, account grouping, Priority,
  Gatekeeper, and configurable card actions such as batch Done/read/delete.
- Spark's AI Assistant positioning is cross-workflow: find, summarize, write,
  translate, and organize across emails and adjacent context.
- Spark also leans into collaboration, but Email Hub should defer team inboxes
  until single-user self-hosted quality is solid.

Email Hub launch acceptance:

- Smart Inbox is not one classifier call. It is the loop of bucket, reason,
  correction, sender rule, memory, undo, and durable read model.
- Gatekeeper remains an account-scoped sender review workflow, not a spam-folder
  synonym.
- Hermes is the only AI entrance. Search, translation, summary, reply drafting,
  organization, rule suggestions, and habit learning all pass through backend
  Hermes skills with account scope, skill permissions, audit rows, and editable
  memory.
- Hermes may draft and suggest. It must not silently send, delete, forward,
  unsubscribe, or mutate provider state without explicit user confirmation.

### Next Implementation Slices

1. Provider-capability UI: hide unsupported provider actions and add focused
   tests for QQ/163/Proton/custom-domain wording.
2. Saved views: promote Search filters into virtual folders without copying or
   deleting source messages.
3. Sync Center next actions: surface app-password, expired OAuth, Proton Bridge,
   and EmailEngine credential failures in user language plus redacted details.
4. Compose polish: templates/quick text, signatures, recipient mismatch checks,
   and attachment preview/download should be modular feature files, not more
   `App.tsx` growth.
5. Smart Inbox feedback expansion: keep Spark-like category corrections visible
   and auditable, then feed Hermes memory only through reviewed backend paths.
6. Docker launch evidence: keep EmailEngine image pinning, runtime env
   invariants, webhook privacy settings, and GreenMail smokes as release gates.

Additional sources checked on 2026-06-18:

- Thunderbird home: https://www.thunderbird.net/en-US/
- Thunderbird 140 ESR release notes: https://www.thunderbird.net/en-US/thunderbird/140.0esr/releasenotes/
- Foxmail Windows official page: https://www.foxmail.com/win/en/
- Foxmail Mac official page: https://www.foxmail.com/mac/en/
- Spark Smart Inbox customization: https://sparkmailapp.com/help/manage-your-inbox/customize-your-inbox
- Spark AI Assistant: https://sparkmailapp.com/features/ai-assistant

## 2026-06-18 User Pain Point Refresh

This pass combined domestic provider setup, international multi-account client,
self-hosted operations, and AI-trust research. The strong signal is that users
do not primarily want a prettier account list. They want a unified workbench
that connects reliably, explains sync state, prevents loss, preserves account
identity, and makes AI behavior reviewable.

### Domestic Chinese Provider Pain

- QQ and 163 users are often blocked by app-password, QR, SMS, and protocol
  enablement flows. The Add Mailbox path must classify password, app-password,
  disabled-protocol, and server-mismatch failures and return a concrete next
  action instead of raw IMAP/POP wording.
- Tencent Exmail and WeCom mail setup can require both admin-side and
  member-side switches. Provider diagnostics should distinguish admin-only
  fixes from mailbox-owner fixes and provide copyable handoff text.
- Initial sync often looks incomplete when providers or clients default to a
  recent-window sync. Email Hub needs staged backfill, folder mirror state,
  watermarks, historical progress, and a visible resync path.
- POP-style collection can delete or move upstream mail in ways users do not
  expect. Default to safer IMAP/OAuth paths, warn before risky POP behavior,
  and require undo/audit for destructive app actions.
- Attachment reliability matters in daily Chinese mailbox use: large-file
  limits, expiry, preview, original names, download failures, and provider-only
  links must be represented in app-owned attachment metadata.
- Search must work across accounts, folders, Chinese text, senders, and
  attachment names. Provider search can be a fallback, not the only index.
- A unified inbox cannot blur sender identity, signature, notification, memory,
  or audit scope. `accountId` remains a first-class boundary for every list,
  detail, send, Hermes memory, and mutation.

### International And Self-Hosted Pain

- Users repeatedly ask for a web-based multi-account unified inbox that works
  across devices without reconfiguring every desktop or phone. Docker
  self-hosting is a product requirement, not just an ops convenience.
- Unified inbox means a view over separate accounts, not physical mail
  forwarding or import into one mailbox. Reply-from identity, Sent/Archive
  behavior, folders, and aliases must follow the original account.
- Users want more than one global "All accounts" view. Saved views should allow
  work/personal/project account groups, folder scopes, labels, date filters,
  and a default startup view.
- Cross-account search is a common frustration in mainstream clients. Email Hub
  should maintain its own normalized search read model and expose account,
  folder, sender, date, attachment, and label filters.
- Gmail's Gmailify/POP change creates a migration window for a real
  multi-account client. Import, IMAP/OAuth onboarding, forwarding warnings, and
  provider-health checks should be explicit launch features.
- Self-hosted users care about Redis, Postgres, EmailEngine readiness, queue
  health, Docker image pinning, backups, and logs. "Container is running" is
  not enough launch evidence.
- EmailEngine runtime tuning affects user trust: worker counts, Redis latency,
  webhook concurrency, folder monitoring, and queue lag should feed operator
  diagnostics and Sync Center state.

### Hermes AI Trust Pain

- Hermes should be a trusted AI workbench, not an autonomous mailbox agent.
  Search, summary, translation, draft writing, rules, and habit learning go
  through backend Hermes skills only.
- Users and admins need to know what data AI saw, where it was sent, whether it
  trains models, how long it is retained, and how to disable or delete it.
- Generated summaries, replies, translations, rule suggestions, and memory
  updates need source chips linking back to account, message, thread, and
  attachment context.
- Memory must stay account-scoped by default. Personal writing habits must not
  leak into work accounts, shared inboxes, or unrelated provider identities.
- Hermes can suggest destructive or provider-mutating actions, but it must not
  silently send, delete, move, unsubscribe, forward, or rewrite provider state.
  Those actions require explicit confirmation, job status, audit rows, and
  undo where the provider allows it.
- AI-read content should be sanitized before summarization or rule inference so
  hidden HTML, invisible text, and prompt-injection bait cannot become trusted
  system guidance.
- Rule editing needs dry-run samples, impact counts, future-only defaults, and
  explicit historical-apply confirmation before any bulk change.

### User-Derived Launch Priorities

1. Account connection success rate: provider-specific onboarding, OAuth/app
   password diagnostics, Proton Bridge checks, admin/member handoffs, and clear
   recovery paths.
2. Sync explainability: per-account health, last sync, cursor/watermark,
   webhook lag, retry/dead-letter state, folder scope, and manual resync.
3. Loss prevention: account-aware operations, signed webhook idempotency,
   undo/audit for destructive actions, and no trust in unsigned headers.
4. Account-safe unified workspace: cross-account view with strict
   `accountId`, identity, signature, folder, label, notification, memory, and
   audit boundaries.
5. Search and attachment reliability: app-owned search index, attachment
   metadata, preview/download state, large-file expiry, and stable filters.
6. Self-host launch evidence: Docker health, EmailEngine image pinning,
   Redis/Postgres readiness, runtime env invariants, backup/restore notes,
   GreenMail smokes, and redacted logs.
7. Trusted Hermes: opt-in controls, skill permissions, source references,
   account-scoped memory, audit rows, confirmation for mutations, and no hidden
   AI path outside Hermes.

### Next Product Slices From Pain Points

1. Provider onboarding diagnostics for QQ, 163, Proton Bridge, Gmail, Outlook,
   Tencent Exmail, and custom IMAP/SMTP.
2. Sync Center health cards with account-specific next actions and webhook or
   queue lag evidence.
3. Saved views and global search filters over the normalized read model.
4. Compose identity and attachment polish: verified From, signature scope,
   attachment preview/download, large-file expiry, and send confirmation.
5. Hermes translation, rule, and skill editing polish with source references,
   dry-runs, account-scoped memory review, and mutation confirmation.
6. Production Docker validation: image drift, runtime env drift, Redis/Postgres
   health, EmailEngine queue metrics, backup/restore rehearsal, and redacted
   diagnostic reports.

Additional user-pain sources checked on 2026-06-18:

- QQ Mail app password help: https://help.mail.qq.com/detail/106/985
- Huawei 163 app password setup: https://consumer.huawei.com/cn/support/content/zh-cn15872099/
- Tencent Exmail setup guide: https://www.qqiv.com/news/5045856.html
- Foxmail official page: https://www.foxmail.com/
- Self-hosted unified inbox request: https://www.reddit.com/r/selfhosted/comments/1cyq2yy/whats_the_best_selfhosted_webmail_solution_for/
- Web-based unified inbox request: https://www.reddit.com/r/selfhosted/comments/1ku8bz8/web_based_email_client_that_supports_multiple/
- Gmailify and POP changes: https://support.google.com/mail/answer/16604719?hl=en
- New Outlook multi-mailbox search limitation: https://learn.microsoft.com/en-us/answers/questions/5523924/how-do-i-search-all-my-mailboxes-on-new-outlook
- EmailEngine performance tuning: https://learn.emailengine.app/docs/advanced/performance-tuning
- EmailEngine monitoring: https://learn.emailengine.app/docs/advanced/monitoring
- Spark AI security and data: https://sparkmailapp.com/help/spark-ai/spark-ai-security-and-data
- Superhuman AI privacy positioning: https://superhuman.com/products/mail/ai
- Microsoft Copilot enterprise data protection: https://learn.microsoft.com/en-us/microsoft-365/copilot/enterprise-data-protection
