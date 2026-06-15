# Thunderbird / Foxmail actionable notes

Date: 2026-06-14

## Bottom line

Thunderbird is the architecture reference. It is open source, has a mature split between accounts, identities, real folders, virtual views, filters, storage, search, add-ons, and diagnostics.

Foxmail is the China-market experience reference. It is closed source, so do not copy backend architecture from it. Learn its low-friction account setup, QQ/Tencent Exmail details, concise UI wording, large attachment flow, and practical troubleshooting surfaces.

Email Hub should use Thunderbird-like backend boundaries and Foxmail/Spark/Outlook-like product speed.

## Thunderbird: what to learn

### UI and layout

- Supports density and font-size controls. Email Hub needs `compact | comfortable | spacious` list density, not one oversized layout.
- Supports folder modes and sortable folder sections. Email Hub's second column should support real folders, unified views, saved views, tags, and account groups.
- Supports table and card message list styles. Email Hub should keep Outlook-like compact rows as the default and allow a richer card list later.
- The toolbar is contextual. Email Hub should not show every action everywhere; show reply/archive/delete/move only where mail is selected or open.

### Folders and views

- Real folders and virtual/search folders must stay separate.
- Unified inbox is a read model, not a merged account.
- Saved searches behave like live views over real messages, not copied messages.

Email Hub mapping:

```text
mailboxes          real provider folders / labels
message_locations  message visible in one or more folders
saved_views        verification codes, bills, travel, logistics, alerts
unified_views      cross-account Inbox, Sent, Archive, Attachments
labels             user/provider labels
```

### Filters and rules

- Thunderbird filters are account-scoped and ordered.
- Filters can run automatically, manually, after sending, or on archive-like flows.
- Rule ordering matters and must be explainable.

Email Hub mapping:

- First version rules stay account-scoped.
- Hermes suggestions enter `shadow` first.
- Low-risk actions: tag, classify, lower priority, suggest archive.
- High-risk actions: delete, forward, send, unsubscribe, block sender/domain.
- Rule simulation must show matched samples before approval.

### Search and diagnostics

- Thunderbird has global search and folder-level quick filter. Do not mix them.
- Thunderbird stores local message metadata and raw message storage separately.
- Activity, status, error console, and lower-level logs are separate surfaces.

Email Hub mapping:

- Top search: global, cross-account, backed by `search_documents`.
- List filter: current mailbox/view only.
- Sync Center: user-facing next action.
- Diagnostic log: redacted technical facts, request ids, job ids, retry state.

### Account setup

- Thunderbird 140 enables Account Hub by default for second email setup.
- Account setup is a wizard-like experience for users coming from other clients.

Email Hub mapping:

- Add Mailbox should never expose "OAuth", "IMAP", "SMTP", "Graph", or "API" in normal copy.
- Advanced diagnostics can contain technical terms, but only after user opens details.

## Foxmail: what to learn

### Product posture

- Foxmail Windows latest official page shows 7.2.25 on 2026-03-31.
- Official copy emphasizes fresh/clean design and performance with very large mailboxes.
- Help Center is organized by user task: install, account, compose, read, send/receive, contacts, special features, common errors.

Email Hub mapping:

- Settings and Sync Center should be task-based, not backend-module-based.
- Error states must tell the user the next action: re-login, use app password, start Proton Bridge, reduce sync frequency, retry later, or view diagnostics.

### Provider-specific experience

Foxmail's public changelog shows these important details:

- QQ Mail QR-code or password login.
- Tencent Exmail QR login through WeCom.
- Send as group member and send on behalf of others.
- Exmail read status in sent mail.
- Sync sender aliases and contact display names.
- WeDrive attachment selection and saving.
- Gmail account support.
- ActiveSync contacts/calendar support.
- Tags sync for Tencent Exmail.
- Mail size and received-time filter conditions.
- Server-side search for IMAP and Exchange.

Email Hub mapping:

