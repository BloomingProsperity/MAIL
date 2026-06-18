# Codex Security Scan Prompts

These prompts are tuned for the Email Hub launch path. They intentionally
exclude `apps/native-engine/`, because Native/Core work is paused and is not in
scope for the EmailEngine-first launch.

Use ordinary `codex-security:security-scan` for these module scans. Do not use
`codex-security:deep-security-scan` unless you deliberately want a whole-repo
scan that includes every repository path; the deep scan workflow is repository
wide and is not a good fit while `apps/native-engine/` must stay out of scope.

## How To Use

Run these prompts as separate scans. For each scan, paste the **Common Prefix**
first, then paste exactly one module prompt. The goal is depth, not speed: a
large repo-wide prompt tends to produce shallow findings and false confidence.

Recommended order:

1. Launch-Path Baseline
2. API Router, Auth, And Account Scope
3. Account Onboarding, OAuth, CSV, Reauthorization, Secrets
4. EmailEngine Boundary, Webhooks, Sync Mirror
5. Mail Read, Search, Attachments, And Web XSS
6. Compose, Send, Outbox, Mail Actions, Engine Commands
7. Hermes / LLM Runtime, Prompt Injection, Memory, Rules
8. Domain Alias, Gatekeeper, Smart Inbox, Follow-Ups
9. Worker Queues, Leases, Cleanup, Runtime Reliability Bugs
10. Infra, Docker, Env, Migrations, Supply Chain
11. Frontend Product Surface, Privacy, And UI Data Exposure
12. Cross-Module Abuse Chains
13. Launch-Blocker Triage
14. Final Reconciliation Prompt

If a scan reports many low-confidence issues, rerun that module with this extra
sentence appended:

```text
Suppress speculative issues that do not have a concrete source-to-sink path in
current code. Prefer five proven findings over fifty guesses.
```

If a scan reports no issues, rerun that module with this extra sentence:

```text
Assume there is at least one real defect in this scope. Try harder to find
cross-account, replay, queue-race, SSRF, XSS, secret leak, and fail-open bugs,
but still require concrete file:line evidence.
```

## Required Report Contract

Ask the plugin to use this report contract for every module. It makes the
results comparable and prevents hand-wavy output.

```text
For each finding, use this exact structure:

Finding title:
Severity: Critical / High / Medium / Low
Launch blocker: Yes / No
Affected module:
Files and lines:
Attacker:
Prerequisites:
Source:
Sink:
Attack path:
Impact:
Current controls:
Why controls fail or why this is still risky:
Minimal fix:
Regression test:
Confidence: High / Medium / Low

Do not include findings without file:line evidence.
Do not include generic best practices unless they directly block launch.
If a suspected issue is actually prevented by current code, put it under
"Verified controls" instead of "Findings".
```

## Common Prefix

Paste this at the top of every module prompt:

```text
Use the Codex Security plugin workflow `codex-security:security-scan`.

I authorize delegated subagents/workers for exhaustive scoped scanning.

Do not edit repository files. Write the normal Codex Security markdown and HTML reports, plus any required artifacts.

Repository: /home/ubuntu/email-hub-current

Global exclusions:
- apps/native-engine/**
- **/node_modules/**
- **/dist/**
- generated build output, coverage output, and dependency caches

Launch-path scope:
- apps/web/src
- apps/api-node/src
- apps/worker-node/src
- apps/api-node/tests and apps/worker-node/tests only when needed to understand or verify behavior
- apps/web/src/**/*.test.ts and apps/web/src/**/*.test.tsx only when needed to understand or verify behavior
- infra/docker-compose*.yml
- infra/litellm/**
- infra/migrations/**
- .env.example
- package.json and workspace package.json files
- scripts/*.mjs
- README.md and docs/security-review-2026-06-17.md only as context

Treat docs/security-review-2026-06-17.md as seed material, not truth. Re-validate each old issue against the current code and suppress it if current code has fixed it.

Prioritize exploitable vulnerabilities and security-relevant correctness bugs: authentication and authorization bypass, IDOR/cross-account access, token or secret exposure, webhook replay or spoofing, SSRF, XSS, HTML or header injection, SQL/query injection, unsafe file or attachment handling, prompt injection with data exfiltration or unauthorized mutation, email send abuse, sender spoofing, duplicate send or lost-mail bugs, queue lease/idempotency failures, unsafe default production config, and Docker/network exposure.

Also find severe non-security correctness bugs that can block internal testing or launch: account mix-ups, silent data loss, duplicate email sends, missing rollback after provider failure, stale UI state causing unsafe API calls, worker jobs that appear successful but did nothing, and production readiness checks that pass while a required capability is broken.

For every candidate finding, require concrete source-to-sink evidence with file and line references, a plausible attacker, impact, current controls, why controls fail or hold, and a minimal regression-test idea. Keep independently reachable instances separate.
```

