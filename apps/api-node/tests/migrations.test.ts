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
  return readMigrationFile("0002_mail_engine_runtime.sql");
}

describe("mail engine runtime migration", () => {
  it("adds durable event, job, cursor, credential, and command tables", async () => {
    const sql = await readMigration();

    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS account_credentials/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS account_provider_settings/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS sync_cursors/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS sync_runs/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS mail_engine_events/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS sync_jobs/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS engine_commands/i);
  });

  it("keeps webhook events and engine commands idempotent", async () => {
    const sql = await readMigration();

    expect(sql).toMatch(/idempotency_key TEXT NOT NULL UNIQUE/i);
    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS sync_jobs[\s\S]*idempotency_key TEXT NOT NULL UNIQUE/i,
    );
    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS sync_jobs[\s\S]*lease_owner TEXT/i,
    );
    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS sync_jobs[\s\S]*lease_expires_at TIMESTAMPTZ/i,
    );
    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS sync_jobs[\s\S]*completed_at TIMESTAMPTZ/i,
    );
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS sync_jobs_status_not_before_idx/i,
    );
    expect(sql).toMatch(
      /UNIQUE \(account_id, provider, mailbox_key, cursor_type\)/i,
    );
    expect(sql).toMatch(/pg_constraint/i);
    expect(sql).toMatch(/sync_runs_job_id_fkey/i);
  });

  it("adds lease and retry scheduling columns for engine command workers", async () => {
    const sql = await readMigrationFile("0015_engine_command_leases.sql");

    expect(sql).toMatch(/ALTER TABLE engine_commands/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS not_before TIMESTAMPTZ/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS lease_owner TEXT/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ/i);
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS engine_commands_status_not_before_idx/i,
    );
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS engine_commands_account_status_idx/i,
    );
  });

  it("adds searchable EmailEngine resource identity columns", async () => {
    const sql = await readMigrationFile(
      "0006_mail_engine_resource_identity.sql",
    );

    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS resource_key TEXT/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS provider_email_id TEXT/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS rfc_message_id TEXT/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS provider_uid TEXT/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS provider_path TEXT/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS resource_identity JSONB/i);
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS mail_engine_events_resource_key_idx/i,
    );
  });

  it("adds read-path indexes for cursor pagination and basic search", async () => {
    const sql = await readMigrationFile("0008_mail_read_indexes.sql");

    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS messages_account_received_id_idx/i,
    );
    expect(sql).toMatch(
      /ON messages \(account_id, received_at DESC, id DESC\)/i,
    );
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS message_locations_mailbox_message_idx/i,
    );
    expect(sql).toMatch(/ON message_locations \(mailbox_id, message_id\)/i);
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS messages_from_email_trgm_idx/i,
    );
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS messages_from_name_trgm_idx/i,
    );
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS messages_snippet_trgm_idx/i);
  });

  it("adds attachment metadata columns for EmailEngine inline files", async () => {
    const sql = await readMigrationFile("0009_attachment_metadata.sql");

    expect(sql).toMatch(/ALTER TABLE attachments/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS content_id TEXT/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS embedded BOOLEAN/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS inline BOOLEAN/i);
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS attachments_message_id_idx/i,
    );
  });

  it("adds Smart Inbox sender feedback rules", async () => {
    const sql = await readMigrationFile("0011_smart_inbox_feedback_rules.sql");

    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS smart_inbox_sender_rules/i);
    expect(sql).toMatch(/account_id UUID NOT NULL REFERENCES connected_accounts/i);
    expect(sql).toMatch(/sender_email TEXT NOT NULL/i);
    expect(sql).toMatch(/rule_type TEXT NOT NULL/i);
    expect(sql).toMatch(/UNIQUE \(account_id, sender_email, rule_type\)/i);
  });

  it("adds Hermes memory read indexes", async () => {
    const sql = await readMigrationFile("0012_hermes_memory_indexes.sql");

    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS hermes_memories_layer_scope_updated_idx/i,
    );
    expect(sql).toMatch(
      /ON hermes_memories \(layer, scope, updated_at DESC, id DESC\)/i,
    );
  });

  it("adds Hermes feedback lookup indexes", async () => {
    const sql = await readMigrationFile("0013_hermes_feedback_indexes.sql");

    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS hermes_feedback_skill_run_created_idx/i,
    );
    expect(sql).toMatch(
      /ON hermes_feedback \(skill_run_id, created_at DESC, id DESC\)/i,
    );
  });

  it("adds Hermes runtime settings for provider configuration and update state", async () => {
    const sql = await readMigrationFile("0030_hermes_runtime_settings.sql");

    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS hermes_runtime_settings/i);
    expect(sql).toMatch(/provider_key TEXT NOT NULL DEFAULT 'custom'/i);
    expect(sql).toMatch(/endpoint_url TEXT/i);
    expect(sql).toMatch(/model TEXT NOT NULL/i);
    expect(sql).toMatch(/api_key_secret_ref TEXT REFERENCES stored_secrets/i);
    expect(sql).toMatch(/update_policy TEXT NOT NULL/i);
    expect(sql).toMatch(/update_channel TEXT NOT NULL/i);
    expect(sql).toMatch(/installed_version TEXT/i);
    expect(sql).toMatch(/latest_version TEXT/i);
    expect(sql).toMatch(/last_checked_at TIMESTAMPTZ/i);
    expect(sql).toMatch(/CHECK \(id = 'default'\)/i);
    expect(sql).toMatch(/hermes_runtime_settings_provider_idx/i);
  });

  it("adds provider capability and saved view tables for mail navigation", async () => {
    const sql = await readMigrationFile("0031_provider_capabilities_saved_views.sql");

    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS provider_capabilities/i);
    expect(sql).toMatch(/provider TEXT PRIMARY KEY/i);
    expect(sql).toMatch(/supports_server_search BOOLEAN NOT NULL/i);
    expect(sql).toMatch(/supports_recall BOOLEAN NOT NULL/i);
    expect(sql).toMatch(/provider_specific_actions TEXT\[\] NOT NULL/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS saved_views/i);
    expect(sql).toMatch(/kind TEXT NOT NULL/i);
    expect(sql).toMatch(/keywords TEXT\[\] NOT NULL/i);
    expect(sql).toMatch(/match_config JSONB NOT NULL/i);
    expect(sql).toMatch(/saved_views_enabled_idx/i);
  });

  it("adds domain alias routing indexes and unique catch-all rules", async () => {
    const sql = await readMigrationFile("0016_domain_alias_indexes.sql");

    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS routing_rules_domain_catch_all_uidx/i,
    );
    expect(sql).toMatch(/ON routing_rules \(domain_id, rule_type\)/i);
    expect(sql).toMatch(/WHERE rule_type = 'catch_all'/i);
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS aliases_domain_enabled_idx/i,
    );
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS delivery_logs_domain_created_idx/i,
    );
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS alias_routes_destination_idx/i,
    );
  });

  it("adds durable alias delivery jobs for forwarding workers", async () => {
    const sql = await readMigrationFile("0017_alias_delivery_jobs.sql");

    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS alias_delivery_jobs/i);
    expect(sql).toMatch(/idempotency_key TEXT NOT NULL UNIQUE/i);
    expect(sql).toMatch(/status TEXT NOT NULL DEFAULT 'queued'/i);
    expect(sql).toMatch(/lease_owner TEXT/i);
    expect(sql).toMatch(/lease_expires_at TIMESTAMPTZ/i);
    expect(sql).toMatch(/message_fingerprint TEXT NOT NULL/i);
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS alias_delivery_jobs_status_not_before_idx/i,
    );
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS alias_delivery_jobs_domain_status_idx/i,
    );
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS alias_delivery_jobs_destination_status_idx/i,
    );
  });

  it("adds domain destination mappings for alias settings", async () => {
    const sql = await readMigrationFile("0022_domain_destinations.sql");

    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS domain_destinations/i);
    expect(sql).toMatch(/domain_id UUID NOT NULL REFERENCES domains/i);
    expect(sql).toMatch(/destination_id UUID NOT NULL REFERENCES destinations/i);
    expect(sql).toMatch(/PRIMARY KEY \(domain_id, destination_id\)/i);
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS domain_destinations_destination_idx/i,
    );
  });

  it("adds Gatekeeper sender screening rules and decision events", async () => {
    const sql = await readMigrationFile("0023_sender_screening.sql");

    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS sender_screening_rules/i);
    expect(sql).toMatch(/account_id UUID NOT NULL REFERENCES connected_accounts/i);
    expect(sql).toMatch(/scope TEXT NOT NULL/i);
    expect(sql).toMatch(/status TEXT NOT NULL DEFAULT 'unknown'/i);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS sender_screening_rules_email_uidx/i);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS sender_screening_rules_domain_uidx/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS sender_screening_events/i);
    expect(sql).toMatch(/action TEXT NOT NULL/i);
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS sender_screening_rules_account_status_idx/i,
    );
  });

  it("adds per-account Gatekeeper mode settings", async () => {
    const sql = await readMigrationFile("0027_gatekeeper_settings.sql");

    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS gatekeeper_settings/i);
    expect(sql).toMatch(/account_id UUID PRIMARY KEY REFERENCES connected_accounts/i);
    expect(sql).toMatch(/mode TEXT NOT NULL DEFAULT 'off_accept_all'/i);
    expect(sql).toMatch(/before_inbox/i);
    expect(sql).toMatch(/inside_email/i);
    expect(sql).toMatch(/off_accept_all/i);
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS gatekeeper_settings_mode_idx/i,
    );
  });

  it("adds Hermes rule learning columns and lookup indexes", async () => {
    const sql = await readMigrationFile("0018_hermes_rule_learning.sql");

    expect(sql).toMatch(/ALTER TABLE hermes_rule_candidates/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS account_id UUID/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS rule_type TEXT/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS evidence_message_ids UUID\[\]/i);
    expect(sql).toMatch(/ALTER TABLE hermes_rules/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS candidate_id UUID/i);
    expect(sql).toMatch(/ALTER TABLE hermes_rule_runs/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS candidate_id UUID/i);
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS hermes_rule_candidates_account_status_idx/i,
    );
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS hermes_rules_account_enabled_idx/i,
    );
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS hermes_rule_runs_candidate_mode_idx/i,
    );
  });

  it("adds Spark done undo state columns and lookup indexes", async () => {
    const sql = await readMigrationFile("0019_message_done_undo.sql");

    expect(sql).toMatch(/ALTER TABLE message_state/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS done_at TIMESTAMPTZ/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS last_action_token TEXT/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS undo_expires_at TIMESTAMPTZ/i);
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS message_state_done_at_idx/i,
    );
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS message_state_undo_token_idx/i,
    );
  });

  it("adds durable scheduled sends for send later and outbox", async () => {
    const sql = await readMigrationFile("0020_scheduled_sends.sql");

    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS scheduled_sends/i);
    expect(sql).toMatch(/draft_id UUID NOT NULL REFERENCES email_drafts/i);
    expect(sql).toMatch(/status TEXT NOT NULL DEFAULT 'scheduled'/i);
    expect(sql).toMatch(/attempts INTEGER NOT NULL DEFAULT 0/i);
    expect(sql).toMatch(/max_attempts INTEGER NOT NULL DEFAULT 5/i);
    expect(sql).toMatch(/not_before TIMESTAMPTZ NOT NULL/i);
    expect(sql).toMatch(/lease_owner TEXT/i);
    expect(sql).toMatch(/lease_expires_at TIMESTAMPTZ/i);
    expect(sql).toMatch(/idempotency_key TEXT NOT NULL UNIQUE/i);
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS scheduled_sends_draft_active_uidx/i,
    );
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS scheduled_sends_status_not_before_idx/i,
    );
  });

  it("adds plain draft send leases so crashed sends can be recovered", async () => {
    const sql = await readMigrationFile("0024_email_draft_send_leases.sql");

    expect(sql).toMatch(/ALTER TABLE email_drafts/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS send_lease_owner TEXT/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS send_lease_expires_at TIMESTAMPTZ/i);
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS email_drafts_send_lease_idx/i,
    );
  });

  it("stores the original Hermes reply draft text for later learning", async () => {
    const sql = await readMigrationFile(
      "0025_email_draft_hermes_feedback_origin.sql",
    );

    expect(sql).toMatch(/ALTER TABLE email_drafts/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS hermes_draft_text TEXT/i);
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS email_drafts_hermes_feedback_idx/i,
    );
  });

  it("adds durable follow-up reminders for Tasks and snooze workflows", async () => {
    const sql = await readMigrationFile("0021_follow_up_reminders.sql");

    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS follow_up_reminders/i);
    expect(sql).toMatch(/message_id UUID NOT NULL REFERENCES messages/i);
    expect(sql).toMatch(/kind TEXT NOT NULL DEFAULT 'manual'/i);
    expect(sql).toMatch(/status TEXT NOT NULL DEFAULT 'open'/i);
    expect(sql).toMatch(/due_at TIMESTAMPTZ NOT NULL/i);
    expect(sql).toMatch(/source TEXT NOT NULL DEFAULT 'manual'/i);
    expect(sql).toMatch(/hermes_skill_run_id UUID REFERENCES hermes_skill_runs/i);
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS follow_up_reminders_account_status_due_idx/i,
    );
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS follow_up_reminders_due_open_idx/i,
    );
  });

  it("adds durable attachment text extraction jobs for search indexing", async () => {
    const sql = await readMigrationFile("0032_attachment_text_extraction_jobs.sql");

    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS attachment_text_extraction_jobs/i);
    expect(sql).toMatch(/account_id UUID NOT NULL REFERENCES connected_accounts/i);
    expect(sql).toMatch(/message_id UUID NOT NULL REFERENCES messages/i);
    expect(sql).toMatch(/provider_attachment_id TEXT NOT NULL/i);
    expect(sql).toMatch(/status TEXT NOT NULL DEFAULT 'queued'/i);
    expect(sql).toMatch(/attempts INTEGER NOT NULL DEFAULT 0/i);
    expect(sql).toMatch(/lease_owner TEXT/i);
    expect(sql).toMatch(/lease_expires_at TIMESTAMPTZ/i);
    expect(sql).toMatch(/extracted_text TEXT/i);
    expect(sql).toMatch(/idempotency_key TEXT NOT NULL UNIQUE/i);
    expect(sql).toMatch(/completed_at TIMESTAMPTZ/i);
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS attachment_text_jobs_status_not_before_idx/i,
    );
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS attachment_text_jobs_account_status_idx/i,
    );
  });

  it("stores RFC reply header chains on mirrored messages", async () => {
    const sql = await readMigrationFile("0036_message_rfc_reply_headers.sql");

    expect(sql).toMatch(/ALTER TABLE messages/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS rfc_in_reply_to_message_id TEXT/i);
    expect(sql).toMatch(
      /ADD COLUMN IF NOT EXISTS rfc_references_message_ids TEXT\[\] NOT NULL DEFAULT '\{\}'/i,
    );
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS messages_rfc_in_reply_to_idx/i);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS messages_rfc_references_gin_idx/i);
    expect(sql).toMatch(/USING GIN \(rfc_references_message_ids\)/i);
  });

  it("stores draft attachment manifests for compose sends", async () => {
    const sql = await readMigrationFile("0037_email_draft_attachment_manifest.sql");

    expect(sql).toMatch(/ALTER TABLE email_drafts/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS attachment_manifest JSONB/i);
    expect(sql).toMatch(/DEFAULT '\[\]'::jsonb/i);
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS email_drafts_attachment_manifest_gin_idx/i,
    );
    expect(sql).toMatch(/USING GIN \(attachment_manifest\)/i);
  });

  it("adds provider-native send identity discovery cache", async () => {
    const sql = await readMigrationFile("0038_provider_send_identities.sql");

    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS provider_send_identities/i);
    expect(sql).toMatch(/account_id UUID NOT NULL REFERENCES connected_accounts/i);
    expect(sql).toMatch(/provider_identity_id TEXT NOT NULL/i);
    expect(sql).toMatch(/verification_state TEXT NOT NULL DEFAULT 'unverified'/i);
    expect(sql).toMatch(/enabled BOOLEAN NOT NULL DEFAULT TRUE/i);
    expect(sql).toMatch(/capabilities JSONB NOT NULL DEFAULT '\{\}'/i);
    expect(sql).toMatch(/UNIQUE \(account_id, provider, provider_identity_id\)/i);
    expect(sql).toMatch(/provider_send_identities_account_verified_idx/i);
    expect(sql).toMatch(/provider_send_identities_account_email_idx/i);
  });

  it("adds stable account id reservations for idempotent onboarding", async () => {
    const sql = await readMigrationFile("0039_account_onboarding_account_keys.sql");

    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS account_onboarding_account_keys/i);
    expect(sql).toMatch(/PRIMARY KEY \(email, provider\)/i);
    expect(sql).toMatch(/account_id UUID NOT NULL UNIQUE/i);
    expect(sql).toMatch(/FROM connected_accounts/i);
    expect(sql).toMatch(/ON CONFLICT \(email, provider\) DO NOTHING/i);
  });
});
