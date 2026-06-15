# Thunderbird / Foxmail 2026 Refresh

Date: 2026-06-14

## Verdict

Thunderbird is the backend and information-architecture reference. It is open source and separates accounts, incoming servers, identities, folders, virtual folders, message databases, filters, search, extensions, and diagnostics.

Foxmail is the China-market product reference. It is closed source, so it is not an architecture source. Its value is in quick provider setup, Tencent/QQ/Exmail behavior, practical compose features, server search, large attachments, and concise user-facing wording.

Email Hub should copy Thunderbird's boundaries and Foxmail's low-friction provider experience.

## Thunderbird Findings

### Layout Granularity

Thunderbird 115+ describes the main window as Spaces Toolbar, Unified Toolbar, Folder Pane, Quick Filter Bar, Message List Pane, Message Header Pane, Message Pane, Today Pane, and Status Bar.

Email Hub mapping:

- First rail: global modules only: Mail, Add Mailbox, Search, Settings.
- Second rail: folders, account groups, saved views, tags, common categories.
- Message list: support compact, standard, spacious density.
- Reader toolbar: contextual actions only, such as reply, reply all, forward, archive, delete, junk, move, tag, more.
- Status/sync area: visible sync state for users; technical details go to diagnostic logs.

### Account Model

Thunderbird models an account as an incoming server plus one or more identities. The incoming server owns the folder tree. Identities represent send-from behavior: name, email, signature, outgoing server.

Email Hub tables should stay split:

```text
connected_accounts
account_incoming_servers
account_outgoing_servers
account_identities
mailboxes
message_locations
message_state
messages
threads
search_documents
```

Do not treat one email address as one fixed send identity. Gmail aliases, Tencent Exmail aliases, group send, and send-on-behalf all require multiple identities.

### Folder And View Semantics

Thunderbird folders combine metadata, local storage, remote server behavior, and provider-specific operations. Virtual folders show messages from other folders by criteria.

Email Hub rules:

- `mailboxes` are real provider folders or labels.
- `unified_views` are read models over many accounts.
- `saved_views` are condition-based views, not real folders.
- `message_locations` must allow one message in multiple Gmail labels.
- Deleting a saved view must not delete source messages.
- Actions inside a saved view act on the source message.

### Gmail Label Trap

Thunderbird documents Gmail labels as folders through IMAP. Copying can apply multiple labels; moving to Trash removes labels and hides the message elsewhere. All Mail can duplicate perception if modeled carelessly.

Email Hub must:

- Deduplicate Gmail rows by provider message id or stable RFC/message ids where safe.
- Store label membership in `message_locations`.
- Treat archive as removing Inbox location, not moving to a fake Archive folder for Gmail.
- Avoid double notification when the same Gmail message appears under Inbox and All Mail.

### Search Layers

Thunderbird separates Global Search from Quick Filter. Global Search crosses accounts and folders. Quick Filter applies to the current message list.

Email Hub mapping:

```text
GET /api/search?q=...                  global, cross-account
GET /api/messages?viewId=...&q=...     current list filter
GET /api/messages?quickFilter[]=unread
GET /api/messages?quickFilter[]=starred
GET /api/messages?quickFilter[]=contacts
GET /api/messages?quickFilter[]=tags
GET /api/messages?quickFilter[]=attachments
```

Hermes may explain and generate query suggestions, but deterministic search and filtering must remain normal backend logic.

### Rule Engine

Thunderbird filters are account-scoped and ordered. They can move, delete, forward, and perform other actions.

Email Hub should implement:

- Account-scoped rules first.
- Ordered execution.
- Shadow simulation before enabling Hermes-suggested rules.
- Sample hit preview.
- Audit events for every rule run.
- No auto-delete, auto-forward, or auto-send without explicit approval.

## Foxmail Findings

### Market Position

Foxmail Windows official changelog shows 7.2.25 on 2026-03-31. The Mac page emphasizes Tencent Exmail auto-configuration, company address book, recall, large attachments, and work-focused efficiency.

Email Hub should learn the wording style: users see "Log in", "Use mailbox password", "Start Proton Bridge", "Resend", "Sync now", "Reconnect", not OAuth, IMAP, SMTP, Graph, or API.

### Provider-Specific Capability Matrix

Foxmail's changelog exposes many provider-specific behaviors:

- QQ Mail QR-code or password login.
- Tencent Exmail QR login via WeCom.
- Group-member sending.
- Send-on-behalf sender info.
- Exmail read status in sent mail.
- Sender alias and contact display-name sync.
- WeDrive attachment selection and save-to-drive.
- Gmail account support.
- ActiveSync contacts and calendar sync.
- Tags sync for Tencent Exmail.
- Server-side search for IMAP and Exchange.
- Junk filtering database.
- Exchange online archive.