## 1. Launch-Path Baseline

Use this first to build a broad threat model and catch cross-module issues.

```text
Run a scoped Codex Security scan for the Email Hub launch path only.

Scope includes:
- apps/web/src
- apps/api-node/src
- apps/worker-node/src
- infra/docker-compose*.yml
- infra/litellm/**
- infra/migrations/**
- .env.example
- package.json and workspace package.json files
- scripts/*.mjs

Exclude apps/native-engine, dist, node_modules, and generated artifacts.

Model the product as a self-hosted email aggregation app using EmailEngine, Postgres, Redis, a Node API, a Node worker, and a Vite/React frontend. Important assets are private emails, attachments, OAuth refresh tokens, IMAP/SMTP passwords, EmailEngine access/prepared tokens, Hermes provider API keys, outbound send authority, domain alias routes, and operational logs.

Find cross-module vulnerabilities that require understanding more than one workspace: browser token to API authorization, account scoping across routes and stores, API-to-worker outbox trust, EmailEngine webhook-to-mirror flow, compose-to-scheduled-send flow, Hermes-to-mail data boundaries, Docker env defaults, and production launch readiness.
```

## 2. API Router, Auth, And Account Scope

```text
Run a scoped Codex Security scan focused on API request authorization, route parsing, and cross-account access.

Primary files:
- apps/api-node/src/http/router.ts
- apps/api-node/src/config.ts
- apps/api-node/src/server.ts
- apps/api-node/src/logging/**
- apps/web/src/lib/emailHubApi.ts
- apps/web/src/main.tsx
- relevant route tests under apps/api-node/tests/*Routes*.test.ts and apps/web/src/lib/emailHubApi.test.ts

Attack focus:
- missing or bypassable auth on /api/* routes
- incorrect exemptions for /api/webhooks/emailengine and /api/mail-engine/auth-server
- account-scoped token bypasses, routes that miss readScopedRouteAccountId, and routes that accept accountId in query/body without ownership checks
- admin-only endpoints reachable by account-scoped browser tokens
- IDOR through accountId, messageId, mailboxId, attachmentId, draftId, scheduledId, domainId, aliasId, memoryId, rule candidate id, audit event id, and task id
- GET/POST method confusion, malformed path decoding, double encoding, trailing slash, query accountId ambiguity, and URL parsing edge cases
- diagnostics and operational event exposure
- request body size limits and JSON parse error behavior
- logging of sensitive URL/query/body fields

Re-test old findings from docs/security-review-2026-06-17.md about missing API auth and account scoping against the current token and route-scope code.
```

## 3. Account Onboarding, OAuth, CSV, Reauthorization, Secrets

