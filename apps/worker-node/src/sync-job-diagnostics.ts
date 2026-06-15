import { pathToFileURL } from "node:url";
import { Pool } from "pg";

import type { Queryable } from "./postgres-sync-job-queue.js";

export interface SyncJobDiagnosticsTotals {
  totalJobs: number;
  queuedJobs: number;
  dueQueuedJobs: number;
  scheduledQueuedJobs: number;
  runningJobs: number;
  activeRunningJobs: number;
  expiredRunningJobs: number;
  doneJobs: number;
  failedJobs: number;
  deadLetterJobs: number;
}

export interface SyncJobDiagnosticsTimestamps {
  oldestQueuedAt?: string;
  oldestDueAt?: string;
  nextScheduledAt?: string;
}

export interface SyncJobAccountDiagnostics {
  accountId: string;
  queuedJobs: number;
  dueQueuedJobs: number;
  runningJobs: number;
  expiredRunningJobs: number;
  deadLetterJobs: number;
  oldestQueuedAt?: string;
}

export interface SyncJobDiagnosticsResult {
  service: "email-hub-worker";
  ok: boolean;
  checkedAt: string;
  totals: SyncJobDiagnosticsTotals;
  timestamps: SyncJobDiagnosticsTimestamps;
  warnings: string[];
  topAccounts: SyncJobAccountDiagnostics[];
}

export interface CollectSyncJobDiagnosticsInput {
  client: Queryable;
  now?: Date;
  topAccountLimit?: number;
}

interface SummaryRow extends Record<string, unknown> {
  total_jobs?: unknown;
  queued_jobs?: unknown;
  due_queued_jobs?: unknown;
  scheduled_queued_jobs?: unknown;
  running_jobs?: unknown;
  active_running_jobs?: unknown;
  expired_running_jobs?: unknown;
  done_jobs?: unknown;
  failed_jobs?: unknown;
  dead_letter_jobs?: unknown;
  oldest_queued_at?: unknown;
  oldest_due_at?: unknown;
  next_scheduled_at?: unknown;
}

interface AccountRow extends Record<string, unknown> {
  account_id?: unknown;
  queued_jobs?: unknown;
  due_queued_jobs?: unknown;
  running_jobs?: unknown;
  expired_running_jobs?: unknown;
  dead_letter_jobs?: unknown;
  oldest_queued_at?: unknown;
}

export async function collectSyncJobDiagnostics(
  input: CollectSyncJobDiagnosticsInput,
): Promise<SyncJobDiagnosticsResult> {
  const now = input.now ?? new Date();
  const checkedAt = now.toISOString();
  const topAccountLimit = normalizeTopAccountLimit(input.topAccountLimit);
  const summary = await input.client.query<SummaryRow>(
    `
      SELECT
        COUNT(*) AS total_jobs,
        COUNT(*) FILTER (WHERE status = 'queued') AS queued_jobs,
        COUNT(*) FILTER (
          WHERE status = 'queued'
            AND not_before <= $1::timestamptz
        ) AS due_queued_jobs,
        COUNT(*) FILTER (
          WHERE status = 'queued'
            AND not_before > $1::timestamptz
        ) AS scheduled_queued_jobs,
        COUNT(*) FILTER (WHERE status = 'running') AS running_jobs,
        COUNT(*) FILTER (
          WHERE status = 'running'
            AND lease_expires_at > $1::timestamptz
        ) AS active_running_jobs,
        COUNT(*) FILTER (
          WHERE status = 'running'
            AND lease_expires_at <= $1::timestamptz
        ) AS expired_running_jobs,
        COUNT(*) FILTER (WHERE status = 'done') AS done_jobs,
        COUNT(*) FILTER (WHERE status = 'failed') AS failed_jobs,
        COUNT(*) FILTER (WHERE status = 'dead_letter') AS dead_letter_jobs,
        MIN(not_before) FILTER (WHERE status = 'queued') AS oldest_queued_at,
        MIN(not_before) FILTER (
          WHERE status = 'queued'
            AND not_before <= $1::timestamptz
        ) AS oldest_due_at,
        MIN(not_before) FILTER (
          WHERE status = 'queued'
            AND not_before > $1::timestamptz
        ) AS next_scheduled_at
      FROM sync_jobs
    `,
    [checkedAt],
  );
  const accountRows = await input.client.query<AccountRow>(
    `
      SELECT
        COALESCE(account_id, 'unassigned') AS account_id,
        COUNT(*) FILTER (WHERE status = 'queued') AS queued_jobs,
        COUNT(*) FILTER (
          WHERE status = 'queued'
            AND not_before <= $1::timestamptz
        ) AS due_queued_jobs,
        COUNT(*) FILTER (WHERE status = 'running') AS running_jobs,
        COUNT(*) FILTER (
          WHERE status = 'running'
            AND lease_expires_at <= $1::timestamptz
        ) AS expired_running_jobs,
        COUNT(*) FILTER (WHERE status = 'dead_letter') AS dead_letter_jobs,
        MIN(not_before) FILTER (WHERE status = 'queued') AS oldest_queued_at
      FROM sync_jobs
      WHERE status IN ('queued', 'running', 'dead_letter')
      GROUP BY COALESCE(account_id, 'unassigned')
      ORDER BY
        COUNT(*) FILTER (
          WHERE status = 'queued'
            AND not_before <= $1::timestamptz
        ) DESC,
        COUNT(*) FILTER (WHERE status = 'queued') DESC,
        COUNT(*) FILTER (WHERE status = 'dead_letter') DESC,
        COALESCE(account_id, 'unassigned') ASC
      LIMIT $2
    `,
    [checkedAt, topAccountLimit],
  );
  const totals = summaryRowToTotals(summary.rows[0]);
  const warnings = warningsForTotals(totals);

  return {
    service: "email-hub-worker",
    ok: warnings.length === 0,
    checkedAt,
    totals,
    timestamps: summaryRowToTimestamps(summary.rows[0]),
    warnings,
    topAccounts: accountRows.rows.map(accountRowToDiagnostics),
  };
}