Email Hub needs `provider_capabilities`:

```text
supports_qr_login
supports_password_login
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
supports_cloud_attachment
supports_online_archive
supports_junk_filtering
```

The UI should hide unsupported actions instead of showing "coming soon".

### Compose Details

Foxmail has many normal mail-client features that Email Hub must not miss:

- Reply, reply all, forward.
- Draft auto-save.
- Individual sending.
- Scheduled sending.
- Priority.
- CC/BCC.
- BCC visible in sent mail.
- Plain-text sending.
- Recipient mismatch reminder.
- Reminder before closing unsent mail.
- Templates and quick text.
- Signatures.
- Large attachments and cloud attachments.
- Attachment preview/download.
- Conversation mode toggle.

Email Hub compose chain:

```text
open composer
-> choose from identity
-> draft auto-save
-> recipient checks
-> attachment checks
-> Hermes draft/rewrite if requested
-> explicit user send or schedule
-> durable outbox job
-> provider command
-> sent/failed status
```

Hermes never sends directly.

### Common Category Views

Foxmail and Thunderbird both prove that common views should be views, not hard folders.

Email Hub should ship these saved views:

- Verification codes
- Bills
- Invoices
- Logistics
- Travel
- Meetings
- System alerts
- Finance
- Large attachments
- Waiting reply
- Newsletters
- Promotions
- Important senders

These categories belong in the second column, under folders/views, not the left global rail.

## Implementation Consequences

### Backend

1. Add `provider_capabilities` and keep provider-specific behavior behind adapters.
2. Keep `mailboxes`, `unified_views`, and `saved_views` separate.
3. Make `message_locations` many-to-many.
4. Make Gmail archive/trash/label behavior provider-aware.
5. Build deterministic quick filters before asking Hermes to interpret mail.
6. Build account-scoped ordered rules with simulation.
7. Treat compose as a backend module: drafts, identities, attachments, scheduled send, outbox, send result.
8. Add diagnostic logs with redaction and next-action hints.

### Frontend

1. Add Outlook-like density control: compact, standard, spacious.
2. Add provider grouping under Add Mailbox: Gmail, Outlook, iCloud, QQ, 163, Proton, enterprise, custom.
3. Use official provider icons.
4. Remove technical provider wording from normal UI.
5. Keep common categories in the folder/view column.
6. Keep Hermes as a short blurred assistant input, hidden until needed and idle-collapsed.

### Strong Tests

- Global Search crosses accounts; Quick Filter stays inside current list.
- Saved view deletion does not delete messages.
- Gmail All Mail does not duplicate inbox notifications.
- Gmail label membership creates multiple `message_locations`, not duplicate `messages`.
- Gmail archive removes Inbox location without losing All Mail visibility.
- Provider capability hides unsupported compose/actions.
- QQ/163/iCloud setup pages do not expose IMAP/SMTP/OAuth/API wording.
- Tencent Exmail alias/group/send-on-behalf maps to multiple identities.
- Rule order changes results and simulation shows matched samples.
- Hermes draft cannot send without explicit user action.
- Scheduled send survives API or worker restart.
- Diagnostic logs redact tokens, passwords, auth codes, cookies, and message bodies.

## Sources

- Thunderbird product page: https://www.thunderbird.net/en-US/
- Thunderbird main window: https://support.mozilla.org/en-US/kb/getting-started-thunderbird-main-window-supernova
- Thunderbird Appearance panel: https://support.mozilla.org/en-US/kb/appearance-panel-layout-message-list-card-view-tab
- Thunderbird Quick Filter: https://support.mozilla.org/en-US/kb/quick-filter-toolbar
- Thunderbird Global Search: https://support.mozilla.org/en-US/kb/global-search
- Thunderbird Message Filters: https://support.mozilla.org/en-US/kb/organize-your-messages-using-filters
- Thunderbird Saved Searches: https://support.mozilla.org/en-US/kb/using-saved-searches
- Thunderbird Gmail behavior: https://support.mozilla.org/en-US/kb/thunderbird-and-gmail
- Thunderbird source docs, folders: https://source-docs.thunderbird.net/en/latest/backend/folders.html
- Thunderbird source docs, accounts: https://source-docs.thunderbird.net/en/latest/backend/accounts.html
- Thunderbird WebExtension APIs: https://webextension-api.thunderbird.net/
- Foxmail Windows official page: https://www.foxmail.com/
- Foxmail Mac official page: https://www.foxmail.com/mac/
