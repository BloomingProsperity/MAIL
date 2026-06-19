CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Older sync paths could persist messages before their folder locations were
-- attached. Keep the read model recoverable by rebuilding locations from
-- provider refs first, then falling back to the account inbox for visible mail.

WITH provider_paths AS (
  SELECT DISTINCT
    provider_message_refs.message_id,
    provider_message_refs.account_id,
    btrim(candidate_path.value) AS provider_mailbox_id
  FROM provider_message_refs
  CROSS JOIN LATERAL (
    VALUES
      (provider_message_refs.raw_ref->>'path'),
      (provider_message_refs.raw_ref->>'mailbox'),
      (provider_message_refs.raw_ref->>'mailboxPath'),
      (provider_message_refs.raw_ref#>>'{identity,path}'),
      (provider_message_refs.raw_ref#>>'{mailbox,path}'),
      (provider_message_refs.imap_mailbox_id)
  ) AS candidate_path(value)
  WHERE provider_message_refs.message_id IS NOT NULL
    AND candidate_path.value IS NOT NULL
    AND btrim(candidate_path.value) <> ''
),
gmail_label_paths AS (
  SELECT DISTINCT
    provider_message_refs.message_id,
    provider_message_refs.account_id,
    btrim(gmail_label.label_id) AS provider_mailbox_id
  FROM provider_message_refs
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(provider_message_refs.raw_ref->'labelIds') = 'array'
        THEN provider_message_refs.raw_ref->'labelIds'
      ELSE '[]'::jsonb
    END
  ) AS gmail_label(label_id)
  WHERE provider_message_refs.message_id IS NOT NULL
    AND btrim(gmail_label.label_id) <> ''
),
provider_location_candidates AS (
  SELECT * FROM provider_paths
  UNION
  SELECT * FROM gmail_label_paths
)
INSERT INTO message_locations (message_id, mailbox_id)
SELECT
  provider_location_candidates.message_id,
  mailboxes.id
FROM provider_location_candidates
JOIN mailboxes
  ON mailboxes.account_id = provider_location_candidates.account_id
 AND mailboxes.provider_mailbox_id =
    provider_location_candidates.provider_mailbox_id
ON CONFLICT (message_id, mailbox_id) DO NOTHING;

INSERT INTO mailboxes (id, account_id, provider_mailbox_id, name, role)
SELECT
  gen_random_uuid(),
  messages.account_id,
  'INBOX',
  'INBOX',
  'inbox'
FROM messages
JOIN message_state
  ON message_state.message_id = messages.id
WHERE message_state.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM mailboxes
    WHERE mailboxes.account_id = messages.account_id
      AND mailboxes.role = 'inbox'
  )
GROUP BY messages.account_id
ON CONFLICT (account_id, provider_mailbox_id) DO NOTHING;

INSERT INTO message_locations (message_id, mailbox_id)
SELECT
  messages.id,
  inbox_mailboxes.id
FROM messages
JOIN message_state
  ON message_state.message_id = messages.id
JOIN mailboxes AS inbox_mailboxes
  ON inbox_mailboxes.account_id = messages.account_id
 AND inbox_mailboxes.role = 'inbox'
WHERE message_state.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM message_locations
    WHERE message_locations.message_id = messages.id
  )
ON CONFLICT (message_id, mailbox_id) DO NOTHING;