```text
Run a scoped Codex Security scan focused on mailbox onboarding and credential lifecycle.

Primary files:
- apps/api-node/src/accounts/**
- apps/api-node/src/mail-engine/email-engine-accounts-client.ts
- apps/api-node/src/mail-engine/email-engine-auth-server.ts
- apps/api-node/src/api-token-fetch.ts
- apps/worker-node/src/credentials/**
- apps/worker-node/src/secrets/**
- apps/worker-node/src/google/**
- apps/worker-node/src/microsoft/**
- apps/worker-node/src/mail-provider/native-adapters.ts
- apps/worker-node/src/account-provider-settings-store.ts
- infra/migrations/0004_stored_secrets.sql
- infra/migrations/0039_account_onboarding_account_keys.sql
- relevant onboarding, OAuth, CSV, reauthorization, secret-store tests

Attack focus:
- OAuth CSRF/state replay, callback mix-up, redirectUri trust, tenant/provider confusion, loginHint abuse, missing profile/account matching, duplicated account reservation races
- refresh token and IMAP/SMTP password storage, secret refs, redaction, diagnostic/log leaks, auth-server credential disclosure to EmailEngine
- SSRF or internal network probing through IMAP/SMTP host, Proton Bridge override, OAuth token/profile URLs, Gmail/Graph base URLs, and provider preset overrides
- CSV import resource exhaustion, malformed quoted fields, formula injection into later exports/UI, partial import consistency, hidden credential leakage in preview/errors
- reauthorization task ownership, task-id IDOR, OAuth reauth state binding, password reauth redaction, provider mismatch
- production vs development secret defaults and whether tests actually cover fail-closed behavior
```

## 4. EmailEngine Boundary, Webhooks, Sync Mirror

```text
Run a scoped Codex Security scan focused on EmailEngine trust boundaries.

Primary files:
- apps/api-node/src/mail-engine/**
- apps/api-node/src/http/router.ts webhook and auth-server handlers
- apps/api-node/src/server.ts EmailEngine wiring
- apps/worker-node/src/mail-engine/**
- apps/worker-node/src/provider-ref-store.ts
- apps/worker-node/src/sync-*.ts
- apps/worker-node/src/account-state-processor.ts
- infra/docker-compose*.yml
- infra/migrations/0002_mail_engine_runtime.sql
- infra/migrations/0003_provider_refs.sql
- infra/migrations/0006_mail_engine_resource_identity.sql
- infra/migrations/0007_emailengine_provider_ref_identity.sql
- relevant EmailEngine webhook/auth/mirror/sync tests

Attack focus:
- webhook HMAC verification, signature format, body canonicalization, timing-safe compare, freshness window, replay, delivery event id trust, missing event id behavior, idempotency key collisions
- webhook normalization of provider ids, message ids, paths, UIDs, thread ids, and account ids from untrusted payloads
- forged or stale webhooks causing sync jobs, deletes, auth failures, state corruption, or operational noise
- EmailEngine auth-server Basic auth, default secret rejection, credential selection, and cross-account credential access
- EmailEngine access token exposure in readiness, logs, Docker env, and smoke scripts
- mirror-store handling of untrusted provider payloads, provider refs, tombstones, attachments, labels, bodyHtml/bodyText, search documents, and classification
- whether app APIs ever expose raw EmailEngine/provider ids to the web client
```

## 5. Mail Read, Search, Attachments, And Web XSS

