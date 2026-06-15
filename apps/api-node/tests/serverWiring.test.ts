import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("server wiring", () => {
  it("binds follow-up reminders to the Postgres store when DATABASE_URL is configured", async () => {
    const serverUrl = new URL("../src/server.ts", import.meta.url);
    const source = await readFile(serverUrl, "utf8");

    expect(source).toMatch(/createFollowUpService/);
    expect(source).toMatch(/createPostgresFollowUpStore/);
    expect(source).toMatch(/config\.followUpService\s*=/);
    expect(source).toMatch(/createHermesFollowUpReminderService/);
    expect(source).toMatch(/config\.hermesFollowUpReminderService\s*=/);
  });

  it("wires explicit translation preference learning into Hermes memory", async () => {
    const serverUrl = new URL("../src/server.ts", import.meta.url);
    const source = await readFile(serverUrl, "utf8");

    expect(source).toMatch(/createHermesTranslationPreferenceService/);
    expect(source).toMatch(/config\.hermesTranslationPreferenceService\s*=/);
    expect(source).toMatch(/memoryStore:\s*config\.hermesMemoryStore/);
  });

  it("injects Hermes draft feedback learning into mail compose", async () => {
    const serverUrl = new URL("../src/server.ts", import.meta.url);
    const source = await readFile(serverUrl, "utf8");

    expect(source).toMatch(/createPostgresHermesDraftFeedbackStore/);
    expect(source).toMatch(/config\.hermesDraftFeedbackStore\s*=/);
    expect(source).toMatch(
      /hermesDraftFeedbackStore:\s*config\.hermesDraftFeedbackStore/,
    );
  });

  it("wires native send transport into API compose for immediate sends", async () => {
    const serverUrl = new URL("../src/server.ts", import.meta.url);
    const source = await readFile(serverUrl, "utf8");

    expect(source).toMatch(/createConfiguredNativeSendTransport/);
    expect(source).toMatch(/native:\s*createConfiguredNativeSendTransport/);
    expect(source).toMatch(/client:\s*pool/);
    expect(source).toMatch(/createId:\s*randomUUID/);
  });

  it("injects the structured logger into the API handler", async () => {
    const serverUrl = new URL("../src/server.ts", import.meta.url);
    const source = await readFile(serverUrl, "utf8");

    expect(source).toMatch(/createJsonLogger/);
    expect(source).toMatch(/service:\s*"email-hub-api"/);
    expect(source).toMatch(/config\.logger\s*=\s*logger/);
  });

  it("wires the diagnostics log buffer into the API handler", async () => {
    const serverUrl = new URL("../src/server.ts", import.meta.url);
    const source = await readFile(serverUrl, "utf8");

    expect(source).toMatch(/createInMemoryDiagnosticsLogStore/);
    expect(source).toMatch(/diagnosticsLogStore/);
    expect(source).toMatch(/config\.diagnosticsLogStore\s*=\s*diagnosticsLogStore/);
  });

  it("wires durable operational event diagnostics into the API handler", async () => {
    const serverUrl = new URL("../src/server.ts", import.meta.url);
    const source = await readFile(serverUrl, "utf8");

    expect(source).toMatch(/createOperationalEventLogService/);
    expect(source).toMatch(/createPostgresOperationalEventStore/);
    expect(source).toMatch(/config\.operationalEventLogService\s*=/);
  });

  it("passes Proton Bridge preset overrides into onboarding, import, and reauthorization services", async () => {
    const serverUrl = new URL("../src/server.ts", import.meta.url);
    const source = await readFile(serverUrl, "utf8");

    expect(source).toMatch(/readImapSmtpProviderPresetOverrides/);
    expect(source).toMatch(/const providerPresetOverrides/);
    expect(source.match(/providerPresetOverrides/g)?.length).toBeGreaterThanOrEqual(
      4,
    );
  });

  it("binds Gatekeeper sender screening routes to the Postgres store", async () => {
    const serverUrl = new URL("../src/server.ts", import.meta.url);
    const source = await readFile(serverUrl, "utf8");

    expect(source).toMatch(/createPostgresSenderScreeningStore/);
    expect(source).toMatch(/config\.senderScreeningStore\s*=/);
    expect(source).toMatch(/createId:\s*randomUUID/);
  });

  it("binds Gatekeeper account mode settings to the Postgres store", async () => {
    const serverUrl = new URL("../src/server.ts", import.meta.url);
    const source = await readFile(serverUrl, "utf8");

    expect(source).toMatch(/createGatekeeperSettingsService/);
    expect(source).toMatch(/createPostgresGatekeeperSettingsStore/);
    expect(source).toMatch(/config\.gatekeeperSettingsService\s*=/);
  });

  it("binds Hermes audit log queries to the Postgres run store", async () => {
    const serverUrl = new URL("../src/server.ts", import.meta.url);
    const source = await readFile(serverUrl, "utf8");

    expect(source).toMatch(/createHermesAuditLogService/);
    expect(source).toMatch(/createPostgresHermesAuditLogStore/);
    expect(source).toMatch(/config\.hermesAuditLogService\s*=/);
  });

  it("wires configurable Hermes update checks into runtime settings", async () => {
    const serverUrl = new URL("../src/server.ts", import.meta.url);
    const source = await readFile(serverUrl, "utf8");

    expect(source).toMatch(/createHermesHttpVersionChecker/);
    expect(source).toMatch(/HERMES_VERSION_CHECK_URL/);
    expect(source).toMatch(/versionChecker:\s*createHermesHttpVersionChecker/);
  });

  it("registers graceful shutdown for the HTTP server and Postgres pool", async () => {
    const serverUrl = new URL("../src/server.ts", import.meta.url);
    const source = await readFile(serverUrl, "utf8");

    expect(source).toMatch(/createRuntimeShutdownHandler/);
    expect(source).toMatch(/process\.once\("SIGTERM"/);
    expect(source).toMatch(/process\.once\("SIGINT"/);
    expect(source).toMatch(/closeHttpServer/);
    expect(source).toMatch(/pool\.end\(\)/);
  });
});
