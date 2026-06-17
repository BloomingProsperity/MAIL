# Repository Guidelines

## Project Structure & Module Organization

Email Hub is a monorepo. `apps/web` contains the React/Vite/TypeScript frontend. `apps/api-node` is the MVP Node API for health checks, EmailEngine webhooks, and future onboarding routes. `apps/worker-node` is the Node background worker for sync, mirror, Hermes, and import lanes. The older Rust crates in `apps/api` and `apps/worker` are legacy skeletons kept as reference for a later native sidecar. Docker and SQL migrations live in `infra/`; research and implementation notes live in `research/` and `docs/`.

## Build, Test, and Development Commands

- `npm install` installs all workspaces.
- `npm run dev` starts the web app.
- `npm run dev:api` starts the Node API.
- `npm run build` builds the web app.
- `npm run build:backend` compiles the API and worker.
- `npm test` runs frontend tests.
- `npm run test:backend` runs API and worker tests.
- `docker compose -f infra/docker-compose.yml up --build` starts web, API, worker, Postgres, Redis, and EmailEngine.

## Coding Style & Naming Conventions

Use TypeScript with strict compiler settings. React components use `PascalCase`; utilities use `camelCase`; CSS classes use descriptive kebab-case. Backend modules should keep provider-specific code behind adapter boundaries such as `mail-engine/webhook.ts`. Do not wire frontend code directly to EmailEngine payloads.

## Maintainability & Layout

Keep files small and responsibilities obvious. Prefer clear module folders such as `google/`, `mail-engine/`, `mail-provider/`, and `accounts/` over large mixed files. Name tests after user-visible behavior, keep setup readable, and format long objects or route flows across multiple lines instead of dense one-liners.

## Frontend File Size & Module Boundaries

`apps/web/src/App.tsx` is already too large and should be treated as a legacy shell, not a place to keep adding whole features. New frontend work should move page- or feature-level code into focused files such as `pages/`, `features/`, `components/`, or hooks/util modules. When touching `App.tsx`, keep edits narrowly scoped; if a change adds a new page, large panel, form flow, or more than a small localized patch, extract that code instead of growing the file. Prefer incremental behavior-preserving extraction with targeted tests over a large one-shot refactor.

Avoid creating or extending 1,000+ line handwritten source files unless they are generated artifacts or there is a documented exception. Before adding substantial frontend behavior, check whether the change belongs in a dedicated component, hook, feature module, API helper, or test fixture. For the existing oversized `App.tsx`, future cleanup should happen opportunistically: extract one stable feature at a time, keep behavior unchanged, and verify with focused tests instead of pausing launch work for a risky broad rewrite.

## Testing Guidelines

Tests use Vitest. Place backend tests under each workspace `tests/` directory and frontend tests beside source files. Prefer strong behavior tests over snapshots, for example webhook signature rejection, OAuth token redaction, retry dead-lettering, or "mail folders remain in the second column." Write failing tests before production changes when adding behavior.

## Commit & Pull Request Guidelines

There is no established commit history yet. Use concise Conventional Commit-style messages such as `feat(api): verify emailengine webhooks` or `docs: record backend language decision`. PRs should include a summary, test results, linked task, and screenshots for UI changes.

## Security & Configuration Tips

Copy `.env.example` to `.env` locally. Do not commit OAuth secrets, app passwords, mailbox credentials, exported migration packages, or private key paths. Keep Docker service names stable because compose wiring depends on `postgres`, `redis-engine`, `emailengine`, `api`, `worker`, and `web`.
