import type { IncomingMessage, ServerResponse } from "node:http";

import {
  InvalidDomainAliasRequestError,
  type CatchAllMode,
  type DomainAliasService,
} from "../domains/domain-alias.js";

type DomainAliasRoute =
  | { action: "list_domains" }
  | { action: "verify_domain"; domainId: string }
  | { action: "cloudflare_dns"; domainId: string }
  | { action: "destinations"; domainId: string }
  | { action: "aliases"; domainId: string }
  | { action: "set_catch_all"; domainId: string }
  | { action: "list_delivery_logs"; domainId: string; limit: number };

export async function handleDomainAliasRoute(input: {
  request: IncomingMessage;
  response: ServerResponse;
  service?: DomainAliasService;
  readBody: () => Promise<string>;
}): Promise<boolean> {
  const route = parseDomainAliasRoute(input.request.url);
  if (!route) {
    return false;
  }

  if (!input.service) {
    writeJson(input.response, 503, { error: "domain_alias_unavailable" });
    return true;
  }

  const method = input.request.method;
  if (route.action === "list_domains" && method === "GET") {
    writeJson(input.response, 200, await input.service.listDomains());
    return true;
  }

  if (route.action === "list_domains" && method === "POST") {
    const result = await input.service.createDomain(
      parseCreateDomainInput(await input.readBody()),
    );
    writeJson(input.response, 201, result);
    return true;
  }

  if (route.action === "verify_domain" && method === "POST") {
    const result = await input.service.verifyDomain({
      domainId: route.domainId,
    });
    writeJson(input.response, 200, result);
    return true;
  }

  if (route.action === "cloudflare_dns" && method === "POST") {
    const result = await input.service.configureDomainCloudflare(
      parseCloudflareDnsInput(route.domainId, await input.readBody()),
    );
    writeJson(input.response, 200, result);
    return true;
  }

  if (route.action === "destinations" && method === "POST") {
    const result = await input.service.createDestination(
      parseCreateDestinationInput(route.domainId, await input.readBody()),
    );
    writeJson(input.response, 201, result);
    return true;
  }

  if (route.action === "destinations" && method === "GET") {
    const result = await input.service.listDestinations({
      domainId: route.domainId,
    });
    writeJson(input.response, 200, result);
    return true;
  }

  if (route.action === "aliases" && method === "POST") {
    const result = await input.service.createAlias(
      parseCreateAliasInput(route.domainId, await input.readBody()),
    );
    writeJson(input.response, 201, result);
    return true;
  }

  if (route.action === "aliases" && method === "GET") {
    const result = await input.service.listAliases({
      domainId: route.domainId,
    });
    writeJson(input.response, 200, result);
    return true;
  }

  if (route.action === "set_catch_all" && method === "GET") {
    const result = await input.service.getCatchAll({
      domainId: route.domainId,
    });
    writeJson(input.response, 200, result);
    return true;
  }

  if (route.action === "set_catch_all" && method === "PUT") {
    const result = await input.service.setCatchAll(
      parseCatchAllInput(route.domainId, await input.readBody()),
    );
    writeJson(input.response, 200, result);
    return true;
  }

  if (route.action === "list_delivery_logs" && method === "GET") {
    const result = await input.service.listDeliveryLogs({
      domainId: route.domainId,
      limit: route.limit,
    });
    writeJson(input.response, 200, result);
    return true;
  }

  return false;
}

