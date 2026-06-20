import {
  type DomainDnsResolver,
  verifyDomainDnsRecords,
} from "./domain-dns-verification.js";
import {
  createCloudflareDnsClient,
  type DomainCloudflareDnsClient,
  type DomainCloudflareSetupResult,
} from "./domain-cloudflare.js";

export class InvalidDomainAliasRequestError extends Error {
  readonly code = "invalid_domain_alias_request";

  constructor(message = "invalid domain alias request") {
    super(message);
  }
}

export type DomainVerificationStatus = "pending" | "verified" | "failed";
export type CatchAllMode = "reject" | "forward" | "auto_create" | "discard";
export type DeliveryLogStatus =
  | "accepted"
  | "matched"
  | "queued"
  | "delivered"
  | "deferred"
  | "bounced"
  | "dropped";

export interface DnsRecord {
  type: "TXT" | "MX";
  name: string;
  value: string;
}

export interface DomainDnsRecords {
  ownershipTxt: DnsRecord;
  mx: DnsRecord;
  spf: DnsRecord;
  dmarc: DnsRecord;
}

export interface DomainRecord {
  id: string;
  domain: string;
  verificationStatus: DomainVerificationStatus;
  dnsRecords: DomainDnsRecords;
  createdAt: string;
}

export interface DestinationRecord {
  id: string;
  domainId?: string;
  email: string;
  verified: boolean;
  createdAt: string;
}

export interface AliasRecord {
  id: string;
  domainId: string;
  address: string;
  localPart: string;
  enabled: boolean;
  destinationIds: string[];
  createdAt: string;
}

export interface CatchAllRuleRecord {
  id: string;
  domainId: string;
  ruleType: "catch_all";
  enabled: boolean;
  config: {
    mode: CatchAllMode;
    destinationIds?: string[];
  };
  createdAt: string;
}

export interface DeliveryLogRecord {
  id: string;
  domainId?: string;
  aliasId?: string;
  recipient: string;
  status: DeliveryLogStatus;
  detail?: string;
  createdAt: string;
}

export interface DomainAliasStore {
  createDomain(input: {
    id: string;
    domain: string;
    createdAt?: string;
  }): Promise<DomainRecord>;
  listDomains(): Promise<DomainRecord[]>;
  getDomain(domainId: string): Promise<DomainRecord | undefined>;
  updateDomainVerificationStatus(input: {
    domainId: string;
    status: DomainVerificationStatus;
  }): Promise<DomainRecord | undefined>;
  createDestination(input: {
    id: string;
    domainId: string;
    email: string;
    createdAt?: string;
  }): Promise<DestinationRecord>;
  listDestinations(input: { domainId: string }): Promise<DestinationRecord[]>;
  getDestinationsByIds(destinationIds: string[]): Promise<DestinationRecord[]>;
  createAlias(input: {
    id: string;
    domainId: string;
    localPart: string;
    destinationIds: string[];
    createdAt?: string;
  }): Promise<AliasRecord>;
  listAliases(input: { domainId: string }): Promise<AliasRecord[]>;
  setCatchAll(input: {
    id: string;
    domainId: string;
    config: CatchAllRuleRecord["config"];
    createdAt?: string;
  }): Promise<CatchAllRuleRecord>;
  getCatchAll(input: {
    domainId: string;
  }): Promise<CatchAllRuleRecord | undefined>;
  listDeliveryLogs(input: {
    domainId: string;
    limit: number;
  }): Promise<DeliveryLogRecord[]>;
}

export interface InMemoryDomainAliasStore extends DomainAliasStore {
  recordDeliveryLog(input: DeliveryLogRecord): Promise<DeliveryLogRecord>;
}

export interface DomainAliasService {
  createDomain(input: { domain: string }): Promise<DomainRecord>;
  listDomains(): Promise<{ items: DomainRecord[] }>;
  verifyDomain(input: { domainId: string }): Promise<DomainRecord>;
  configureDomainCloudflare(input: {
    domainId: string;
    apiToken: string;
    zoneId?: string;
  }): Promise<DomainCloudflareSetupResult>;
  createDestination(input: {
    domainId: string;
    email: string;
  }): Promise<DestinationRecord>;
  listDestinations(input: { domainId: string }): Promise<{
    items: DestinationRecord[];
  }>;
  createAlias(input: {
    domainId: string;
    localPart: string;
    destinationIds: string[];
  }): Promise<AliasRecord>;
  listAliases(input: { domainId: string }): Promise<{ items: AliasRecord[] }>;
  setCatchAll(input: {
    domainId: string;
    mode: CatchAllMode;
    destinationIds?: string[];
  }): Promise<CatchAllRuleRecord>;
  getCatchAll(input: {
    domainId: string;
  }): Promise<{ item: CatchAllRuleRecord | null }>;
  listDeliveryLogs(input: {
    domainId: string;
    limit?: number;
  }): Promise<{ items: DeliveryLogRecord[] }>;
}

