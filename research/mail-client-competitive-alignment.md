# Email Client Competitive Alignment

Date: 2026-06-16

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
