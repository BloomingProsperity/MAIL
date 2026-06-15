export type SyncCenterAuthMethod = "password" | "oauth";
export type SyncCenterEngineProvider = "emailengine" | "native";
export type SyncCenterAccountState = "syncing" | "reauth_required" | "paused";
export type SyncCenterNextAction =
  | "none"
  | "wait_for_sync"
  | "fix_sync_error"
  | "reauthorize"
  | "resume_sync";
export type SyncCenterJobStatus =
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "dead_letter";
export type ReauthorizationTaskStatus = "pending" | "failed";

export interface SyncCenterJobSummary {
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

export interface SyncCenterAccount {
  accountId: string;
  email: string;
  provider: string;
  authMethod: SyncCenterAuthMethod;
  displayName?: string;
  syncState: SyncCenterAccountState;
  engineProvider: SyncCenterEngineProvider;
  reauthRequired: boolean;
  nextAction: SyncCenterNextAction;
  accountUpdatedAt: string;
  latestSyncJob?: SyncCenterJobSummary;
}

export interface ReauthorizationTask {
  taskId: string;
  email: string;
  provider: string;
  authMethod: SyncCenterAuthMethod;
  status: ReauthorizationTaskStatus;
  source?: string;
  displayName?: string;
  transferVersion?: number;
  reauthRequired: boolean;
  loginHint?: string;
  providerPreset?: string;
  username?: string;
  labels?: string[];
  group?: string;
  notes?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SyncCenterStore {
  listAccounts(): Promise<{ items: SyncCenterAccount[] }>;
  listReauthorizations(): Promise<{ items: ReauthorizationTask[] }>;
}
