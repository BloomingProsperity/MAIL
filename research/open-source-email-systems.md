# Open Source Email System Reference

## Purpose

This research pass checks how mature open source email projects split the backend chain. It complements `docs/spark-like-backend-chain.md`: Spark defines the target product feel, while these projects show implementation patterns that survive real mail volume.

## Projects Reviewed

### Inbox Zero

Inbox Zero is closest to our Hermes direction: AI assistant, AI rules, reply tracking, bulk unsubscribe, bulk archive, cold email blocker, analytics, and attachment filing. Its architecture notes show provider webhooks feeding Gmail/Outlook handlers, then AI rule selection, action execution, and database history.

Takeaways:

- Keep provider integrations behind `EmailProvider`-style boundaries.
- Treat AI rules as stored, reviewable records, not only prompt text.
- Separate reply tracking and cold-sender screening from normal inbox sorting.
- Run scheduled/background flows through cron or worker routes, not request-time UI calls.

Do not copy:

- A combined Next.js app/API backend is fast to ship but gives us weaker worker isolation than the API/worker split we already chose.
- Provider actions can become too close to AI decisions; Email Hub should keep Hermes preview-first unless a low-risk rule is explicitly approved.

### Zero

Zero is a self-hostable AI email app using Node, Drizzle, PostgreSQL, Better Auth, Google OAuth, and Docker. Its README notes a speed-oriented sync direction: user mail stored in a Durable Object and R2 bucket, with configurable thread sync count and loop behavior.

Takeaways:

- Fast mailbox UX needs local cached thread/message state, not live provider reads.
- Sync must be paginated and tunable per folder/account.
- Local-first search and rendering are part of the core product, not a later polish item.

Do not copy:

- Durable Objects/R2 are Cloudflare-shaped. Our Docker target should keep Postgres plus later object storage optional.

### Nextcloud Mail

Nextcloud Mail supports multiple IMAP accounts, unified inbox, message threads, mailbox management, and integrations with Contacts, Calendar, Files, and Tasks. It explicitly avoids reinventing the mail server and builds on Horde libraries.

Takeaways:

- Unified inbox is a read model across accounts, not a fake merged provider account.
- Tasks, Files, Contacts, and Calendar integrations are natural follow-on contexts for Hermes.
- Priority Inbox and thread summaries are separate AI surfaces: sorting can be local/model-assisted, summaries can be opt-in.

Do not copy:

- Nextcloud's PHP app-plugin context is not our deployment model, but its account/thread/folder boundaries are useful.

### Roundcube

Roundcube is a mature browser-based IMAP client with folder management, MIME support, message search, address book, plugins, skins, and SQL database support.

Takeaways:

- IMAP details are deep enough to justify EmailEngine first and a separate Native Engine later.
- Folder management, MIME rendering, search, and address book are basic email-client expectations.
- Plugin boundaries matter; Hermes skills and provider adapters should stay modular.

Do not copy:

- Direct IMAP-per-request webmail behavior is not enough for a Spark-like fast workspace. We need mirrored Postgres DTOs.

### Cypht

Cypht positions itself as a lightweight aggregator: all email from all accounts in one place, while still allowing IMAP folder browsing and SMTP sending. It supports IMAP/SMTP, JMAP, and EWS through module sets.

Takeaways:

- "Aggregator" and "normal mail client" must both exist: combined views plus exact provider folders.
- Provider capabilities should be modular so JMAP/EWS/Graph/Gmail/IMAP can evolve independently.
- Adding mail protocols later should not force a UI rewrite.

Do not copy:

- Cypht's plugin architecture is broad; Email Hub needs a smaller typed adapter contract first.

### SimpleLogin

SimpleLogin shows why alias forwarding is not just `alias -> destination`. Its handler separates forward, reply, reverse alias, contact, mailbox, bounce, disabled mailbox, DKIM, and custom-domain checks. Its self-hosting docs also make DNS/MX/SPF/DKIM/DMARC setup first-class.

Takeaways:

- Alias/domain MVP needs delivery logs, destination verification, bounce status, and loop prevention even if the MX gateway is later.
- Reply via alias needs reverse-alias or equivalent identity mapping.
- Domain control must track MX/SPF/DKIM/DMARC verification separately.

Do not copy:

- Full MTA/Postfix ownership is too heavy for MVP. Keep the first release as a control plane plus provider/webhook experiment.

### docker-mailserver

docker-mailserver packages Postfix, Dovecot, Rspamd, ClamAV, OpenDKIM, OpenDMARC, Fail2ban, fetch tools, setup scripts, and OAuth2 SASL support into a containerized mail server.

Takeaways:

- A real mail server is a service bundle, not one feature.
- If Email Hub ever owns MX fully, it must be a separate gateway stack, not hidden inside the API.
- Configuration/versioning matters as much as code for self-hosted deployments.

Do not copy:

- We should not block the mailbox aggregation MVP on full SMTP/IMAP server ownership.

## Backend Implications For Email Hub

1. Keep the current API/worker/Postgres split.
2. Keep EmailEngine as the first provider, but require every UI-facing response to come from local DTOs.
3. Add Spark-level loops before adding more AI novelty:
   - `Done` / undo.
   - Gatekeeper sender screening.
   - Send Later and Outbox.
   - Follow-up reminders.
   - Search body/attachment indexing.
4. Treat Hermes rules like Inbox Zero rules, but safer:
   - explicit rule rows;
   - simulation;
   - approval;
   - audit;
   - classification-only automation first.
5. Add alias/domain depth gradually:
   - control plane and DNS checks;
   - destination verification;
   - delivery log;
   - bounce model;
   - reverse-alias model;
   - MX gateway last.

## Sources

- Inbox Zero: https://github.com/elie222/inbox-zero
- Zero: https://github.com/Mail-0/Zero
- Nextcloud Mail: https://github.com/nextcloud/mail
- Roundcube: https://github.com/roundcube/roundcubemail
- Cypht: https://github.com/cypht-org/cypht
- SimpleLogin: https://github.com/simple-login/app
- docker-mailserver: https://github.com/docker-mailserver/docker-mailserver
