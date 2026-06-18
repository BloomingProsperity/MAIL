# Repository Guidelines

## Project Structure & Module Organization

Email Hub is a monorepo. `apps/web` contains the React/Vite/TypeScript frontend. `apps/api-node` is the MVP Node API for health checks, EmailEngine webhooks, and future onboarding routes. `apps/worker-node` is the Node background worker for sync, mirror, Hermes, and import lanes. Self-developed Native/Core experiments live under `apps/native-engine/` and must stay outside the EmailEngine-first launch path. Docker and SQL migrations live in `infra/`; research and implementation notes live in `research/` and `docs/`.

## Build, Test, and Development Commands

- `npm install` installs all workspaces.
- `npm run dev` starts the web app.
- `npm run dev:api` starts the Node API.
- `npm run build` builds the web app.
- `npm run build:backend` compiles the API and worker.
- `npm run lint:file-size` enforces the handwritten file-size guard and legacy
  large-file caps.
- `npm test` runs frontend tests.
- `npm run test:backend` runs API and worker tests.
- `docker compose -f infra/docker-compose.yml up --build` starts web, API, worker, Postgres, Redis, and EmailEngine.

## Coding Style & Naming Conventions

Use TypeScript with strict compiler settings. React components use `PascalCase`; utilities use `camelCase`; CSS classes use descriptive kebab-case. Backend modules should keep provider-specific code behind adapter boundaries such as `mail-engine/webhook.ts`. Do not wire frontend code directly to EmailEngine payloads.

## Maintainability & Layout

Keep files small and responsibilities obvious. Prefer clear module folders such as `google/`, `mail-engine/`, `mail-provider/`, and `accounts/` over large mixed files. Name tests after user-visible behavior, keep setup readable, and format long objects or route flows across multiple lines instead of dense one-liners.

## File Size & Module Boundaries

All handwritten source, test, script, and configuration files should stay focused and easy to review. Avoid creating or extending 1,000+ line handwritten files unless they are generated artifacts, static fixtures, or have a documented exception. When a change adds a new page, route flow, adapter, panel, worker lane, test harness, or other substantial behavior, put it in a dedicated component, hook, service, feature module, helper, or fixture instead of growing a mixed file.

Large existing files are technical debt, not a pattern to copy. For the existing oversized `apps/web/src/App.tsx`, treat it as a legacy shell rather than a place to keep adding whole features. New frontend work should move page- or feature-level code into focused files such as `pages/`, `features/`, `components/`, or hooks/util modules. Future cleanup should happen opportunistically: extract one stable feature at a time, keep behavior unchanged, and verify with focused tests instead of pausing launch work for a risky broad rewrite.

Run `npm run lint:file-size` when adding or moving handwritten source, tests,
scripts, or configuration. Current oversized files are locked to explicit
legacy caps; do not raise those caps unless the change first extracts or reduces
the oversized file.

## Self-Developed Core Isolation

Do not place self-developed mail core, Native Engine, model runtime, or other
large core services directly in the repository root or mix them into the
EmailEngine-first launch path. The root stays for workspace orchestration,
Docker entrypoints, docs, and shared configuration only. Future native/core
work must live behind an explicit boundary such as `apps/native-engine/`,
`packages/native-core/`, or another dedicated module with its own tests,
service contract, and Docker boundary. Existing adapter shims inside API or
worker code may remain only as gated compatibility code; they must not become
the default production path while Native Engine is paused.

For the EmailEngine-first launch, self-developed Native/Core code must be
isolated from production deployment. Do not expose Native Engine controls,
labels, routes, or configuration in the user UI. Do not add Native Engine
containers, env toggles, or runtime branches to the launch Docker path. If a
Native/Core experiment is preserved, move it behind a separate module boundary
and keep it outside the default web/API/worker production build.

## Product Surface Rules

Keep the ordinary user experience clean and mail-client-like. The left
navigation order is: mailbox, add mailbox, search, Hermes, domain setup, and
settings. Search appears in the top bar, not as a left-sidebar workspace when
the mailbox shell is visible. The mailbox folder list should follow Outlook-like
mail folders: Inbox, Drafts, Sent, Deleted, Junk, Archive, All Mail, flagged or
reminder states, and attachments. Do not add separate task or rule workspaces
for ordinary users; follow-up work is represented as Outlook-style flags,
reminders, or reply states on mail.

Compose and reply behavior should follow Outlook-style interaction. New
compose opens in a floating window with a polished scale/transition effect, and
reply/forward can open as an editable module in the right-side reading pane.
The three-column mailbox should not be pushed down by compose surfaces.

Hermes is the only AI entry. The ordinary Hermes page shows only a user-editable
assistant name, LLM provider selection, API key entry, and connection test. Do
not expose skills, memory, audit logs, resource budgets, rule internals, or
system prompts in the ordinary UI; those capabilities are system-owned and may
only appear in clearly separated administrator surfaces when needed.

Settings may include an administrator section, but administrator content should
be grouped and collapsed with drawers/sections instead of shown as a wall of
system controls. Ordinary pages must not ask users to configure system internals
other than the Hermes provider/key flow and the domain setup flow.

Domain setup is a first-class left-navigation area named "配置域名". It should
support manual DNS instructions, DNS verification, and Cloudflare-assisted setup.
Cloudflare automation must have a clear token permission boundary and should not
hide the manual record-copy path.

## Testing Guidelines

Tests use Vitest. Place backend tests under each workspace `tests/` directory and frontend tests beside source files. Prefer strong behavior tests over snapshots, for example webhook signature rejection, OAuth token redaction, retry dead-lettering, or "mail folders remain in the second column." Write failing tests before production changes when adding behavior.

## Verification Discipline

Avoid repeating broad full-suite tests when the same unchanged work was already verified recently. Prefer the smallest meaningful check for the current diff: targeted Vitest files, the relevant workspace build, focused Docker or launch verifier commands, and `git diff --check`. Run full frontend, backend, or Docker verification only when the change crosses shared boundaries, affects launch wiring, invalidates earlier results, or the user explicitly asks for a full pass.

## Commit & Pull Request Guidelines

There is no established commit history yet. Use concise Conventional Commit-style messages such as `feat(api): verify emailengine webhooks` or `docs: record backend language decision`. PRs should include a summary, test results, linked task, and screenshots for UI changes.

## Security & Configuration Tips

Copy `.env.example` to `.env` locally. Do not commit OAuth secrets, app passwords, mailbox credentials, exported migration packages, or private key paths. Keep Docker service names stable because compose wiring depends on `postgres`, `redis-engine`, `emailengine`, `api`, `worker`, and `web`.
