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

  it("wires Hermes email search to the production mail read store", async () => {
    const serverUrl = new URL("../src/server.ts", import.meta.url);
    const source = await readFile(serverUrl, "utf8");

    expect(source).toMatch(
      /createConfiguredHermesTranslationService\(\{[\s\S]*mailReadStore:\s*config\.mailReadStore,/,
    );
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

  it("keeps native send transport behind an explicit paused-engine flag", async () => {
    const serverUrl = new URL("../src/server.ts", import.meta.url);
    const source = await readFile(serverUrl, "utf8");

    expect(source).toMatch(/readNativeEngineEnabled/);
    expect(source).toMatch(
      /const nativeEngineEnabled = readNativeEngineEnabled\(process\.env\)/,
    );
    expect(source).toMatch(/createConfiguredNativeSendTransport/);
    expect(source).toMatch(
      /\.\.\.\(nativeEngineEnabled\s*\?\s*\{\s*native:\s*createConfiguredNativeSendTransport/s,
    );
    expect(source).toMatch(/client:\s*pool/);
    expect(source).toMatch(/createId:\s*randomUUID/);
  });

  it("wires provider threading metadata into API compose", async () => {
    const serverUrl = new URL("../src/server.ts", import.meta.url);
    const source = await readFile(serverUrl, "utf8");

    expect(source).toMatch(/createPostgresMailThreadingStore/);
    expect(source).toMatch(/threadingStore:\s*createPostgresMailThreadingStore/);
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

  it("passes the EmailEngine access token into the authenticated readiness probe", async () => {
    const serverUrl = new URL("../src/server.ts", import.meta.url);
    const source = await readFile(serverUrl, "utf8");

    expect(source).toMatch(/const emailEngineAccessToken = process\.env\.EMAILENGINE_ACCESS_TOKEN/);
    expect(source).toMatch(/createEmailEngineHealthProbe\(\{\s*baseUrl: config\.emailEngineUrl,\s*accessToken: emailEngineAccessToken,/s);
  });

  it("wires OAuth onboarding through EmailEngine accounts and auth server services", async () => {
    const serverUrl = new URL("../src/server.ts", import.meta.url);
    const source = await readFile(serverUrl, "utf8");

    expect(source).toMatch(/createConfiguredEmailEngineAuthServerService/);
    expect(source).toMatch(/config\.emailEngineAuthServerService\s*=/);
    expect(source).toMatch(/EMAILENGINE_GMAIL_OAUTH2_PROVIDER_ID/);
    expect(source).toMatch(/EMAILENGINE_OUTLOOK_OAUTH2_PROVIDER_ID/);
    expect(source).toMatch(/createOAuthOnboardingService\(\{[\s\S]*emailEngineAccounts,/);
  });

  it("reuses the OAuth onboarding store for Sync Center reauthorization callbacks", async () => {
    const serverUrl = new URL("../src/server.ts", import.meta.url);
    const source = await readFile(serverUrl, "utf8");

    expect(source).toMatch(
      /const oauthOnboardingStore = createPostgresOAuthOnboardingStore\(pool\)/,
    );
    expect(source).toMatch(/const oauthTokenClient = createOAuthTokenClient\(\)/);
    expect(source).toMatch(
      /const oauthProfileClient = createOAuthProfileClient\(\)/,
    );
    expect(source).toMatch(
      /createReauthorizationRecoveryService\(\{[\s\S]*oauthStore: oauthOnboardingStore,[\s\S]*tokenClient: oauthTokenClient,[\s\S]*profileClient: oauthProfileClient,/,
    );
    expect(source).toMatch(
      /createOAuthOnboardingService\(\{[\s\S]*store: oauthOnboardingStore,[\s\S]*tokenClient: oauthTokenClient,[\s\S]*profileClient: oauthProfileClient,/,
    );
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

  it("lets confirmed Hermes action plans learn procedural memory", async () => {
    const serverUrl = new URL("../src/server.ts", import.meta.url);
    const source = await readFile(serverUrl, "utf8");

    expect(source).toMatch(/createHermesActionPlanService/);
    expect(source).toMatch(/memoryStore:\s*config\.hermesMemoryStore/);
  });

  it("wires configurable Hermes update checks into runtime settings", async () => {
    const serverUrl = new URL("../src/server.ts", import.meta.url);
    const source = await readFile(serverUrl, "utf8");

    expect(source).toMatch(/createHermesHttpVersionChecker/);
    expect(source).toMatch(/HERMES_VERSION_CHECK_URL/);
    expect(source).toMatch(/versionChecker:\s*createHermesHttpVersionChecker/);
  });

  it("wires editable Hermes skill settings into API and workspace context", async () => {
    const serverUrl = new URL("../src/server.ts", import.meta.url);
    const source = await readFile(serverUrl, "utf8");

    expect(source).toMatch(/createHermesSkillSettingsService/);
    expect(source).toMatch(/createPostgresHermesSkillSettingsStore/);
    expect(source).toMatch(/config\.hermesSkillSettingsService\s*=/);
    expect(source).toMatch(/config\.hermesSkillSettingsService\?\.listSkills/);
  });

  it("wires compose attachment maintenance into self-hosted cleanup controls", async () => {
    const serverUrl = new URL("../src/server.ts", import.meta.url);
    const source = await readFile(serverUrl, "utf8");

    expect(source).toMatch(/createComposeAttachmentMaintenanceService/);
    expect(source).toMatch(/createPostgresComposeAttachmentReferenceStore/);
    expect(source).toMatch(/createLocalComposeAttachmentMaintenanceBlobStore/);
    expect(source).toMatch(/config\.composeAttachmentMaintenanceService\s*=/);
    expect(source).toMatch(/COMPOSE_ATTACHMENT_CLEANUP_RETENTION_HOURS/);
    expect(source).toMatch(/COMPOSE_ATTACHMENT_CLEANUP_LIMIT/);
  });

  it("wires Hermes retention maintenance into self-hosted cleanup controls", async () => {
    const serverUrl = new URL("../src/server.ts", import.meta.url);
    const source = await readFile(serverUrl, "utf8");

    expect(source).toMatch(/createHermesRetentionMaintenanceService/);
    expect(source).toMatch(/createPostgresHermesRetentionMaintenanceStore/);
    expect(source).toMatch(/actionPlanStore:\s*createPostgresHermesActionPlanStore/);
    expect(source).toMatch(/config\.hermesRetentionMaintenanceService\s*=/);
    expect(source).toMatch(/HERMES_RETENTION_DAYS/);
    expect(source).toMatch(/HERMES_RETENTION_CLEANUP_LIMIT/);
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
