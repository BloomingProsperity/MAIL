import type { DomainDnsRecords, DnsRecord } from "./domain-alias.js";

export class CloudflareDnsRequestError extends Error {
  readonly code = "cloudflare_dns_request_failed";
  readonly statusCode = 502;

  constructor(message = "cloudflare dns request failed") {
    super(message);
  }
}

export interface DomainCloudflareRecordResult {
  type: "TXT" | "MX";
  name: string;
  value: string;
  status: "created" | "existing";
  priority?: number;
}

export interface DomainCloudflareSetupResult {
  zoneId: string;
  zoneName: string;
  records: DomainCloudflareRecordResult[];
}

export interface DomainCloudflareDnsClient {
  setupDomainDns(input: {
    apiToken: string;
    domain: string;
    dnsRecords: DomainDnsRecords;
    zoneId?: string;
  }): Promise<DomainCloudflareSetupResult>;
}

interface CloudflareDnsClientOptions {
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface CloudflareZone {
  id: string;
  name: string;
}

interface CloudflareDnsRecord {
  id: string;
  type: "TXT" | "MX";
  name: string;
  content: string;
  priority?: number;
}

interface CloudflareApiResponse<T> {
  success: boolean;
  result: T;
}

interface CloudflareRecordInput {
  type: "TXT" | "MX";
  name: string;
  content: string;
  priority?: number;
}

export function createCloudflareDnsClient(
  options: CloudflareDnsClientOptions = {},
): DomainCloudflareDnsClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiBaseUrl =
    options.apiBaseUrl?.replace(/\/$/, "") ??
    "https://api.cloudflare.com/client/v4";

  return {
    async setupDomainDns(input) {
      const zone = input.zoneId
        ? await getZone(fetchImpl, apiBaseUrl, input.apiToken, input.zoneId)
        : await findZone(fetchImpl, apiBaseUrl, input.apiToken, input.domain);

      const records: DomainCloudflareRecordResult[] = [];
      for (const record of domainRecordsToCloudflareInputs(input.dnsRecords)) {
        records.push(
          await ensureRecord(fetchImpl, apiBaseUrl, input.apiToken, zone.id, record),
        );
      }

      return { zoneId: zone.id, zoneName: zone.name, records };
    },
  };
}

async function findZone(
  fetchImpl: typeof fetch,
  apiBaseUrl: string,
  apiToken: string,
  domain: string,
): Promise<CloudflareZone> {
  const zones = await cloudflareRequest<CloudflareZone[]>(
    fetchImpl,
    apiBaseUrl,
    apiToken,
    `/zones?name=${encodeURIComponent(domain)}&status=active`,
  );
  const zone = zones.find((item) => item.name === domain) ?? zones[0];
  if (!zone) {
    throw new CloudflareDnsRequestError("cloudflare zone was not found");
  }
  return zone;
}

async function getZone(
  fetchImpl: typeof fetch,
  apiBaseUrl: string,
  apiToken: string,
  zoneId: string,
): Promise<CloudflareZone> {
  return cloudflareRequest<CloudflareZone>(
    fetchImpl,
    apiBaseUrl,
    apiToken,
    `/zones/${encodeURIComponent(zoneId)}`,
  );
}

async function ensureRecord(
  fetchImpl: typeof fetch,
  apiBaseUrl: string,
  apiToken: string,
  zoneId: string,
  record: CloudflareRecordInput,
): Promise<DomainCloudflareRecordResult> {
  const query = new URLSearchParams({
    type: record.type,
    name: record.name,
  });
  const existingRecords = await cloudflareRequest<CloudflareDnsRecord[]>(
    fetchImpl,
    apiBaseUrl,
    apiToken,
    `/zones/${encodeURIComponent(zoneId)}/dns_records?${query.toString()}`,
  );
  const existing = existingRecords.find((candidate) =>
    sameCloudflareRecord(candidate, record),
  );
  if (existing) {
    return cloudflareRecordResult(record, "existing");
  }

  await cloudflareRequest<CloudflareDnsRecord>(
    fetchImpl,
    apiBaseUrl,
    apiToken,
    `/zones/${encodeURIComponent(zoneId)}/dns_records`,
    {
      method: "POST",
      body: JSON.stringify({
        type: record.type,
        name: record.name,
        content: record.content,
        ttl: 1,
        ...(record.priority !== undefined ? { priority: record.priority } : {}),
      }),
    },
  );

  return cloudflareRecordResult(record, "created");
}

async function cloudflareRequest<T>(
  fetchImpl: typeof fetch,
  apiBaseUrl: string,
  apiToken: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetchImpl(`${apiBaseUrl}${path}`, {
    method: "GET",
    ...init,
    headers: {
      authorization: `Bearer ${apiToken}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const payload = (await response.json().catch(() => undefined)) as
    | CloudflareApiResponse<T>
    | undefined;
  if (!response.ok || !payload?.success) {
    throw new CloudflareDnsRequestError();
  }
  return payload.result;
}

function domainRecordsToCloudflareInputs(
  dnsRecords: DomainDnsRecords,
): CloudflareRecordInput[] {
  const mx = parseMxRecord(dnsRecords.mx);
  return [
    txtRecord(dnsRecords.ownershipTxt),
    { type: "MX", name: dnsRecords.mx.name, content: mx.exchange, priority: mx.priority },
    txtRecord(dnsRecords.spf),
    txtRecord(dnsRecords.dmarc),
  ];
}

function txtRecord(record: DnsRecord): CloudflareRecordInput {
  return { type: "TXT", name: record.name, content: record.value };
}

function parseMxRecord(record: DnsRecord): { exchange: string; priority: number } {
  const parts = record.value.trim().split(/\s+/);
  if (parts.length > 1 && /^\d+$/.test(parts[0])) {
    return { priority: Number.parseInt(parts[0], 10), exchange: parts[1] };
  }
  return { priority: 10, exchange: parts[0] };
}

function sameCloudflareRecord(
  left: CloudflareDnsRecord,
  right: CloudflareRecordInput,
): boolean {
  return (
    left.type === right.type &&
    normalizeDnsName(left.name) === normalizeDnsName(right.name) &&
    left.content === right.content &&
    (right.priority === undefined || left.priority === right.priority)
  );
}

function cloudflareRecordResult(
  record: CloudflareRecordInput,
  status: DomainCloudflareRecordResult["status"],
): DomainCloudflareRecordResult {
  return {
    type: record.type,
    name: record.name,
    value:
      record.type === "MX" && record.priority !== undefined
        ? `${record.priority} ${record.content}`
        : record.content,
    status,
    ...(record.priority !== undefined ? { priority: record.priority } : {}),
  };
}

function normalizeDnsName(value: string): string {
  return value.trim().replace(/\.$/, "").toLowerCase();
}
