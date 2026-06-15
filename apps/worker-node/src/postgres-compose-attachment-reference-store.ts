import type { Queryable } from "./postgres-sync-job-queue.js";

export interface ComposeAttachmentReferenceStore {
  listActiveStorageKeys(): Promise<string[]>;
}

interface StorageKeyRow extends Record<string, unknown> {
  storage_key: string | null;
}

export function createPostgresComposeAttachmentReferenceStore(
  client: Queryable,
): ComposeAttachmentReferenceStore {
  return {
    async listActiveStorageKeys() {
      const result = await client.query<StorageKeyRow>(
        `
          SELECT DISTINCT attachment->>'storageKey' AS storage_key
          FROM email_drafts
          CROSS JOIN LATERAL jsonb_array_elements(attachment_manifest) AS attachment
          WHERE status IN ('draft', 'scheduled', 'queued', 'sending', 'failed')
            AND attachment->>'source' = 'uploaded_file'
            AND attachment ? 'storageKey'
            AND length(trim(attachment->>'storageKey')) > 0
        `,
      );

      return result.rows
        .map((row) => textValue(row.storage_key))
        .filter((value): value is string => Boolean(value));
    },
  };
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().toLowerCase()
    : undefined;
}