```text
Run a scoped Codex Security scan focused on mail content rendering, search, downloads, and attachment storage.

Primary files:
- apps/api-node/src/mail-read/**
- apps/api-node/src/mail-engine/email-engine-attachments-client.ts
- apps/api-node/src/mail-engine/email-engine-attachment-content-store.ts
- apps/api-node/src/mail-compose/compose-attachment-blob-store.ts
- apps/api-node/src/maintenance/compose-attachment-maintenance.ts
- apps/worker-node/src/search/**
- apps/worker-node/src/mail-engine/postgres-mirror-store.ts attachment/text extraction paths
- apps/web/src/App.tsx reader, attachment, htmlToReadableText, download paths
- apps/web/src/features/compose/ComposeReview.tsx
- apps/web/src/features/compose/rich-text.ts
- apps/web/src/lib/emailHubApi.ts
- relevant mail-read, attachment, compose, XSS-like tests

Attack focus:
- stored XSS through subject, sender name/email, recipients, snippet, bodyHtml, attachment filename/contentId/contentType, labels, Hermes output, diagnostics, and error messages
- `dangerouslySetInnerHTML` in ComposeReview and whether controlledBodyHtml can include attacker-controlled HTML or unsafe links
- rich text markdown-to-HTML link handling, javascript/data URL bypasses, quote/list formatting injection
- HTML email conversion through template.innerHTML and any future raw rendering path
- attachment download headers: Content-Type, Content-Disposition, filename/filename*, CRLF injection, nosniff, dangerous inline types, size enforcement, slow/oversized streams
- uploaded compose attachment storage: path traversal, storageKey validation, metadata tampering, account binding, symlink/race behavior, cleanup safety, byte limits
- attachment text extraction: untrusted file types, size gates, memory pressure, retry/dead-letter behavior, data leakage into search previews
- SQL/query safety in search filters, cursor decoding, saved views, label filters, full-text query construction, and global messages routes
```

## 6. Compose, Send, Outbox, Mail Actions, Engine Commands

```text
Run a scoped Codex Security scan focused on anything that mutates mail or sends email.

Primary files:
- apps/api-node/src/mail-compose/**
- apps/api-node/src/mail-actions/**
- apps/api-node/src/native-send/**
- apps/api-node/src/accounts/graph-submit-client.ts
- apps/worker-node/src/scheduled-send-runner.ts
- apps/worker-node/src/postgres-scheduled-send-store.ts
- apps/worker-node/src/engine-command-*.ts
- apps/worker-node/src/postgres-engine-command-queue.ts
- apps/worker-node/src/mail-provider/**
- apps/worker-node/src/mail-engine/email-engine-client.ts
- infra/migrations/0014_email_drafts.sql
- infra/migrations/0015_engine_command_leases.sql
- infra/migrations/0019_message_done_undo.sql
- infra/migrations/0020_scheduled_sends.sql
- infra/migrations/0024_email_draft_send_leases.sql
- infra/migrations/0033_email_draft_send_identity.sql
- infra/migrations/0037_email_draft_attachment_manifest.sql
- infra/migrations/0038_provider_send_identities.sql
- relevant compose, mail-action, scheduled-send, command-queue tests

Attack focus:
- unauthorized draft create/update/send/schedule/send-now/cancel/reschedule across accounts
- From spoofing, send identity verification bypass, Graph/Gmail shared-send target confusion, and user endpoint eligibility mistakes
- duplicate sends from retry, lease expiry, idempotency-key collision, send-now races, stale scheduled rows, worker crash between provider submit and DB mark-sent
- header injection in subject/from/to/cc/bcc/content-id/filename/threading headers
- unsafe bodyHtml or attachment content sent to providers
- local state mutation before provider failure, undo token misuse, archive/delete/move/label command target resolution mistakes
- command queue account-aware concurrency, dead-lettering, non-retryable errors, and provider ref resolution
- native-provider launch isolation: non-EmailEngine providers should not become default production path while disabled
```

## 7. Hermes / LLM Runtime, Prompt Injection, Memory, Rules