function parseDomainAliasRoute(requestUrl: string | undefined): DomainAliasRoute | undefined {
  if (!requestUrl) {
    return undefined;
  }

  const url = new URL(requestUrl, "http://localhost");
  if (url.pathname === "/api/domains") {
    return { action: "list_domains" };
  }

  const verifyDomain = /^\/api\/domains\/([^/]+)\/verify$/.exec(url.pathname);
  if (verifyDomain) {
    return {
      action: "verify_domain",
      domainId: decodeURIComponent(verifyDomain[1]),
    };
  }

  const cloudflareDns =
    /^\/api\/domains\/([^/]+)\/cloudflare\/dns-records$/.exec(url.pathname);
  if (cloudflareDns) {
    return {
      action: "cloudflare_dns",
      domainId: decodeURIComponent(cloudflareDns[1]),
    };
  }

  const destinations = /^\/api\/domains\/([^/]+)\/destinations$/.exec(
    url.pathname,
  );
  if (destinations) {
    return {
      action: "destinations",
      domainId: decodeURIComponent(destinations[1]),
    };
  }

  const aliases = /^\/api\/domains\/([^/]+)\/aliases$/.exec(url.pathname);
  if (aliases) {
    return {
      action: "aliases",
      domainId: decodeURIComponent(aliases[1]),
    };
  }

  const catchAll = /^\/api\/domains\/([^/]+)\/catch-all$/.exec(url.pathname);
  if (catchAll) {
    return {
      action: "set_catch_all",
      domainId: decodeURIComponent(catchAll[1]),
    };
  }

  const logs = /^\/api\/domains\/([^/]+)\/delivery-logs$/.exec(url.pathname);
  if (logs) {
    return {
      action: "list_delivery_logs",
      domainId: decodeURIComponent(logs[1]),
      limit: parseDomainAliasLimit(url.searchParams.get("limit")),
    };
  }

  return undefined;
}

function parseCreateDomainInput(body: string): { domain: string } {
  const payload = JSON.parse(body) as { domain?: unknown };
  if (!isNonEmptyString(payload.domain)) {
    throw new InvalidDomainAliasRequestError("domain is required");
  }

  return { domain: payload.domain };
}

function parseCloudflareDnsInput(
  domainId: string,
  body: string,
): { domainId: string; apiToken: string; zoneId?: string } {
  const payload = JSON.parse(body) as {
    apiToken?: unknown;
    zoneId?: unknown;
  };
  if (!isNonEmptyString(domainId) || !isNonEmptyString(payload.apiToken)) {
    throw new InvalidDomainAliasRequestError("cloudflare api token is required");
  }
  if (payload.zoneId !== undefined && typeof payload.zoneId !== "string") {
    throw new InvalidDomainAliasRequestError("cloudflare zone id is invalid");
  }

  return {
    domainId,
    apiToken: payload.apiToken,
    ...(payload.zoneId ? { zoneId: payload.zoneId } : {}),
  };
}

function parseCreateDestinationInput(
  domainId: string,
  body: string,
): { domainId: string; email: string } {
  const payload = JSON.parse(body) as { email?: unknown };
  if (!isNonEmptyString(domainId) || !isNonEmptyString(payload.email)) {
    throw new InvalidDomainAliasRequestError("destination email is required");
  }

  return { domainId, email: payload.email };
}

function parseCreateAliasInput(
  domainId: string,
  body: string,
): { domainId: string; localPart: string; destinationIds: string[] } {
  const payload = JSON.parse(body) as {
    localPart?: unknown;
    destinationIds?: unknown;
  };
  if (!isNonEmptyString(domainId) || !isNonEmptyString(payload.localPart)) {
    throw new InvalidDomainAliasRequestError("alias local part is required");
  }
  if (!isStringArray(payload.destinationIds)) {
    throw new InvalidDomainAliasRequestError("destination ids are required");
  }

  return {
    domainId,
    localPart: payload.localPart,
    destinationIds: payload.destinationIds,
  };
}

function parseCatchAllInput(
  domainId: string,
  body: string,
): { domainId: string; mode: CatchAllMode; destinationIds?: string[] } {
  const payload = JSON.parse(body) as {
    mode?: unknown;
    destinationIds?: unknown;
  };
  if (!isNonEmptyString(domainId) || !isCatchAllMode(payload.mode)) {
    throw new InvalidDomainAliasRequestError("catch-all mode is invalid");
  }
  if (
    payload.destinationIds !== undefined &&
    !isStringArray(payload.destinationIds)
  ) {
    throw new InvalidDomainAliasRequestError("destination ids are invalid");
  }

  return {
    domainId,
    mode: payload.mode,
    ...(payload.destinationIds ? { destinationIds: payload.destinationIds } : {}),
  };
}

function parseDomainAliasLimit(value: string | null): number {
  if (value === null) {
    return 50;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new InvalidDomainAliasRequestError("limit is invalid");
  }

  return parsed;
}

function isCatchAllMode(value: unknown): value is CatchAllMode {
  return (
    value === "reject" ||
    value === "forward" ||
    value === "auto_create" ||
    value === "discard"
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => isNonEmptyString(item))
  );
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