export interface DomainAliasServiceOptions {
  store: DomainAliasStore;
  createId: () => string;
  now?: () => string;
  dnsResolver?: DomainDnsResolver;
  cloudflareDnsClient?: DomainCloudflareDnsClient;
}

export function createDomainAliasService(
  options: DomainAliasServiceOptions,
): DomainAliasService {
  const now = () => options.now?.() ?? new Date().toISOString();
  const cloudflareDnsClient =
    options.cloudflareDnsClient ?? createCloudflareDnsClient();

  return {
    async createDomain(input) {
      const domain = normalizeDomain(input.domain);
      return options.store.createDomain({
        id: options.createId(),
        domain,
        createdAt: now(),
      });
    },

    async listDomains() {
      return { items: await options.store.listDomains() };
    },

    async verifyDomain(input) {
      const domain = await requireDomain(options.store, input.domainId);
      const verified = await verifyDomainDnsRecords(
        domain.dnsRecords,
        options.dnsResolver,
      );
      const updated = await options.store.updateDomainVerificationStatus({
        domainId: domain.id,
        status: verified ? "verified" : "failed",
      });
      if (!updated) {
        throw new InvalidDomainAliasRequestError("domain was not found");
      }
      return updated;
    },

    async configureDomainCloudflare(input) {
      const domain = await requireDomain(options.store, input.domainId);
      return cloudflareDnsClient.setupDomainDns({
        domain: domain.domain,
        dnsRecords: domain.dnsRecords,
        apiToken: normalizeCloudflareToken(input.apiToken),
        zoneId: normalizeOptionalText(input.zoneId),
      });
    },

    async createDestination(input) {
      await requireDomain(options.store, input.domainId);
      const email = normalizeEmail(input.email);
      return options.store.createDestination({
        id: options.createId(),
        domainId: input.domainId,
        email,
        createdAt: now(),
      });
    },

    async listDestinations(input) {
      await requireDomain(options.store, input.domainId);
      return {
        items: await options.store.listDestinations({
          domainId: input.domainId,
        }),
      };
    },

    async createAlias(input) {
      const domain = await requireDomain(options.store, input.domainId);
      const localPart = normalizeLocalPart(input.localPart);
      const destinationIds = normalizeDestinationIds(input.destinationIds);
      await requireDestinations(options.store, input.domainId, destinationIds);

      const alias = await options.store.createAlias({
        id: options.createId(),
        domainId: input.domainId,
        localPart,
        destinationIds,
        createdAt: now(),
      });

      return {
        ...alias,
        address: alias.address || `${localPart}@${domain.domain}`,
      };
    },

    async listAliases(input) {
      await requireDomain(options.store, input.domainId);
      return { items: await options.store.listAliases(input) };
    },

    async setCatchAll(input) {
      await requireDomain(options.store, input.domainId);
      const mode = normalizeCatchAllMode(input.mode);
      const destinationIds =
        input.destinationIds === undefined
          ? undefined
          : normalizeDestinationIds(input.destinationIds);

      if (mode === "forward" && (!destinationIds || destinationIds.length === 0)) {
        throw new InvalidDomainAliasRequestError(
          "forward catch-all requires at least one destination",
        );
      }
      if (destinationIds && destinationIds.length > 0) {
        await requireDestinations(options.store, input.domainId, destinationIds);
      }

      return options.store.setCatchAll({
        id: options.createId(),
        domainId: input.domainId,
        config: destinationIds ? { mode, destinationIds } : { mode },
        createdAt: now(),
      });
    },

    async getCatchAll(input) {
      await requireDomain(options.store, input.domainId);
      return {
        item: (await options.store.getCatchAll(input)) ?? null,
      };
    },

    async listDeliveryLogs(input) {
      await requireDomain(options.store, input.domainId);
      return {
        items: await options.store.listDeliveryLogs({
          domainId: input.domainId,
          limit: normalizeLimit(input.limit),
        }),
      };
    },
  };
}

