import type { OnboardingTask } from "./imap-smtp-onboarding.js";
import type { ReauthorizationTaskStore } from "./reauthorization-recovery.js";

interface Queryable {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
}

export function createPostgresReauthorizationTaskStore(
  client: Queryable,
): ReauthorizationTaskStore {
  return {
    async getTask(taskId) {
      const result = await client.query(
        `
          SELECT id, email, provider, auth_method, status, error_message, payload
          FROM onboarding_tasks
          WHERE id = $1
            AND status IN ('pending', 'failed')
            AND (
              payload ->> 'reauthRequired' = 'true'
              OR payload ->> 'source' IN ('csv_import', 'account_transfer_import')
            )
          LIMIT 1
        `,
        [taskId],
      );

      return result.rows[0] ? mapTask(result.rows[0]) : undefined;
    },

    async updateOAuthSession(input) {
      const result = await client.query(
        `
          UPDATE onboarding_tasks
          SET status = 'pending',
              error_message = NULL,
              payload = payload || $2::jsonb,
              updated_at = now()
          WHERE id = $1
            AND auth_method = 'oauth'
            AND status IN ('pending', 'failed')
            AND (
              payload ->> 'reauthRequired' = 'true'
              OR payload ->> 'source' IN ('csv_import', 'account_transfer_import')
            )
          RETURNING id, email, provider, auth_method, status, error_message, payload
        `,
        [input.taskId, compactObject(input.session)],
      );

      if (!result.rows[0]) {
        throw new Error("reauthorization task was not found");
      }

      return mapTask(result.rows[0]);
    },
  };
}

function mapTask(row: Record<string, unknown>): OnboardingTask {
  return {
    id: String(row.id),
    email: String(row.email),
    provider: String(row.provider),
    authMethod: row.auth_method === "oauth" ? "oauth" : "password",
    status: mapTaskStatus(row.status),
    errorMessage:
      typeof row.error_message === "string" ? row.error_message : undefined,
    payload: safePayload(row.payload),
  };
}

function mapTaskStatus(value: unknown): OnboardingTask["status"] {
  if (value === "completed" || value === "failed") {
    return value;
  }

  return "pending";
}

function safePayload(value: unknown): Record<string, unknown> {
  const payload = recordValue(value);
  return compactObject({
    source: readString(payload.source),
    reauthRequired: payload.reauthRequired === true ? true : undefined,
    transferVersion: readNumber(payload.transferVersion),
    displayName: readString(payload.displayName),
    loginHint: readString(payload.loginHint),
    providerPreset: readString(payload.providerPreset),
    username: readString(payload.username),
    labels: readStringArray(payload.labels),
    group: readString(payload.group),
    notes: readString(payload.notes),
    accountId: readString(payload.accountId),
    state: readString(payload.state),
    redirectUri: readString(payload.redirectUri),
  });
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const strings = value.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
  return strings.length > 0 ? strings : undefined;
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}
