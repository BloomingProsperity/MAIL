import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..", "..", "..");

async function readProjectFile(...parts: string[]): Promise<string> {
  return readFile(join(repoRoot, ...parts), "utf8");
}

describe("EmailEngine Docker configuration", () => {
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

    expect(envExample).toContain("EMAILENGINE_ACCESS_TOKEN=");
    expect(envExample).toContain("EENGINE_PREPARED_TOKEN=");
    expect(compose).toContain(
      "EENGINE_PREPARED_TOKEN: ${EENGINE_PREPARED_TOKEN:-}",
    );
    expect(
      compose.match(
        /EMAILENGINE_ACCESS_TOKEN: \$\{EMAILENGINE_ACCESS_TOKEN:-\}/g,
      ),
    ).toHaveLength(2);
  });

  it("pre-configures EmailEngine webhooks to call the API container in self-hosted Docker", async () => {
    const envExample = await readProjectFile(".env.example");
    const compose = await readProjectFile("infra", "docker-compose.yml");
    const emailEngine = serviceSection(compose, "emailengine");

    expect(envExample).toContain(
      "EMAILENGINE_WEBHOOK_URL=http://api:8080/api/webhooks/emailengine",
    );
    expect(emailEngine).toContain("EENGINE_SETTINGS:");
    expect(emailEngine).toContain(
      '"webhooks":"${EMAILENGINE_WEBHOOK_URL:-http://api:8080/api/webhooks/emailengine}"',
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
    expect(apiPackage.scripts["smoke:emailengine-real-webhook"]).toBe(
      "tsx src/emailengine-real-webhook-smoke.ts",
    );
    expect(envExample).toContain("EMAILHUB_SMOKE_DELIVERY_SMTP_HOST=127.0.0.1");
    expect(envExample).toContain("EMAILHUB_SMOKE_DELIVERY_SMTP_PORT=3025");
    expect(envExample).toContain("EMAILHUB_SMOKE_DELIVERY_SMTP_SECURE=false");
  });
});

function serviceSection(compose: string, serviceName: string): string {
  const match = compose.match(
    new RegExp(`\\n  ${serviceName}:\\n([\\s\\S]*?)(?=\\n  [a-z0-9-]+:\\n|\\nvolumes:)`),
  );

  if (!match) {
    throw new Error(`compose service not found: ${serviceName}`);
  }

  return match[0];
}