```text
provider_capabilities
  supports_qr_login
  supports_app_password
  supports_oauth_login
  supports_server_search
  supports_labels
  supports_alias_sync
  supports_contacts
  supports_calendar
  supports_send_as_group
  supports_send_on_behalf
  supports_read_status
  supports_recall
  supports_large_attachment
  supports_attachment_cloud_drive
```

UI should hide unsupported capabilities. Do not show "coming soon" for normal users.

### Compose details

Foxmail exposes many normal mail-client features that Email Hub cannot ignore:

- auto-save drafts
- reply / reply all / forward
- separate sending
- scheduled sending
- mail priority
- cc / bcc
- auto cc / bcc
- read receipt
- templates
- signatures for reply and forward
- attachment preview
- batch attachment download
- related mails and attachments sidebar
- fuzzy recipient matching
- reminder before closing unsent mail

Email Hub mapping:

- Compose must become a first-class backend module, not just a textarea.
- Hermes can draft, rewrite, summarize, and suggest, but send remains explicit.
- Scheduled sending needs durable backend state, not browser timers.

## Required Email Hub changes from this research

### Backend

1. Add or extend provider capability records.
2. Keep `mailboxes`, `saved_views`, and `unified_views` separate.
3. Add saved views for common categories: verification codes, bills, invoices, logistics, travel, meetings, system alerts, subscriptions/newsletters, large attachments, waiting reply.
4. Continue native provider folder discovery so Gmail labels and Graph folders create mailbox refs and folder sync jobs.
5. Add account-scoped ordered rules with simulation and audit events.
6. Make Sync Center action-oriented and diagnostic logs redacted.
7. Treat compose, draft, scheduled send, attachments, identities, and signatures as a separate chain.

### Frontend

1. Add Outlook-like density switch: compact, standard, spacious.
2. Left rail remains global only: Mail, Add Mailbox, Search, Settings.
3. Under Add Mailbox, group connected accounts by provider: Gmail, Outlook, iCloud, QQ, 163, Proton, enterprise, custom domain.
4. Provider cards use official icons and user-facing copy only.
5. Common categories live in the folder/view column, not the global rail.
6. Hermes input stays short, blurred/soft, collapses when idle, and appears in every page that can use it.

### Strong tests

- Adding mailbox UI contains no OAuth/IMAP/SMTP/Graph/API wording.
- Provider capability hides unsupported actions.
- Saved view delete does not delete source messages.
- Unified inbox never loses account and mailbox identity.
- Rule order changes result and simulation shows samples.
- Sync Center returns next action for iCloud app-password, QQ/163 auth-code, Proton Bridge unavailable, OAuth expired.
- Compose cannot send a Hermes draft without explicit send action.
- Scheduled send survives worker restart.
- Diagnostics redact token, password, authorization code, cookie, and message body.

## Sources

- Thunderbird 140 release notes: https://www.thunderbird.net/en-US/thunderbird/140.0/releasenotes/
- Thunderbird 115 Supernova UI/density/folder/card view: https://www.thunderbird.net/en-US/thunderbird/115.0/whatsnew/
- Thunderbird message filters: https://support.mozilla.org/en-US/kb/organize-your-messages-using-filters
- Thunderbird saved searches: https://support.mozilla.org/en-US/kb/using-saved-searches
- Thunderbird folder storage: https://source-docs.thunderbird.net/en/latest/backend/folder_storage.html
- Thunderbird Panorama global database: https://source-docs.thunderbird.net/en/latest/panorama/index.html
- Thunderbird OpenPGP/S-MIME: https://support.mozilla.org/en-US/kb/openpgp-thunderbird-howto-and-faq
- Thunderbird Account Hub: https://blog.thunderbird.net/2025/04/video-the-new-account-hub/
- Foxmail Windows official page: https://www.foxmail.com/
- Foxmail Mac official page: https://www.foxmail.com/mac/en/
- Foxmail Help Center: https://service.foxmail.com/