```text
Run a scoped Codex Security scan focused on Hermes AI boundaries and runtime settings.

Primary files:
- apps/api-node/src/hermes/**
- apps/api-node/src/http/hermes-search-qa-input.ts
- apps/api-node/src/http/router.ts Hermes routes
- apps/web/src/features/hermes/**
- apps/web/src/lib/hermes.ts
- apps/web/src/features/hermes/HermesRuntimeSettingsPanel.tsx
- infra/litellm/hermes-config.yaml
- infra/docker-compose.hermes.yml
- infra/migrations/0005_hermes_runtime.sql
- infra/migrations/0012_hermes_memory_indexes.sql
- infra/migrations/0013_hermes_feedback_indexes.sql
- infra/migrations/0018_hermes_rule_learning.sql
- infra/migrations/0028_hermes_audit_log_indexes.sql
- infra/migrations/0030_hermes_runtime_settings.sql
- infra/migrations/0041_hermes_action_plans.sql through 0051_hermes_runtime_default_provider.sql
- relevant Hermes tests

Attack focus:
- prompt injection from malicious emails, search results, memory records, draft feedback, custom instructions, rule candidates, labels, sender names, and user prompts
- whether Hermes can mutate mail, approve rules, create action plans, or send drafts without explicit confirmation
- memory isolation by account/scope/layer, memoryId IDOR, audit event disclosure, retention cleanup, and sensitive mail body leakage to logs
- provider runtime SSRF through endpointUrl, model endpoint templates, version-check URL, LiteLLM base URL, and custom provider keys
- provider API key storage, update/clear behavior, public DTO redaction, diagnostics redaction, browser token exposure
- model response parsing and JSON coercion that could turn prompt output into unsafe actions, labels, rules, follow-ups, summaries, translations, or draft text
- ordinary UI product rule: Hermes page should expose only assistant name, provider selection, API key, and connection test, not system internals
```

## 8. Domain Alias, Gatekeeper, Smart Inbox, Follow-Ups

```text
Run a scoped Codex Security scan focused on domain setup, alias routing, sender screening, Smart Inbox feedback, and follow-up state.

Primary files:
- apps/api-node/src/domains/**
- apps/api-node/src/gatekeeper/**
- apps/api-node/src/smart-inbox/**
- apps/api-node/src/follow-ups/**
- apps/api-node/src/labels/**
- apps/worker-node/src/alias-routing/**
- apps/worker-node/src/smart-inbox/**
- apps/worker-node/src/follow-up-reminder-runner.ts
- apps/worker-node/src/postgres-follow-up-reminder-store.ts
- apps/web/src/features/domain-alias/**
- apps/web/src/features/gatekeeper/**
- apps/web/src/features/follow-ups/**
- apps/web/src/features/search/**
- apps/web/src/App.tsx domain and screening surfaces
- infra/migrations/0011_smart_inbox_feedback_rules.sql
- infra/migrations/0016_domain_alias_indexes.sql
- infra/migrations/0017_alias_delivery_jobs.sql
- infra/migrations/0021_follow_up_reminders.sql
- infra/migrations/0022_domain_destinations.sql
- infra/migrations/0023_sender_screening.sql
- infra/migrations/0027_gatekeeper_settings.sql
- infra/migrations/0040_account_labels.sql
- relevant tests

Attack focus:
- domainId/aliasId/destinationId/catch-all/delivery-log IDOR and missing ownership checks
- DNS/domain verification bypass, unsafe assumptions about Cloudflare/manual DNS, confusing UI that implies verified state
- alias route abuse, catch-all forwarding loops, destination spoofing, delivery job idempotency, webhook handoff SSRF via ALIAS_DELIVERY_WEBHOOK_URL
- sender screening accept/block/domain-block authorization and bulk action abuse
- Smart Inbox feedback creating cross-account memories or sender rules
- label name/color injection, saved-view query abuse, follow-up reminder state manipulation, and operational log privacy
```

## 9. Worker Queues, Leases, Cleanup, Runtime Reliability Bugs

