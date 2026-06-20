import type { Queryable } from "./postgres-mirror-store.js";

export async function replaceAuthoritativeMessageLocations(
  client: Queryable,
  accountId: string,
  messageId: string,
  mailboxPaths: string[],
): Promise<void> {
  if (mailboxPaths.length === 0) {
    return;
  }

  await client.query(
    `
      DELETE FROM message_locations
      USING mailboxes
      WHERE message_locations.message_id = $1
        AND mailboxes.id = message_locations.mailbox_id
        AND mailboxes.account_id = $2
        AND NOT (mailboxes.provider_mailbox_id = ANY($3::text[]))
    `,
    [messageId, accountId, mailboxPaths],
  );
}