export function createInMemoryDomainAliasStore(): InMemoryDomainAliasStore {
  const domains = new Map<string, DomainRecord>();
  const destinations = new Map<string, DestinationRecord>();
  const domainDestinations = new Map<string, Set<string>>();
  const aliases = new Map<string, AliasRecord>();
  const catchAllRules = new Map<string, CatchAllRuleRecord>();
  const deliveryLogs: DeliveryLogRecord[] = [];

  return {
    async createDomain(input) {
      const existing = [...domains.values()].find(
        (item) => item.domain === input.domain,
      );
      if (existing) {
        return existing;
      }

      const record: DomainRecord = {
        id: input.id,
        domain: input.domain,
        verificationStatus: "pending",
        dnsRecords: buildDnsRecords(input.id, input.domain),
        createdAt: input.createdAt ?? new Date().toISOString(),
      };
      domains.set(record.id, record);
      return { ...record };
    },

    async listDomains() {
      return [...domains.values()]
        .sort((left, right) => left.domain.localeCompare(right.domain))
        .map((domain) => ({ ...domain }));
    },

    async getDomain(domainId) {
      const domain = domains.get(domainId);
      return domain ? { ...domain } : undefined;
    },

    async updateDomainVerificationStatus(input) {
      const domain = domains.get(input.domainId);
      if (!domain) {
        return undefined;
      }
      const updated = { ...domain, verificationStatus: input.status };
      domains.set(input.domainId, updated);
      return { ...updated };
    },

    async createDestination(input) {
      const existing = [...destinations.values()].find(
        (item) => item.email === input.email,
      );
      if (existing) {
        linkDestinationToDomain(domainDestinations, input.domainId, existing.id);
        return { ...existing, domainId: input.domainId };
      }

      const record: DestinationRecord = {
        id: input.id,
        domainId: input.domainId,
        email: input.email,
        verified: false,
        createdAt: input.createdAt ?? new Date().toISOString(),
      };
      destinations.set(record.id, record);
      linkDestinationToDomain(domainDestinations, input.domainId, record.id);
      return { ...record };
    },

    async listDestinations(input) {
      const ids = domainDestinations.get(input.domainId) ?? new Set<string>();
      return [...ids]
        .map((id) => destinations.get(id))
        .filter((item): item is DestinationRecord => item !== undefined)
        .sort((left, right) => left.email.localeCompare(right.email))
        .map((item) => ({ ...item, domainId: input.domainId }));
    },

    async getDestinationsByIds(destinationIds) {
      return destinationIds
        .map((id) => destinations.get(id))
        .filter((item): item is DestinationRecord => item !== undefined)
        .map((item) => ({ ...item }));
    },

    async createAlias(input) {
      const domain = domains.get(input.domainId);
      if (!domain) {
        throw new InvalidDomainAliasRequestError("domain was not found");
      }

      const existing = [...aliases.values()].find(
        (item) =>
          item.domainId === input.domainId && item.localPart === input.localPart,
      );
      const record: AliasRecord = {
        id: existing?.id ?? input.id,
        domainId: input.domainId,
        address: `${input.localPart}@${domain.domain}`,
        localPart: input.localPart,
        enabled: true,
        destinationIds: input.destinationIds,
        createdAt:
          existing?.createdAt ?? input.createdAt ?? new Date().toISOString(),
      };
      aliases.set(record.id, record);
      return { ...record, destinationIds: [...record.destinationIds] };
    },

    async listAliases(input) {
      return [...aliases.values()]
        .filter((item) => item.domainId === input.domainId)
        .sort((left, right) => left.localPart.localeCompare(right.localPart))
        .map((item) => ({ ...item, destinationIds: [...item.destinationIds] }));
    },

    async setCatchAll(input) {
      const existing = catchAllRules.get(input.domainId);
      const record: CatchAllRuleRecord = {
        id: existing?.id ?? input.id,
        domainId: input.domainId,
        ruleType: "catch_all",
        enabled: true,
        config: cloneCatchAllConfig(input.config),
        createdAt:
          existing?.createdAt ?? input.createdAt ?? new Date().toISOString(),
      };
      catchAllRules.set(input.domainId, record);
      return { ...record, config: cloneCatchAllConfig(record.config) };
    },

    async getCatchAll(input) {
      const record = catchAllRules.get(input.domainId);
      return record
        ? { ...record, config: cloneCatchAllConfig(record.config) }
        : undefined;
    },

    async listDeliveryLogs(input) {
      return deliveryLogs
        .filter((item) => item.domainId === input.domainId)
        .sort((left, right) =>
          right.createdAt.localeCompare(left.createdAt) ||
          right.id.localeCompare(left.id),
        )
        .slice(0, input.limit)
        .map((item) => ({ ...item }));
    },

    async recordDeliveryLog(input) {
      deliveryLogs.push({ ...input });
      return { ...input };
    },
  };
}

