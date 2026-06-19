import type { SyncCenterAccountDto } from "../../lib/emailHubApi";
import type { SyncCenterJobStatus } from "../../lib/syncCenterTypes";

interface SyncCenterJobSummary {
  jobType?: string;
  status: SyncCenterJobStatus;
  attempts?: number;
  maxAttempts?: number;
  notBefore?: string;
  updatedAt?: string;
}

const jobStatusCopy: Record<SyncCenterJobStatus, string> = {
  queued: "排队中",
  running: "同步中",
  done: "最近已完成",
  failed: "最近失败",
  dead_letter: "多次失败已停止",
};

export function syncCenterLatestJobSummary(
  account: Pick<SyncCenterAccountDto, "latestSyncJob" | "latestJob">,
): string {
  const job = readLatestSyncJob(account.latestSyncJob ?? account.latestJob);

  if (!job) {
    return "";
  }

  const parts = [jobTypeLabel(job.jobType), jobStatusCopy[job.status]];
  const attempts = attemptsLabel(job);
  if (attempts) {
    parts.push(attempts);
  }

  if (job.status === "queued" && job.notBefore) {
    parts.push(`稍后 ${formatShortDateTime(job.notBefore)}`);
  } else if (job.updatedAt) {
    parts.push(`更新 ${formatShortDateTime(job.updatedAt)}`);
  }

  if (job.status === "failed" || job.status === "dead_letter") {
    parts.push("可检查");
  }

  return parts.join(" · ");
}

export function SyncCenterLatestJobSummary(props: {
  account: Pick<SyncCenterAccountDto, "latestSyncJob" | "latestJob">;
}) {
  const summary = syncCenterLatestJobSummary(props.account);

  if (!summary) {
    return null;
  }

  return <span>最近同步：{summary}</span>;
}

function readLatestSyncJob(value: unknown): SyncCenterJobSummary | undefined {
  if (!isRecord(value) || !isJobStatus(value.status)) {
    return undefined;
  }

  return {
    status: value.status,
    jobType: readString(value.jobType),
    attempts: readNumber(value.attempts),
    maxAttempts: readNumber(value.maxAttempts),
    notBefore: readString(value.notBefore),
    updatedAt: readString(value.updatedAt),
  };
}

function isJobStatus(value: unknown): value is SyncCenterJobStatus {
  return (
    value === "queued" ||
    value === "running" ||
    value === "done" ||
    value === "failed" ||
    value === "dead_letter"
  );
}

function jobTypeLabel(jobType: string | undefined): string {
  if (jobType === "sync_account") {
    return "邮箱同步";
  }

  return "邮箱同步";
}

function attemptsLabel(job: SyncCenterJobSummary): string {
  if (typeof job.attempts !== "number") {
    return "";
  }

  if (typeof job.maxAttempts === "number" && job.maxAttempts > 0) {
    return `第 ${job.attempts}/${job.maxAttempts} 次`;
  }

  return `第 ${job.attempts} 次`;
}

function formatShortDateTime(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) {
    return value;
  }

  return `${match[2]}-${match[3]} ${match[4]}:${match[5]}`;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
