import { runEmailEngineWebhookSmoke } from "./mail-engine/webhook-smoke.js";

const apiBaseUrl =
  process.env.EMAILHUB_API_BASE_URL ?? "http://127.0.0.1:8080";
const secret = process.env.EMAILENGINE_WEBHOOK_SECRET ?? "dev-emailhub-secret";
const accountId = process.env.EMAILHUB_SMOKE_ACCOUNT_ID;
const eventName = process.env.EMAILHUB_SMOKE_WEBHOOK_EVENT;

try {
  const result = await runEmailEngineWebhookSmoke({
    apiBaseUrl,
    secret,
    accountId,
    eventName,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        smoke: "emailengine_webhook",
        apiBaseUrl,
        accountId: result.accountId,
        eventId: result.eventId,
      },
      null,
      2,
    ),
  );
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(
    JSON.stringify(
      {
        ok: false,
        smoke: "emailengine_webhook",
        apiBaseUrl,
        error: message,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
