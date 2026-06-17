import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readApiConfig } from "../src/config";

const repoRoot = join(import.meta.dirname, "..", "..", "..");
const DEFAULT_EMAILENGINE_IMAGE =
  "postalsys/emailengine:v2.71.0@sha256:4f732fd40e39f8e3af0b3d1580f1972a7e7270741be510f217a6b07eac5b0efc";

async function readProjectFile(...parts: string[]): Promise<string> {
  return readFile(join(repoRoot, ...parts), "utf8");
}

describe("EmailEngine Docker configuration", () => {
  it("pins EmailEngine to a repeatable default image instead of latest", async () => {
    const envExample = await readProjectFile(".env.example");
    const readme = await readProjectFile("README.md");
    const compose = await readProjectFile("infra", "docker-compose.yml");
    const emailEngine = serviceSection(compose, "emailengine");

    expect(emailEngine).toContain(
      `image: \${EMAILENGINE_IMAGE:-${DEFAULT_EMAILENGINE_IMAGE}}`,
    );
    expect(emailEngine).not.toContain("postalsys/emailengine:latest");
    expect(envExample).toContain(`EMAILENGINE_IMAGE=${DEFAULT_EMAILENGINE_IMAGE}`);
    expect(readme).toContain(DEFAULT_EMAILENGINE_IMAGE);
    expect(readme).toContain("Override `EMAILENGINE_IMAGE`");
  });

  it("keeps EmailEngine Redis snapshotted and non-evicting under self-hosted load", async () => {
    const compose = await readProjectFile("infra", "docker-compose.yml");

    expect(compose).toContain(
      'command: ["redis-server", "--save", "60", "10000", "--save", "300", "10", "--save", "900", "1", "--maxmemory-policy", "noeviction"]',
    );
    expect(compose).not.toContain("--appendonly");
  });

  it("documents and injects prepared EmailEngine tokens for self-hosted Docker startup", async () => {
    const envExample = await readProjectFile(".env.example");
    const compose = await readProjectFile("infra", "docker-compose.yml");
    const api = serviceSection(compose, "api");

    expect(envExample).toContain("EMAILENGINE_ACCESS_TOKEN=");
    expect(envExample).toContain("EENGINE_PREPARED_TOKEN=");
    expect(envExample).toContain("EMAILENGINE_AUTH_SERVER_SECRET=");
    expect(compose).toContain(
      "EENGINE_PREPARED_TOKEN: ${EENGINE_PREPARED_TOKEN:-}",
    );
    expect(
      compose.match(/EENGINE_PREPARED_TOKEN: \$\{EENGINE_PREPARED_TOKEN:-\}/g),
    ).toHaveLength(3);
    expect(
      compose.match(
        /EMAILENGINE_ACCESS_TOKEN: \$\{EMAILENGINE_ACCESS_TOKEN:-\}/g,
      ),
    ).toHaveLength(2);
    expect(api).toContain(
      "EMAILENGINE_AUTH_SERVER_SECRET: ${EMAILENGINE_AUTH_SERVER_SECRET:-dev-emailhub-secret}",
    );
  });

  it("reads the prepared token flag without exposing token values", () => {
    const config = readApiConfig({
      EMAILENGINE_ACCESS_TOKEN: "raw-secret-token",
      EENGINE_PREPARED_TOKEN: "prepared-secret-token",
    } as NodeJS.ProcessEnv);

    expect(config.emailEnginePreparedTokenConfigured).toBe(true);
    expect(JSON.stringify(config)).not.toContain("raw-secret-token");
    expect(JSON.stringify(config)).not.toContain("prepared-secret-token");
  });

  it("derives container database URLs from Postgres settings unless explicitly overridden", async () => {
    const envExample = await readProjectFile(".env.example");
    const compose = await readProjectFile("infra", "docker-compose.yml");
    const api = serviceSection(compose, "api");
    const worker = serviceSection(compose, "worker");

    expect(envExample).toContain(
      "Leave empty so Docker compose derives this from POSTGRES_USER/PASSWORD/DB.",
    );
    expect(envExample).toContain("DATABASE_URL=");
    for (const section of [api, worker]) {
      expect(section).toContain(
        "DATABASE_URL: ${DATABASE_URL:-postgres://${POSTGRES_USER:-emailhub}:${POSTGRES_PASSWORD:-emailhub_dev}@postgres:5432/${POSTGRES_DB:-emailhub}}",
      );
    }
  });

  it("pre-configures EmailEngine webhooks to call the API container in self-hosted Docker", async () => {
    const envExample = await readProjectFile(".env.example");
    const compose = await readProjectFile("infra", "docker-compose.yml");
    const emailEngine = serviceSection(compose, "emailengine");

    expect(envExample).toContain(
      "EMAILENGINE_WEBHOOK_URL=http://api:8080/api/webhooks/emailengine",
    );
    expect(envExample).toContain("EMAILENGINE_AUTH_SERVER_URL=");
    expect(envExample).toContain(
      "Leave empty so Docker compose derives this from EMAILENGINE_AUTH_SERVER_SECRET.",
    );
    expect(emailEngine).toContain("EENGINE_SETTINGS:");
    expect(emailEngine).toContain(
      '"webhooks":"${EMAILENGINE_WEBHOOK_URL:-http://api:8080/api/webhooks/emailengine}"',
    );
    expect(emailEngine).toContain(
      '"authServer":"${EMAILENGINE_AUTH_SERVER_URL:-http://emailengine:${EMAILENGINE_AUTH_SERVER_SECRET:-dev-emailhub-secret}@api:8080/api/mail-engine/auth-server}"',
    );
    expect(emailEngine).toContain('"webhooksEnabled":true');
    expect(emailEngine).toContain('"webhookEvents":["*"]');
    expect(emailEngine).toContain(
      '"serviceSecret":"${EMAILENGINE_WEBHOOK_SECRET:-dev-emailhub-secret}"',
    );
  });

  it("waits for actual EmailEngine, API, and web readiness in Docker compose", async () => {
    const compose = await readProjectFile("infra", "docker-compose.yml");

    expect(compose).toContain(
      'test: ["CMD-SHELL", "node -e \\"fetch(\'http://127.0.0.1:3000/health\').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\\""]',
    );
    expect(compose).toContain(
      'test: ["CMD-SHELL", "node -e \\"fetch(\'http://127.0.0.1:8080/health\').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\\""]',
    );
    expect(compose).toContain(
      'test: ["CMD-SHELL", "wget -q -O /dev/null http://127.0.0.1/ || exit 1"]',
    );
    expect(compose.match(/emailengine:\n\s+condition: service_healthy/g)).toHaveLength(2);
    expect(compose).toMatch(/web:[\s\S]*depends_on:[\s\S]*api:[\s\S]*condition: service_healthy/);
  });

  it("raises file descriptor limits for high-connection self-hosted mail services", async () => {
    const compose = await readProjectFile("infra", "docker-compose.yml");

    for (const service of ["emailengine", "api", "worker"]) {
      const section = serviceSection(compose, service);

      expect(section).toContain("ulimits:");
      expect(section).toContain("nofile:");
      expect(section).toContain("soft: ${EMAILHUB_NOFILE_SOFT:-65535}");
      expect(section).toContain("hard: ${EMAILHUB_NOFILE_HARD:-65535}");
    }
  });

  it("runs a worker healthcheck so self-hosted sync failures are visible", async () => {
    const compose = await readProjectFile("infra", "docker-compose.yml");
    const envExample = await readProjectFile(".env.example");
    const worker = serviceSection(compose, "worker");

    expect(worker).toContain("healthcheck:");
    expect(worker).toContain("npm run healthcheck -w apps/worker-node");
    expect(worker).toContain(
      "WORKER_HEALTH_REQUIRE_EMAILENGINE_TOKEN: ${WORKER_HEALTH_REQUIRE_EMAILENGINE_TOKEN:-false}",
    );
    expect(envExample).toContain("WORKER_HEALTH_REQUIRE_EMAILENGINE_TOKEN=false");
  });

  it("provides a strict production compose overlay for EmailEngine readiness", async () => {
    const envExample = await readProjectFile(".env.example");
    const readme = await readProjectFile("README.md");
    const prodCompose = await readProjectFile("infra", "docker-compose.prod.yml");
    const api = serviceSection(prodCompose, "api");
    const worker = serviceSection(prodCompose, "worker");

    expect(api).toContain("/api/mail-engine/health");
    expect(api).toContain(
      "body.ok && body.readiness?.status === 'ready' ? 0 : 1",
    );
    expect(worker).toContain('WORKER_HEALTH_REQUIRE_EMAILENGINE_TOKEN: "true"');
    expect(worker).not.toContain(
      "${WORKER_HEALTH_REQUIRE_EMAILENGINE_TOKEN:-false}",
    );
    expect(envExample).toContain(
      "infra/docker-compose.prod.yml sets this to true",
    );
    expect(readme).toContain("-f infra/docker-compose.prod.yml");
    expect(readme).toContain("readiness.status=ready");
    expect(readme).toContain("missing EmailEngine tokens");
    expect(readme).toContain("default webhook secret");
  });

  it("shares compose attachment blobs between API and worker with cleanup controls", async () => {
    const compose = await readProjectFile("infra", "docker-compose.yml");
    const envExample = await readProjectFile(".env.example");
    const api = serviceSection(compose, "api");
    const worker = serviceSection(compose, "worker");

    expect(envExample).toContain(
      "COMPOSE_ATTACHMENT_BLOB_DIR=/data/email-hub/compose-attachments",
    );
    expect(envExample).toContain("COMPOSE_ATTACHMENT_CLEANUP_RETENTION_HOURS=168");
    expect(envExample).toContain("COMPOSE_ATTACHMENT_CLEANUP_INTERVAL_MS=3600000");
    expect(envExample).toContain("COMPOSE_ATTACHMENT_CLEANUP_LIMIT=100");
    expect(api).toContain(
      "COMPOSE_ATTACHMENT_BLOB_DIR: ${COMPOSE_ATTACHMENT_BLOB_DIR:-/data/email-hub/compose-attachments}",
    );
    expect(worker).toContain(
      "COMPOSE_ATTACHMENT_BLOB_DIR: ${COMPOSE_ATTACHMENT_BLOB_DIR:-/data/email-hub/compose-attachments}",
    );
    expect(worker).toContain(
      "COMPOSE_ATTACHMENT_CLEANUP_RETENTION_HOURS: ${COMPOSE_ATTACHMENT_CLEANUP_RETENTION_HOURS:-168}",
    );
    expect(worker).toContain(
      "COMPOSE_ATTACHMENT_CLEANUP_INTERVAL_MS: ${COMPOSE_ATTACHMENT_CLEANUP_INTERVAL_MS:-3600000}",
    );
    expect(worker).toContain(
      "COMPOSE_ATTACHMENT_CLEANUP_LIMIT: ${COMPOSE_ATTACHMENT_CLEANUP_LIMIT:-100}",
    );
    expect(api).toContain(
      "- emailhub-compose-attachments:/data/email-hub/compose-attachments",
    );
    expect(worker).toContain(
      "- emailhub-compose-attachments:/data/email-hub/compose-attachments",
    );
    expect(compose).toContain("emailhub-compose-attachments:");
  });

  it("injects Hermes runtime environment into the API container", async () => {
    const envExample = await readProjectFile(".env.example");
    const compose = await readProjectFile("infra", "docker-compose.yml");
    const api = serviceSection(compose, "api");

    expect(envExample).toContain("HERMES_PROVIDER=hermes");
    expect(envExample).toContain("HERMES_CHAT_COMPLETIONS_URL=");
    expect(envExample).toContain("HERMES_API_KEY=");
    expect(envExample).toContain("HERMES_MODEL=hermes-email");
    expect(api).toContain("HERMES_PROVIDER: ${HERMES_PROVIDER:-hermes}");
    expect(api).toContain(
      "HERMES_CHAT_COMPLETIONS_URL: ${HERMES_CHAT_COMPLETIONS_URL:-}",
    );
    expect(api).toContain("HERMES_API_KEY: ${HERMES_API_KEY:-}");
    expect(api).toContain("HERMES_MODEL: ${HERMES_MODEL:-hermes-email}");
  });

  it("passes Gmail and Outlook OAuth settings into self-hosted API and worker containers", async () => {
    const compose = await readProjectFile("infra", "docker-compose.yml");
    const api = serviceSection(compose, "api");
    const worker = serviceSection(compose, "worker");

    for (const section of [api, worker]) {
      expect(section).toContain(
        "GOOGLE_OAUTH_CLIENT_ID: ${GOOGLE_OAUTH_CLIENT_ID:-}",
      );
      expect(section).toContain(
        "GOOGLE_OAUTH_CLIENT_SECRET: ${GOOGLE_OAUTH_CLIENT_SECRET:-}",
      );
      expect(section).toContain(
        "GOOGLE_OAUTH_TOKEN_URL: ${GOOGLE_OAUTH_TOKEN_URL:-https://oauth2.googleapis.com/token}",
      );
      expect(section).toContain(
        "GMAIL_API_BASE_URL: ${GMAIL_API_BASE_URL:-https://gmail.googleapis.com/gmail/v1}",
      );
      expect(section).toContain(
        "MICROSOFT_OAUTH_CLIENT_ID: ${MICROSOFT_OAUTH_CLIENT_ID:-}",
      );
      expect(section).toContain(
        "MICROSOFT_OAUTH_CLIENT_SECRET: ${MICROSOFT_OAUTH_CLIENT_SECRET:-}",
      );
      expect(section).toContain(
        "MICROSOFT_OAUTH_TENANT: ${MICROSOFT_OAUTH_TENANT:-common}",
      );
      expect(section).toContain(
        "MICROSOFT_OAUTH_TOKEN_URL: ${MICROSOFT_OAUTH_TOKEN_URL:-https://login.microsoftonline.com/common/oauth2/v2.0/token}",
      );
      expect(section).toContain(
        "MICROSOFT_GRAPH_BASE_URL: ${MICROSOFT_GRAPH_BASE_URL:-https://graph.microsoft.com/v1.0}",
      );
    }

    expect(api).toContain(
      "GOOGLE_OAUTH_AUTHORIZATION_URL: ${GOOGLE_OAUTH_AUTHORIZATION_URL:-https://accounts.google.com/o/oauth2/v2/auth}",
    );
    expect(api).toContain(
      "GMAIL_PROFILE_URL: ${GMAIL_PROFILE_URL:-https://gmail.googleapis.com/gmail/v1/users/me/profile}",
    );
    expect(api).toContain(
      "MICROSOFT_OAUTH_AUTHORIZATION_URL: ${MICROSOFT_OAUTH_AUTHORIZATION_URL:-https://login.microsoftonline.com/common/oauth2/v2.0/authorize}",
    );
    expect(api).toContain(
      "MICROSOFT_GRAPH_PROFILE_URL: ${MICROSOFT_GRAPH_PROFILE_URL:-https://graph.microsoft.com/v1.0/me}",
    );
  });

  it("keeps an IMAP/SMTP test mailbox service for real onboarding smoke checks", async () => {
    const rootPackage = JSON.parse(await readProjectFile("package.json"));
    const apiPackage = JSON.parse(
      await readProjectFile("apps", "api-node", "package.json"),
    );
    const testCompose = await readProjectFile("infra", "docker-compose.test.yml");
    const greenmail = serviceSection(testCompose, "greenmail-test");

    expect(rootPackage.scripts["smoke:imap-smtp-onboarding"]).toBe(
      "npm run smoke:imap-smtp-onboarding -w apps/api-node",
    );
    expect(apiPackage.scripts["smoke:imap-smtp-onboarding"]).toBe(
      "tsx src/imap-smtp-onboarding-smoke.ts",
    );
    expect(greenmail).toContain("image: greenmail/standalone:");
    expect(greenmail).toContain("-Dgreenmail.setup.test.all");
    expect(greenmail).toContain("-Dgreenmail.auth.disabled");
    expect(greenmail).toContain(
      "${GREENMAIL_SMTP_BIND:-127.0.0.1:3025}:3025",
    );
    expect(greenmail).toContain(
      "${GREENMAIL_IMAP_BIND:-127.0.0.1:3143}:3143",
    );
    expect(testCompose).toContain("${POSTGRES_TEST_BIND:-127.0.0.1:55432}:5432");
  });

  it("exposes a real EmailEngine webhook smoke that delivers mail through GreenMail", async () => {
    const rootPackage = JSON.parse(await readProjectFile("package.json"));
    const apiPackage = JSON.parse(
      await readProjectFile("apps", "api-node", "package.json"),
    );
    const envExample = await readProjectFile(".env.example");

    expect(rootPackage.scripts["smoke:emailengine-real-webhook"]).toBe(
      "npm run smoke:emailengine-real-webhook -w apps/api-node",
    );
    expect(rootPackage.scripts["smoke:emailengine-send"]).toBe(
      "npm run smoke:emailengine-send -w apps/api-node",
    );
    expect(rootPackage.scripts["smoke:emailengine-attachment-download"]).toBe(
      "npm run smoke:emailengine-attachment-download -w apps/api-node",
    );
    expect(rootPackage.scripts["smoke:emailengine-mail-action"]).toBe(
      "npm run smoke:emailengine-mail-action -w apps/api-node",
    );
    expect(apiPackage.scripts["smoke:emailengine-real-webhook"]).toBe(
      "tsx src/emailengine-real-webhook-smoke.ts",
    );
    expect(apiPackage.scripts["smoke:emailengine-send"]).toBe(
      "tsx src/emailengine-send-smoke.ts",
    );
    expect(apiPackage.scripts["smoke:emailengine-attachment-download"]).toBe(
      "tsx src/emailengine-attachment-download-smoke.ts",
    );
    expect(apiPackage.scripts["smoke:emailengine-mail-action"]).toBe(
      "tsx src/emailengine-mail-action-smoke.ts",
    );
    expect(envExample).toContain("EMAILHUB_SMOKE_DELIVERY_SMTP_HOST=127.0.0.1");
    expect(envExample).toContain("EMAILHUB_SMOKE_DELIVERY_SMTP_PORT=3025");
    expect(envExample).toContain("EMAILHUB_SMOKE_DELIVERY_SMTP_SECURE=false");
    expect(envExample).toContain(
      "EMAILHUB_SMOKE_ACCOUNT_ID=11111111-1111-4111-8111-111111111111",
    );
    expect(envExample).toContain(
      "EMAILHUB_SMOKE_WEBHOOK_EVENT=emailhubSmokeProbe",
    );
    expect(envExample).toContain(
      "EMAILHUB_REAL_WEBHOOK_SMOKE_INITIAL_SYNC_ATTEMPTS=180",
    );
    expect(envExample).toContain(
      "EMAILHUB_REAL_WEBHOOK_SMOKE_INITIAL_SYNC_POLL_MS=2000",
    );
    expect(envExample).toContain(
      "EMAILHUB_REAL_WEBHOOK_SMOKE_REUSE_EXISTING_ACCOUNT=false",
    );
    expect(envExample).toContain(
      "# EMAILHUB_SMOKE_MAIL_EMAIL=support@example.com",
    );
    expect(envExample).toContain("EMAILHUB_REAL_WEBHOOK_SMOKE_ATTEMPTS=60");
    expect(envExample).toContain("EMAILHUB_REAL_WEBHOOK_SMOKE_POLL_MS=2000");
    expect(envExample).toContain(
      "# EMAILHUB_SMOKE_RECIPIENT_EMAIL=recipient@example.com",
    );
    expect(envExample).toContain(
      "EMAILHUB_SMOKE_RECIPIENT_PROVIDER=custom_domain",
    );
    expect(envExample).toContain(
      "EMAILHUB_SMOKE_RECIPIENT_DISPLAY_NAME=Smoke Recipient",
    );
    expect(envExample).toContain(
      "EMAILHUB_SMOKE_RECIPIENT_SECRET=smoke-secret",
    );
    expect(envExample).toContain(
      "EMAILHUB_SEND_SMOKE_REUSE_EXISTING_ACCOUNT=false",
    );
    expect(envExample).toContain("EMAILHUB_SEND_SMOKE_ATTEMPTS=60");
    expect(envExample).toContain("EMAILHUB_SEND_SMOKE_POLL_MS=2000");
    expect(envExample).toContain(
      "EMAILHUB_ATTACHMENT_SMOKE_REUSE_EXISTING_ACCOUNT=false",
    );
    expect(envExample).toContain("EMAILHUB_ATTACHMENT_SMOKE_ATTEMPTS=60");
    expect(envExample).toContain("EMAILHUB_ATTACHMENT_SMOKE_POLL_MS=2000");
    expect(envExample).toContain(
      "EMAILHUB_MAIL_ACTION_SMOKE_REUSE_EXISTING_ACCOUNT=false",
    );
    expect(envExample).toContain("EMAILHUB_MAIL_ACTION_SMOKE_ATTEMPTS=60");
    expect(envExample).toContain("EMAILHUB_MAIL_ACTION_SMOKE_POLL_MS=2000");
    expect(envExample).toContain(
      "EMAILHUB_MAIL_ACTION_SMOKE_WORKER_DIAGNOSTIC_ATTEMPTS=60",
    );
    expect(envExample).toContain(
      "EMAILHUB_MAIL_ACTION_SMOKE_WORKER_DIAGNOSTIC_POLL_MS=2000",
    );
  });

  it("exposes layered EmailEngine-first launch verification gates", async () => {
    const rootPackage = JSON.parse(await readProjectFile("package.json"));
    const apiPackage = JSON.parse(
      await readProjectFile("apps", "api-node", "package.json"),
    );
    const envExample = await readProjectFile(".env.example");
    const readme = await readProjectFile("README.md");
    const dockerHealthScript = await readProjectFile(
      "apps",
      "api-node",
      "src",
      "emailengine-docker-health-verify.ts",
    );

    expect(apiPackage.scripts["verify:emailengine-live"]).toBe(
      "tsx src/emailengine-launch-verify.ts",
    );
    expect(apiPackage.scripts["verify:emailengine-docker-health"]).toBe(
      "tsx src/emailengine-docker-health-verify.ts",
    );
    expect(rootPackage.scripts["compose:up"]).toContain("--env-file \"$ENV_FILE\"");
    expect(rootPackage.scripts["compose:up"]).toContain("EMAILHUB_ENV_FILE");
    expect(rootPackage.scripts["compose:up"]).toContain("infra/docker-compose.yml up --build");
    expect(rootPackage.scripts["compose:up:detached"]).toContain(
      "--env-file \"$ENV_FILE\"",
    );
    expect(rootPackage.scripts["compose:up:detached"]).toContain(
      "infra/docker-compose.yml up -d --build",
    );
    expect(rootPackage.scripts["compose:up:prod"]).toContain(
      "infra/docker-compose.yml -f infra/docker-compose.prod.yml up --build",
    );
    expect(rootPackage.scripts["compose:up:prod:detached"]).toContain(
      "infra/docker-compose.yml -f infra/docker-compose.prod.yml up -d --build",
    );
    expect(rootPackage.scripts["compose:config:prod"]).toContain(
      "infra/docker-compose.prod.yml config >/dev/null",
    );
    expect(rootPackage.scripts["compose:config:prod"]).toContain(
      "EMAILHUB_ENV_FILE",
    );
    expect(rootPackage.scripts["compose:config:prod"]).not.toContain("/tmp/");
    expect(rootPackage.scripts["verify:emailengine-launch:offline"]).toContain(
      "npm run test:backend",
    );
    expect(rootPackage.scripts["verify:emailengine-launch:offline"]).toContain(
      "npm run build && npm test",
    );
    expect(rootPackage.scripts["verify:emailengine-launch:offline"]).toContain(
      "npm run stress:sync-queue:heavy",
    );
    expect(rootPackage.scripts["verify:emailengine-launch:docker-health"]).toBe(
      "npm run verify:emailengine-docker-health -w apps/api-node",
    );
    expect(envExample).toContain("EMAILHUB_API_BASE_URL=http://127.0.0.1:8080");
    expect(envExample).toContain("EMAILHUB_WEB_BASE_URL=http://127.0.0.1:5173");
    expect(envExample).toContain("EMAILHUB_DOCKER_HEALTH_TIMEOUT_MS=5000");
    expect(dockerHealthScript).toContain('name: "api_health"');
    expect(dockerHealthScript).toContain('name: "mail_engine_readiness"');
    expect(dockerHealthScript).toContain('name: "web_home"');
    expect(rootPackage.scripts["verify:emailengine-launch:live"]).toBe(
      "npm run verify:emailengine-live && npm run verify:emailengine-launch:docker-health && npm run smoke:emailengine-webhook",
    );
    expect(rootPackage.scripts["verify:emailengine-launch:greenmail"]).toBe(
      "npm run smoke:imap-smtp-onboarding && npm run smoke:emailengine-real-webhook && npm run smoke:emailengine-send && npm run smoke:emailengine-attachment-download && npm run smoke:emailengine-mail-action",
    );
    expect(rootPackage.scripts["verify:emailengine-launch:core"]).toBe(
      "npm run verify:emailengine-launch:offline && npm run verify:emailengine-launch:live",
    );
    expect(rootPackage.scripts["verify:emailengine-launch:strict-db"]).toBe(
      "npm run stress:sync-queue:postgres:strict",
    );
    expect(rootPackage.scripts["verify:emailengine-launch"]).toBe(
      "npm run verify:emailengine-launch:core && npm run verify:emailengine-launch:strict-db && npm run verify:emailengine-launch:greenmail",
    );
    expect(readme).toContain("npm run verify:emailengine-launch:offline");
    expect(readme).toContain("npm run verify:emailengine-launch:live");
    expect(readme).toContain("npm run verify:emailengine-launch:greenmail");
    expect(readme).toContain("npm run verify:emailengine-launch:docker-health");
    expect(readme).toContain("npm run verify:emailengine-launch:strict-db");
    expect(readme).toContain("npm run verify:emailengine-launch:core");
    expect(readme).toContain("npm run compose:up");
    expect(readme).toContain("npm run compose:up:prod");
    expect(readme).toContain("EMAILHUB_ENV_FILE=/path/to/env");
    expect(readme).toContain("EMAILHUB_API_BASE_URL");
    expect(readme).toContain("EMAILHUB_WEB_BASE_URL");
    expect(readme).toContain("EMAILHUB_DOCKER_HEALTH_TIMEOUT_MS");
  });

  it("keeps the web Dockerfile compatible with npm workspaces", async () => {
    const dockerfile = await readProjectFile("apps", "web", "Dockerfile");

    expect(dockerfile).toContain("COPY package.json package-lock.json ./");
    expect(dockerfile).toContain(
      "COPY apps/api-node/package.json apps/api-node/package.json",
    );
    expect(dockerfile).toContain(
      "COPY apps/worker-node/package.json apps/worker-node/package.json",
    );
    expect(dockerfile).toContain(
      "COPY apps/web/package.json apps/web/package.json",
    );
    expect(dockerfile).toContain("RUN npm ci");
  });
});

function serviceSection(compose: string, serviceName: string): string {
  const match = compose.match(
    new RegExp(
      `\\n  ${serviceName}:\\n([\\s\\S]*?)(?=\\n  [a-z0-9-]+:\\n|\\nvolumes:|$)`,
    ),
  );

  if (!match) {
    throw new Error(`compose service not found: ${serviceName}`);
  }

  return match[0];
}
