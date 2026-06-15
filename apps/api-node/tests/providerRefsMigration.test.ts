import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function readMigrationFile(fileName: string): Promise<string> {
  const migrationUrl = new URL(
    `../../../infra/migrations/${fileName}`,
    import.meta.url,
  );

  return readFile(migrationUrl, "utf8");
}

async function readMigration(): Promise<string> {
  return readMigrationFile("0003_provider_refs.sql");
}

describe("provider refs migration", () => {
  it("creates provider message refs with provider-specific uniqueness", async () => {
    const sql = await readMigration();

    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS provider_message_refs/i);
    expect(sql).toMatch(/gmail_message_id TEXT/i);
    expect(sql).toMatch(/gmail_thread_id TEXT/i);
    expect(sql).toMatch(/gmail_history_id TEXT/i);
    expect(sql).toMatch(/graph_message_id TEXT/i);
    expect(sql).toMatch(/graph_change_key TEXT/i);
    expect(sql).toMatch(/graph_conversation_id TEXT/i);
    expect(sql).toMatch(/imap_mailbox_id TEXT/i);
    expect(sql).toMatch(/imap_uidvalidity TEXT/i);
    expect(sql).toMatch(/imap_uid TEXT/i);
    expect(sql).toMatch(/imap_modseq TEXT/i);
    expect(sql).toMatch(
      /UNIQUE \(account_id, provider, gmail_message_id\)/i,
    );
    expect(sql).toMatch(
      /UNIQUE \(account_id, provider, provider_message_id\)/i,
    );
    expect(sql).toMatch(
      /UNIQUE \(account_id, provider, graph_message_id\)/i,
    );
    expect(sql).toMatch(
      /UNIQUE \(account_id, provider, imap_mailbox_id, imap_uidvalidity, imap_uid\)/i,
    );
  });

  it("creates provider tombstones and mailbox refs", async () => {
    const sql = await readMigration();

    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS provider_message_tombstones/i);
    expect(sql).toMatch(/provider_identity JSONB NOT NULL/i);
    expect(sql).toMatch(/deleted_at TIMESTAMPTZ NOT NULL/i);
    expect(sql).toMatch(/idempotency_key TEXT NOT NULL UNIQUE/i);

    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS provider_mailbox_refs/i);
    expect(sql).toMatch(/gmail_label_id TEXT/i);
    expect(sql).toMatch(/graph_folder_id TEXT/i);
    expect(sql).toMatch(/imap_path TEXT/i);
    expect(sql).toMatch(/imap_uidvalidity TEXT/i);
    expect(sql).toMatch(/imap_uid_next TEXT/i);
    expect(sql).toMatch(/imap_highest_modseq TEXT/i);
  });

  it("adds typed mailbox cursor fields for native sync", async () => {
    const sql = await readMigration();

    expect(sql).toMatch(/ALTER TABLE sync_cursors/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS mailbox_id UUID/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS cursor_scope TEXT/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS provider_mailbox_id TEXT/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS gmail_history_id TEXT/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS graph_delta_link TEXT/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS imap_uidvalidity TEXT/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS imap_highest_uid TEXT/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS imap_uid_next TEXT/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS imap_highest_modseq TEXT/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS reset_reason TEXT/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ/i);
  });

  it("adds typed EmailEngine stable identity fields for mirror dedupe", async () => {
    const sql = await readMigrationFile(
      "0007_emailengine_provider_ref_identity.sql",
    );

    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS emailengine_email_id TEXT/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS internet_message_id TEXT/i);
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS provider_message_refs_emailengine_email_id_uidx/i,
    );
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS provider_message_refs_internet_message_id_idx/i,
    );
  });

  it("adds provider message id aliases for EmailEngine move races", async () => {
    const sql = await readMigrationFile(
      "0026_provider_message_id_aliases.sql",
    );

    expect(sql).toMatch(
      /ADD COLUMN IF NOT EXISTS provider_message_id_aliases JSONB NOT NULL DEFAULT '\[\]'::jsonb/i,
    );
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS provider_message_refs_id_aliases_gin_idx/i,
    );
    expect(sql).toMatch(/USING GIN \(provider_message_id_aliases\)/i);
  });
});