export function buildDnsRecords(
  domainId: string,
  domain: string,
): DomainDnsRecords {
  return {
    ownershipTxt: {
      type: "TXT",
      name: `_emailhub.${domain}`,
      value: `emailhub-domain-verification=${domainId}`,
    },
    mx: {
      type: "MX",
      name: domain,
      value: "10 mx.emailhub.local",
    },
    spf: {
      type: "TXT",
      name: domain,
      value: "v=spf1 include:emailhub.local ~all",
    },
    dmarc: {
      type: "TXT",
      name: `_dmarc.${domain}`,
      value: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}`,
    },
  };
}

function normalizeDomain(value: string): string {
  const domain = value.trim().toLowerCase();
  if (
    domain.length < 4 ||
    domain.length > 253 ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(
      domain,
    )
  ) {
    throw new InvalidDomainAliasRequestError("domain is invalid");
  }

  return domain;
}

function normalizeCloudflareToken(value: string): string {
  const token = value.trim();
  if (!token) {
    throw new InvalidDomainAliasRequestError("cloudflare api token is required");
  }
  return token;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new InvalidDomainAliasRequestError("destination email is invalid");
  }

  return email;
}

function normalizeLocalPart(value: string): string {
  const localPart = value.trim().toLowerCase();
  if (
    localPart.length < 1 ||
    localPart.length > 64 ||
    !/^[a-z0-9][a-z0-9._+-]*$/.test(localPart)
  ) {
    throw new InvalidDomainAliasRequestError("alias local part is invalid");
  }

  return localPart;
}

function normalizeDestinationIds(value: string[]): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new InvalidDomainAliasRequestError("destination ids are required");
  }

  const ids = [...new Set(value.map((item) => item.trim()).filter(Boolean))];
  if (ids.length === 0) {
    throw new InvalidDomainAliasRequestError("destination ids are required");
  }

  return ids;
}

function normalizeCatchAllMode(value: string): CatchAllMode {
  if (
    value !== "reject" &&
    value !== "forward" &&
    value !== "auto_create" &&
    value !== "discard"
  ) {
    throw new InvalidDomainAliasRequestError("catch-all mode is invalid");
  }

  return value;
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) {
    return 50;
  }
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new InvalidDomainAliasRequestError("limit is invalid");
  }

  return value;
}

async function requireDomain(
  store: DomainAliasStore,
  domainId: string,
): Promise<DomainRecord> {
  if (!domainId.trim()) {
    throw new InvalidDomainAliasRequestError("domain id is required");
  }

  const domain = await store.getDomain(domainId);
  if (!domain) {
    throw new InvalidDomainAliasRequestError("domain was not found");
  }

  return domain;
}

async function requireDestinations(
  store: DomainAliasStore,
  domainId: string,
  destinationIds: string[],
): Promise<void> {
  const destinations = await store.listDestinations({ domainId });
  const domainDestinationIds = new Set(destinations.map((item) => item.id));
  if (!destinationIds.every((id) => domainDestinationIds.has(id))) {
    throw new InvalidDomainAliasRequestError("destination was not found");
  }
  const existing = await store.getDestinationsByIds(destinationIds);
  if (existing.length !== destinationIds.length) {
    throw new InvalidDomainAliasRequestError("destination was not found");
  }
}

function linkDestinationToDomain(
  domainDestinations: Map<string, Set<string>>,
  domainId: string,
  destinationId: string,
): void {
  const ids = domainDestinations.get(domainId) ?? new Set<string>();
  ids.add(destinationId);
  domainDestinations.set(domainId, ids);
}

function cloneCatchAllConfig(
  config: CatchAllRuleRecord["config"],
): CatchAllRuleRecord["config"] {
  return {
    mode: config.mode,
    ...(config.destinationIds
      ? { destinationIds: [...config.destinationIds] }
      : {}),
  };
}