```text
Run a scoped Codex Security scan focused on worker reliability bugs with security or data-loss impact.

Primary files:
- apps/worker-node/src/main.ts
- apps/worker-node/src/worker*.ts
- apps/worker-node/src/*queue*.ts
- apps/worker-node/src/*runner*.ts
- apps/worker-node/src/runtime-config.ts
- apps/worker-node/src/runtime-shutdown.ts
- apps/worker-node/src/logging/**
- apps/worker-node/src/mail-engine/**
- apps/worker-node/src/search/**
- apps/worker-node/src/compose-attachment-cleanup-runner.ts
- apps/worker-node/src/hermes-retention-cleanup-runner.ts
- apps/api-node/src/maintenance/**
- infra/migrations/0015_engine_command_leases.sql
- infra/migrations/0024_email_draft_send_leases.sql
- infra/migrations/0032_attachment_text_extraction_jobs.sql
- infra/migrations/0045_hermes_rule_active_runs.sql
- infra/migrations/0048_hermes_worker_rule_run_idempotency.sql
- relevant worker tests and Postgres stress tests

Attack focus:
- lease stealing, SKIP LOCKED races, account-aware concurrency gaps, duplicate processing, stuck jobs, dead-letter bypass, retry backoff bugs
- cleanup deleting active compose attachments, Hermes audit/memory records, or attachment blobs still referenced by drafts/outbox
- crash consistency between provider side effects and DB state
- worker diagnostics leaking private mail, secrets, provider payloads, or account ids
- healthcheck/readiness conditions that allow production worker to run without required EmailEngine tokens or secrets
- resource exhaustion from high concurrency, huge payloads, attachment extraction, and unbounded result sets
```

## 10. Infra, Docker, Env, Migrations, Supply Chain

```text
Run a scoped Codex Security scan focused on deployment configuration and schema-level security.

Primary files:
- infra/docker-compose.yml
- infra/docker-compose.prod.yml
- infra/docker-compose.test.yml
- infra/docker-compose.hermes.yml
- infra/litellm/hermes-config.yaml
- infra/migrations/**
- .env.example
- package.json
- apps/api-node/package.json
- apps/worker-node/package.json
- apps/web/package.json
- apps/*/Dockerfile
- scripts/emailhub-compose.mjs
- scripts/check-file-size.mjs
- apps/api-node/src/mail-engine/production-env-preflight.ts
- apps/api-node/src/emailengine-prod-env-verify-runner.ts
- apps/api-node/src/mail-engine/docker-compose-*.ts
- relevant Docker/env verifier tests

Attack focus:
- unsafe production defaults, default shared secrets, weak Postgres password defaults, token mismatch, browser-bundled API token assumptions
- service bind addresses, Docker network exposure, auth-server URL credentials, EmailEngine service secret, prepared-token requirements, Redis no-auth assumptions
- image pinning and digest drift, LiteLLM gateway token requirements, env var injection into JSON settings, shell quoting in healthchecks and compose wrapper
- migrations missing uniqueness, ownership, foreign keys, cascade behavior, idempotency constraints, indexes for auth/scoping, and state-machine constraints
- whether production overlay actually overrides development defaults and makes readiness fail closed
```

## 11. Frontend Product Surface, Privacy, And UI Data Exposure

```text
Run a scoped Codex Security scan focused on frontend privacy, unsafe product
surface, and user-facing data exposure.

Primary files:
- apps/web/src/App.tsx
- apps/web/src/styles.css
- apps/web/src/lib/emailHubApi.ts
- apps/web/src/features/add-mail/**
- apps/web/src/features/compose/**
- apps/web/src/features/domain-alias/**
- apps/web/src/features/gatekeeper/**
- apps/web/src/features/hermes/**
- apps/web/src/features/maintenance/**
- apps/web/src/features/search/**
- apps/web/src/features/settings/**
- apps/web/src/features/sync-center/**
- apps/web/src/**/*.test.tsx only when needed to understand intended behavior

Product/security rules to enforce:
- Ordinary users must not see development-only panels, smoke/test accounts,
  raw diagnostics, internal IDs, provider payloads, EmailEngine internals,
  Hermes rules/memory/audit/skill settings, or backend setup jargon.
- Add Mail must not expose enterprise CSV/account migration controls in the
  regular user flow.
- Search should be a top/global search entry, not a confusing left-nav module.
- Hermes page should expose only assistant name, provider, API key, and test
  connection.
- Settings should remain clean; advanced maintenance can exist but should not
  leak secrets, tokens, raw env names, raw provider errors, or internal tables.
- Mail body, snippets, sender names, labels, diagnostics, Hermes responses, and
  attachment filenames must render as text unless explicitly sanitized.

Attack focus:
- stored/reflected XSS through any user-visible field
- accidental display of tokens, refresh secrets, app passwords, EmailEngine
  access/prepared tokens, provider refs, account ids, message ids, attachment
  storage keys, or raw API errors
- confusing UI that causes users to submit Gmail/Outlook passwords where OAuth
  should be used
- stale selected account state causing Hermes memory/search/settings to use the
  wrong account
- global search accidentally narrowing to the current account or current-account
  search accidentally broadening to all accounts
- UI-only restrictions without backend enforcement
- console logging or test/demo data leaking into production UI
```

