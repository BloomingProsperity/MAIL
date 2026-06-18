export type SyncCenterJobStatus =
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "dead_letter";

export interface SyncCenterJobSummaryDto {
  id: string;
  jobType: string;
  status: SyncCenterJobStatus;
  attempts: number;
  maxAttempts: number;
  notBefore: string;
  leaseExpiresAt?: string;
  errorMessage?: string;
  updatedAt: string;
  completedAt?: string;
}