export function formatSyncJobDiagnosticsForLog(
  result: SyncJobDiagnosticsResult,
): string {
  return [
    `service=${result.service}`,
    `ok=${String(result.ok)}`,
    `queued=${result.totals.queuedJobs}`,
    `due=${result.totals.dueQueuedJobs}`,
    `running=${result.totals.runningJobs}`,
    `expired=${result.totals.expiredRunningJobs}`,
    `deadLetter=${result.totals.deadLetterJobs}`,
    `warnings=${result.warnings.join(",") || "none"}`,
  ].join(" ");
}

function summaryRowToTotals(row?: SummaryRow): SyncJobDiagnosticsTotals {
  return {
    totalJobs: readCount(row?.total_jobs),
    queuedJobs: readCount(row?.queued_jobs),
    dueQueuedJobs: readCount(row?.due_queued_jobs),
    scheduledQueuedJobs: readCount(row?.scheduled_queued_jobs),
    runningJobs: readCount(row?.running_jobs),
    activeRunningJobs: readCount(row?.active_running_jobs),
    expiredRunningJobs: readCount(row?.expired_running_jobs),
    doneJobs: readCount(row?.done_jobs),
    failedJobs: readCount(row?.failed_jobs),
    deadLetterJobs: readCount(row?.dead_letter_jobs),
  };
}

function summaryRowToTimestamps(row?: SummaryRow): SyncJobDiagnosticsTimestamps {
  return {
    ...readTimestamp("oldestQueuedAt", row?.oldest_queued_at),
    ...readTimestamp("oldestDueAt", row?.oldest_due_at),
    ...readTimestamp("nextScheduledAt", row?.next_scheduled_at),
  };
}

function accountRowToDiagnostics(row: AccountRow): SyncJobAccountDiagnostics {
  return {
    accountId:
      typeof row.account_id === "string" && row.account_id.length > 0
        ? row.account_id
        : "unassigned",
    queuedJobs: readCount(row.queued_jobs),
    dueQueuedJobs: readCount(row.due_queued_jobs),
    runningJobs: readCount(row.running_jobs),
    expiredRunningJobs: readCount(row.expired_running_jobs),
    deadLetterJobs: readCount(row.dead_letter_jobs),
    ...readTimestamp("oldestQueuedAt", row.oldest_queued_at),
  };
}

function warningsForTotals(totals: SyncJobDiagnosticsTotals): string[] {
  return [
    ...(totals.expiredRunningJobs > 0 ? ["expired_running_jobs"] : []),
    ...(totals.deadLetterJobs > 0 ? ["dead_letter_jobs"] : []),
    ...(totals.failedJobs > 0 ? ["failed_jobs"] : []),
  ];
}

function readCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function readTimestamp<K extends string>(
  key: K,
  value: unknown,
): Partial<Record<K, string>> {
  if (value instanceof Date) {
    return { [key]: value.toISOString() } as Partial<Record<K, string>>;
  }

  if (typeof value === "string" && value.length > 0) {
    return { [key]: value } as Partial<Record<K, string>>;
  }

  return {};
}

function normalizeTopAccountLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 10;
  }

  return Math.max(1, Math.min(100, Math.floor(value)));
}

function readNumberArg(name: string): number | undefined {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix));
  if (!raw) {
    return undefined;
  }

  const parsed = Number(raw.slice(prefix.length));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isMainModule(): boolean {
  return process.argv[1]
    ? import.meta.url === pathToFileURL(process.argv[1]).href
    : false;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    process.stdout.write(
      `${JSON.stringify({
        service: "email-hub-worker",
        ok: false,
        missing: ["DATABASE_URL"],
      })}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const result = await collectSyncJobDiagnostics({
      client: pool,
      topAccountLimit: readNumberArg("top-accounts"),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await pool.end();
  }
}

if (isMainModule()) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`sync job diagnostics failed: ${message}\n`);
    process.exitCode = 1;
  });
}
