export class InvalidAliasRoutingInputError extends Error {
  readonly code = "invalid_alias_routing_input";
}

export type AliasRouteType = "alias" | "catch_all";
export type CatchAllMode = "reject" | "forward" | "auto_create" | "discard";
export type AliasDeliveryJobStatus =
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "dead_letter";
export type AliasDeliveryLogStatus =
  | "accepted"
  | "matched"
  | "queued"
  | "delivered"
  | "deferred"
  | "bounced"
  | "dropped";

export interface AliasRouteMatch {
  routeType: AliasRouteType;
  domainId: string;
  domain: string;
  aliasId?: string;
  localPart: string;
  catchAllMode?: CatchAllMode;
  destinationIds: string[];
  destinationEmails: string[];
}

export interface AliasDeliveryJob {
  id: string;
  domainId: string;
  aliasId?: string;
  recipient: string;
  destinationId: string;
  destinationEmail: string;
  sender?: string;
  messageFingerprint: string;
  rawMessageRef?: string;
  idempotencyKey: string;
  status: AliasDeliveryJobStatus;
  attempts: number;
  maxAttempts: number;
  notBefore: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  payload: Record<string, unknown>;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface AliasDeliveryLog {
  id: string;
  domainId?: string;
  aliasId?: string;
  recipient: string;
  status: AliasDeliveryLogStatus;
  detail?: string;
  createdAt: string;
}

export interface AliasInboundMessage {
  recipient: string;
  sender?: string;
  messageFingerprint: string;
  rawMessageRef?: string;
}

export interface AliasRouteLookupInput {
  domain: string;
  localPart: string;
}

export interface ClaimAliasDeliveryJobInput {
  workerId: string;
  now: Date;
  leaseSeconds: number;
}

export interface CompleteAliasDeliveryJobInput {
  jobId: string;
  workerId: string;
  now: Date;
}

export interface FailAliasDeliveryJobInput extends CompleteAliasDeliveryJobInput {
  errorMessage: string;
}

export interface AliasRoutingStore {
  findRoute(input: AliasRouteLookupInput): Promise<AliasRouteMatch | undefined>;
  enqueueDeliveryJob(input: {
    id: string;
    domainId: string;
    aliasId?: string;
    recipient: string;
    destinationId: string;
    destinationEmail: string;
    sender?: string;
    messageFingerprint: string;
    rawMessageRef?: string;
    idempotencyKey: string;
    maxAttempts?: number;
    notBefore: string;
    payload: Record<string, unknown>;
  }): Promise<AliasDeliveryJob>;
  recordDeliveryLog(input: AliasDeliveryLog): Promise<AliasDeliveryLog>;
  claimNextDeliveryJob?(
    input: ClaimAliasDeliveryJobInput,
  ): Promise<AliasDeliveryJob | undefined>;
  completeDeliveryJob?(
    input: CompleteAliasDeliveryJobInput,
  ): Promise<AliasDeliveryJob>;
  failDeliveryJob?(input: FailAliasDeliveryJobInput): Promise<AliasDeliveryJob>;
}

export interface InMemoryAliasRoutingStore extends AliasRoutingStore {
  listDeliveryJobs(): AliasDeliveryJob[];
  listDeliveryLogs(): AliasDeliveryLog[];
}

export interface AliasRouter {
  routeInbound(input: AliasInboundMessage): Promise<
    | {
        status: "queued";
        routeType: AliasRouteType;
        domainId: string;
        aliasId?: string;
        recipient: string;
        jobs: AliasDeliveryJob[];
      }
    | {
        status: "dropped";
        reason: "no_route" | "catch_all_rejected" | "catch_all_discarded";
        recipient: string;
        jobs: [];
      }
  >;
}

export interface AliasRouterOptions {
  store: AliasRoutingStore;
  createId: () => string;
  now?: () => string;
}

export function createAliasRouter(options: AliasRouterOptions): AliasRouter {
  const now = () => options.now?.() ?? new Date().toISOString();

  return {
    async routeInbound(input) {
      const recipient = normalizeRecipient(input.recipient);
      const messageFingerprint = normalizeFingerprint(input.messageFingerprint);
      const [localPart, domain] = recipient.split("@") as [string, string];
      const route = await options.store.findRoute({ domain, localPart });

      if (!route) {
        await options.store.recordDeliveryLog({
          id: options.createId(),
          recipient,
          status: "dropped",
          detail: "no alias or catch-all route matched",
          createdAt: now(),
        });
        return { status: "dropped", reason: "no_route", recipient, jobs: [] };
      }

      if (route.routeType === "catch_all" && route.catchAllMode !== "forward") {
        const reason =
          route.catchAllMode === "discard"
            ? "catch_all_discarded"
            : "catch_all_rejected";
        await options.store.recordDeliveryLog({
          id: options.createId(),
          domainId: route.domainId,
          recipient,
          status: "dropped",
          detail: `${route.catchAllMode ?? "reject"} catch-all handled recipient`,
          createdAt: now(),
        });
        return { status: "dropped", reason, recipient, jobs: [] };
      }

      await options.store.recordDeliveryLog({
        id: options.createId(),
        domainId: route.domainId,
        ...(route.aliasId ? { aliasId: route.aliasId } : {}),
        recipient,
        status: "matched",
        detail:
          route.routeType === "alias"
            ? `matched exact alias ${route.localPart}@${route.domain}`
            : `matched catch-all for ${route.domain}`,
        createdAt: now(),
      });

      const jobs: AliasDeliveryJob[] = [];
      for (const [index, destinationId] of route.destinationIds.entries()) {
        const destinationEmail = route.destinationEmails[index];
        if (!destinationEmail) {
          continue;
        }

        const job = await options.store.enqueueDeliveryJob({
          id: options.createId(),
          domainId: route.domainId,
          ...(route.aliasId ? { aliasId: route.aliasId } : {}),
          recipient,
          destinationId,
          destinationEmail,
          ...(input.sender ? { sender: input.sender } : {}),
          messageFingerprint,
          ...(input.rawMessageRef ? { rawMessageRef: input.rawMessageRef } : {}),
          idempotencyKey: `alias-delivery:${messageFingerprint}:${destinationId}`,
          notBefore: now(),
          payload: { routeType: route.routeType },
        });
        jobs.push(job);

        await options.store.recordDeliveryLog({
          id: options.createId(),
          domainId: route.domainId,
          ...(route.aliasId ? { aliasId: route.aliasId } : {}),
          recipient,
          status: "queued",
          detail: `queued alias delivery to ${destinationEmail}`,
          createdAt: now(),
        });
      }

      return {
        status: "queued",
        routeType: route.routeType,
        domainId: route.domainId,
        ...(route.aliasId ? { aliasId: route.aliasId } : {}),
        recipient,
        jobs,
      };
    },
  };
}

export function createInMemoryAliasRoutingStore(input?: {
  routes?: AliasRouteMatch[];
}): InMemoryAliasRoutingStore {
  const routes = input?.routes?.map(cloneRoute) ?? [];
  const deliveryJobs = new Map<string, AliasDeliveryJob>();
  const deliveryLogs: AliasDeliveryLog[] = [];

  return {
    async findRoute(lookup) {
      const exact = routes.find(
        (route) =>
          route.routeType === "alias" &&
          route.domain === lookup.domain &&
          route.localPart === lookup.localPart,
      );
      if (exact) {
        return cloneRoute(exact);
      }

      const catchAll = routes.find(
        (route) =>
          route.routeType === "catch_all" && route.domain === lookup.domain,
      );
      return catchAll ? cloneRoute(catchAll) : undefined;
    },

    async enqueueDeliveryJob(input) {
      const existing = deliveryJobs.get(input.idempotencyKey);
      if (existing) {
        return cloneDeliveryJob(existing);
      }

      const createdAt = input.notBefore;
      const job: AliasDeliveryJob = {
        id: input.id,
        domainId: input.domainId,
        ...(input.aliasId ? { aliasId: input.aliasId } : {}),
        recipient: input.recipient,
        destinationId: input.destinationId,
        destinationEmail: input.destinationEmail,
        ...(input.sender ? { sender: input.sender } : {}),
        messageFingerprint: input.messageFingerprint,
        ...(input.rawMessageRef ? { rawMessageRef: input.rawMessageRef } : {}),
        idempotencyKey: input.idempotencyKey,
        status: "queued",
        attempts: 0,
        maxAttempts: input.maxAttempts ?? 8,
        notBefore: input.notBefore,
        payload: { ...input.payload },
        createdAt,
        updatedAt: createdAt,
      };
      deliveryJobs.set(input.idempotencyKey, job);
      return cloneDeliveryJob(job);
    },

    async recordDeliveryLog(input) {
      deliveryLogs.push({ ...input });
      return { ...input };
    },

    async completeDeliveryJob(input) {
      const job = findOwnedJob(deliveryJobs, input.jobId, input.workerId);
      const completedAt = input.now.toISOString();
      job.status = "done";
      job.leaseOwner = undefined;
      job.leaseExpiresAt = undefined;
      job.completedAt = completedAt;
      job.updatedAt = completedAt;
      return cloneDeliveryJob(job);
    },

    async failDeliveryJob(input) {
      const job = findOwnedJob(deliveryJobs, input.jobId, input.workerId);
      const updatedAt = input.now.toISOString();
      job.status = job.attempts >= job.maxAttempts ? "dead_letter" : "queued";
      job.leaseOwner = undefined;
      job.leaseExpiresAt = undefined;
      job.errorMessage = input.errorMessage;
      job.updatedAt = updatedAt;
      return cloneDeliveryJob(job);
    },

    listDeliveryJobs() {
      return [...deliveryJobs.values()].map(cloneDeliveryJob);
    },

    listDeliveryLogs() {
      return deliveryLogs.map((log) => ({ ...log }));
    },
  };
}

function normalizeRecipient(value: string): string {
  const recipient = value.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient)) {
    throw new InvalidAliasRoutingInputError("recipient is invalid");
  }

  return recipient;
}

function normalizeFingerprint(value: string): string {
  const fingerprint = value.trim();
  if (!fingerprint) {
    throw new InvalidAliasRoutingInputError("message fingerprint is required");
  }

  return fingerprint;
}

function cloneRoute(route: AliasRouteMatch): AliasRouteMatch {
  return {
    routeType: route.routeType,
    domainId: route.domainId,
    domain: route.domain,
    ...(route.aliasId ? { aliasId: route.aliasId } : {}),
    localPart: route.localPart,
    ...(route.catchAllMode ? { catchAllMode: route.catchAllMode } : {}),
    destinationIds: [...route.destinationIds],
    destinationEmails: [...route.destinationEmails],
  };
}

function cloneDeliveryJob(job: AliasDeliveryJob): AliasDeliveryJob {
  return {
    ...job,
    payload: { ...job.payload },
  };
}

function findOwnedJob(
  deliveryJobs: Map<string, AliasDeliveryJob>,
  jobId: string,
  workerId: string,
): AliasDeliveryJob {
  const job = [...deliveryJobs.values()].find((item) => item.id === jobId);
  if (!job || job.status !== "running" || job.leaseOwner !== workerId) {
    throw new Error(`alias delivery job lease is not owned by ${workerId}`);
  }

  return job;
}
