import type {
  DomainAliasDto,
  DomainCatchAllMode,
  DomainCatchAllRuleDto,
  DomainCatchAllRuleResponse,
  DomainDeliveryLogDto,
  DomainDestinationDto,
  DomainDto,
  Page,
} from "./emailHubApi";

export interface DomainAliasApiClient {
  createDomain(input: { domain: string }): Promise<DomainDto>;
  listDomains(): Promise<Page<DomainDto>>;
  verifyDomain(input: { domainId: string }): Promise<DomainDto>;
  configureDomainCloudflare(input: {
    domainId: string;
    apiToken: string;
    zoneId?: string;
  }): Promise<DomainCloudflareSetupResultDto>;
  createDomainDestination(input: {
    domainId: string;
    email: string;
  }): Promise<DomainDestinationDto>;
  listDomainDestinations(input: {
    domainId: string;
  }): Promise<Page<DomainDestinationDto>>;
  createDomainAlias(input: {
    domainId: string;
    localPart: string;
    destinationIds: string[];
  }): Promise<DomainAliasDto>;
  listDomainAliases(input: {
    domainId: string;
  }): Promise<Page<DomainAliasDto>>;
  setDomainCatchAll(input: {
    domainId: string;
    mode: DomainCatchAllMode;
    destinationIds?: string[];
  }): Promise<DomainCatchAllRuleDto>;
  getDomainCatchAll(input: {
    domainId: string;
  }): Promise<DomainCatchAllRuleResponse>;
  listDomainDeliveryLogs(input: {
    domainId: string;
    limit?: number;
  }): Promise<Page<DomainDeliveryLogDto>>;
}

export interface DomainCloudflareSetupResultDto {
  zoneId: string;
  zoneName: string;
  records: DomainCloudflareRecordDto[];
}

export interface DomainCloudflareRecordDto {
  type: "TXT" | "MX";
  name: string;
  value: string;
  status: "created" | "existing";
  priority?: number;
}

interface DomainAliasApiClientOptions {
  request<T>(path: string, init?: RequestInit): Promise<T>;
}

export function createDomainAliasApiClient(
  options: DomainAliasApiClientOptions,
): DomainAliasApiClient {
  const { request } = options;

  return {
    createDomain(input) {
      return request<DomainDto>("/api/domains", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },

    listDomains() {
      return request<Page<DomainDto>>("/api/domains");
    },

    verifyDomain(input) {
      return request<DomainDto>(
        `/api/domains/${encodePath(input.domainId)}/verify`,
        { method: "POST" },
      );
    },

    configureDomainCloudflare(input) {
      return request<DomainCloudflareSetupResultDto>(
        `/api/domains/${encodePath(input.domainId)}/cloudflare/dns-records`,
        {
          method: "POST",
          body: JSON.stringify(
            cleanObject({
              apiToken: input.apiToken,
              zoneId: input.zoneId,
            }),
          ),
        },
      );
    },

    createDomainDestination(input) {
      return request<DomainDestinationDto>(
        `/api/domains/${encodePath(input.domainId)}/destinations`,
        {
          method: "POST",
          body: JSON.stringify({ email: input.email }),
        },
      );
    },

    listDomainDestinations(input) {
      return request<Page<DomainDestinationDto>>(
        `/api/domains/${encodePath(input.domainId)}/destinations`,
      );
    },

    createDomainAlias(input) {
      return request<DomainAliasDto>(
        `/api/domains/${encodePath(input.domainId)}/aliases`,
        {
          method: "POST",
          body: JSON.stringify({
            localPart: input.localPart,
            destinationIds: input.destinationIds,
          }),
        },
      );
    },

    listDomainAliases(input) {
      return request<Page<DomainAliasDto>>(
        `/api/domains/${encodePath(input.domainId)}/aliases`,
      );
    },

    setDomainCatchAll(input) {
      return request<DomainCatchAllRuleDto>(
        `/api/domains/${encodePath(input.domainId)}/catch-all`,
        {
          method: "PUT",
          body: JSON.stringify(
            cleanObject({
              mode: input.mode,
              destinationIds: input.destinationIds,
            }),
          ),
        },
      );
    },

    getDomainCatchAll(input) {
      return request<DomainCatchAllRuleResponse>(
        `/api/domains/${encodePath(input.domainId)}/catch-all`,
      );
    },

    listDomainDeliveryLogs(input) {
      const params = new URLSearchParams();
      if (input.limit !== undefined) {
        params.set("limit", String(input.limit));
      }
      const query = params.toString();
      return request<Page<DomainDeliveryLogDto>>(
        `/api/domains/${encodePath(input.domainId)}/delivery-logs${query ? `?${query}` : ""}`,
      );
    },
  };
}

function encodePath(value: string): string {
  return encodeURIComponent(value);
}

function cleanObject<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}
