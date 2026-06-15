export type EngineCommandType =
  | "mark_read"
  | "mark_unread"
  | "star"
  | "unstar"
  | "archive"
  | "trash"
  | "move"
  | "apply_labels";

export type EngineCommandStatus =
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "dead_letter";

export interface EngineCommandRecord {
  id: string;
  commandType: EngineCommandType;
  accountId: string;
  target: Record<string, unknown>;
  payload: Record<string, unknown>;
  status: EngineCommandStatus;
  attempts: number;
  maxAttempts: number;
  idempotencyKey: string;
  notBefore: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface ClaimNextEngineCommandInput {
  workerId: string;
  now: Date;
  leaseSeconds: number;
}

export interface CompleteEngineCommandInput {
  commandId: string;
  workerId: string;
  now: Date;
}

export interface FailEngineCommandInput extends CompleteEngineCommandInput {
  errorMessage: string;
  retryable?: boolean;
}

export interface EngineCommandQueue {
  claimNext(
    input: ClaimNextEngineCommandInput,
  ): Promise<EngineCommandRecord | undefined>;
  completeCommand(
    input: CompleteEngineCommandInput,
  ): Promise<EngineCommandRecord>;
  failCommand(input: FailEngineCommandInput): Promise<EngineCommandRecord>;
}

export interface InMemoryEngineCommandQueue extends EngineCommandQueue {
  listCommands(): EngineCommandRecord[];
}

export function createInMemoryEngineCommandQueue(
  initialCommands: EngineCommandRecord[] = [],
): InMemoryEngineCommandQueue {
  const commands = initialCommands.map((command) => ({ ...command }));

  return {
    async claimNext(input) {
      const candidate = commands
        .map((command, index) => ({ index, command }))
        .filter(
          ({ command }) =>
          canClaim(command, input.now) &&
          !hasActiveSameAccountCommand(commands, command, input.now),
        )
        .sort((left, right) =>
          compareClaimOrder(left.command, right.command),
        )[0];
      if (!candidate) {
        return undefined;
      }

      const { index } = candidate;
      const command = commands[index];
      const { errorMessage: _staleError, ...commandWithoutError } = command;
      const updated: EngineCommandRecord = {
        ...commandWithoutError,
        status: "running",
        attempts: command.attempts + 1,
        leaseOwner: input.workerId,
        leaseExpiresAt: addSeconds(input.now, input.leaseSeconds).toISOString(),
        updatedAt: input.now.toISOString(),
      };
      commands[index] = updated;
      return { ...updated };
    },

    async completeCommand(input) {
      const { command, index } = findOwnedCommand(
        commands,
        input.commandId,
        input.workerId,
      );
      const { errorMessage: _staleError, ...commandWithoutError } = command;
      const updated: EngineCommandRecord = {
        ...commandWithoutError,
        status: "done",
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        completedAt: input.now.toISOString(),
        updatedAt: input.now.toISOString(),
      };
      commands[index] = updated;
      return { ...updated };
    },

    async failCommand(input) {
      const { command, index } = findOwnedCommand(
        commands,
        input.commandId,
        input.workerId,
      );
      const retryable =
        input.retryable !== false && command.attempts < command.maxAttempts;
      const updated: EngineCommandRecord = {
        ...command,
        status: retryable ? "queued" : "dead_letter",
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        notBefore: retryable
          ? addSeconds(input.now, backoffSeconds(command.attempts)).toISOString()
          : command.notBefore,
        errorMessage: input.errorMessage,
        updatedAt: input.now.toISOString(),
      };
      commands[index] = updated;
      return { ...updated };
    },

    listCommands() {
      return commands.map((command) => ({ ...command }));
    },
  };
}

function compareClaimOrder(
  left: EngineCommandRecord,
  right: EngineCommandRecord,
): number {
  return (
    compareTimestamp(left.notBefore, right.notBefore) ||
    compareTimestamp(left.createdAt, right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

function compareTimestamp(left: string, right: string): number {
  return timestampValue(left) - timestampValue(right);
}

function timestampValue(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function canClaim(command: EngineCommandRecord, now: Date): boolean {
  if (command.status === "queued") {
    return Date.parse(command.notBefore) <= now.getTime();
  }

  return (
    command.status === "running" &&
    !!command.leaseExpiresAt &&
    Date.parse(command.leaseExpiresAt) <= now.getTime()
  );
}

function hasActiveSameAccountCommand(
  commands: EngineCommandRecord[],
  candidate: EngineCommandRecord,
  now: Date,
): boolean {
  return commands.some(
    (command) =>
      command.id !== candidate.id &&
      command.accountId === candidate.accountId &&
      command.status === "running" &&
      !!command.leaseExpiresAt &&
      Date.parse(command.leaseExpiresAt) > now.getTime(),
  );
}

function findOwnedCommand(
  commands: EngineCommandRecord[],
  commandId: string,
  workerId: string,
): { command: EngineCommandRecord; index: number } {
  const index = commands.findIndex((command) => command.id === commandId);
  if (index === -1) {
    throw new Error(`engine command not found: ${commandId}`);
  }

  const command = commands[index];
  if (command.leaseOwner !== workerId || command.status !== "running") {
    throw new Error(`engine command lease is not owned by ${workerId}`);
  }

  return { command, index };
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

function backoffSeconds(attempts: number): number {
  return Math.min(30 * 2 ** Math.max(0, attempts - 1), 15 * 60);
}
