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
