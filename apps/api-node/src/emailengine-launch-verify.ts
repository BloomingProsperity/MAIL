import {
  normalizeApiBaseUrl,
  verifyEmailEngineLaunch,
} from "./mail-engine/launch-verifier.js";

const apiBaseUrl =
  process.env.EMAILHUB_API_BASE_URL ?? "http://127.0.0.1:8080";
const timeoutMs = readPositiveInteger(
  process.env.EMAILHUB_LAUNCH_VERIFY_TIMEOUT_MS,
  10_000,
);

try {
  const result = await verifyEmailEngineLaunch({ apiBaseUrl, timeoutMs });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(
    JSON.stringify(
      {
        ok: false,
        gate: "emailengine_launch",
        apiBaseUrl: normalizeApiBaseUrl(apiBaseUrl),
        error: message,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