## 12. Cross-Module Abuse Chains

Use this after the module scans. It should look for bugs that only appear when
multiple features interact.

```text
Run a scoped Codex Security scan looking only for multi-step attack chains across
the Email Hub launch path.

Scope:
- apps/web/src
- apps/api-node/src
- apps/worker-node/src
- infra/docker-compose*.yml
- infra/migrations/**
- .env.example
- relevant tests only as behavior references

Exclude:
- apps/native-engine/**
- node_modules, dist, coverage, caches

Find attack chains with at least two components, for example:
- malicious email -> mirrored body/snippet/search doc -> frontend render -> XSS
  -> API token abuse
- forged EmailEngine webhook -> queued sync/job -> worker state mutation ->
  cross-account message exposure
- account-scoped browser token -> route that accepts arbitrary accountId ->
  attachment download or draft send
- malicious attachment filename/content-type -> download headers -> browser code
  execution or credential theft
- Hermes prompt injection -> unsafe action plan/rule/memory -> future automated
  classification or reply draft corruption
- OAuth callback confusion -> wrong account binding -> sync or send authority on
  another mailbox
- stale scheduled send lease -> duplicate provider send -> DB marks one send
  only
- alias/domain misconfiguration -> forwarding loop or unauthorized destination
- Docker/env default -> API reachable without auth or with default token

For every chain, show each hop with exact file:line evidence. Do not report a
chain unless every hop is currently reachable.
```

## 13. Launch-Blocker Triage

Use this after fixing or suppressing module findings. It is designed to produce
a practical internal-test gate.

```text
Review the current Email Hub launch path and produce a launch-blocker security
and reliability triage.

Do not edit code. Do not scan apps/native-engine.

Classify each risk as:
- Block internal test today
- Can test with controlled users
- Must fix before public beta
- Backlog after EmailEngine-first launch

Use current code evidence only. Consider:
- whether self-hosted Docker can start securely with documented env values
- whether API auth fails closed in production
- whether EmailEngine webhooks, auth-server, attachment download, and send paths
  are protected against spoofing/replay/cross-account access
- whether Hermes setup can safely use real provider keys from the sidebar
- whether front-end pages are clean enough for non-developer testers
- whether any remaining Native/Core code can accidentally enter production path
- whether test/demo data can appear in normal UI
- whether full frontend/backend tests and focused smoke checks cover the launch
  blockers

Output a ranked checklist with exact evidence and the smallest next action for
each blocker.
```

## 14. Final Reconciliation Prompt

After running the module scans, use this to consolidate and remove duplicates:

```text
Review the Codex Security reports generated for the Email Hub launch-path module scans.

Do not rescan apps/native-engine. Do not edit code.

Merge duplicate findings only when one fix would fully remediate every instance. Keep independently exploitable route, queue, sender, attachment, prompt-injection, SSRF, and auth-scope instances separate.

For each surviving finding, produce:
- severity
- affected module
- exact file:line evidence
- source-to-sink attack path
- whether docs/security-review-2026-06-17.md already mentioned it
- whether current tests cover it
- recommended minimal fix
- recommended regression test
- launch-blocker yes/no

Also produce a short "suppressed old findings" section explaining which 2026-06-17 findings appear fixed in current code and what evidence supports suppression.
```
