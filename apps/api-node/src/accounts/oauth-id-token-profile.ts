import type { OAuthProvider } from "./oauth-providers.js";
import type { OAuthAccountProfile } from "./oauth-profile-client.js";

export function profileFromIdToken(
  provider: OAuthProvider,
  idToken: string | undefined,
): OAuthAccountProfile | undefined {
  if (!idToken) {
    return undefined;
  }

  const payload = decodeJwtPayload(idToken);
  if (!payload || !issuerMatchesProvider(provider, payload.iss)) {
    return undefined;
  }

  if (!jwtAudienceMatches(payload.aud, provider.clientId)) {
    return undefined;
  }

  const exp = readNumber(payload.exp);
  if (exp !== undefined && exp * 1000 <= Date.now()) {
    return undefined;
  }

  const email = profileEmail(provider.provider, payload);
  if (!email) {
    return undefined;
  }

  return {
    email,
    ...(readString(payload.name) ? { displayName: readString(payload.name) } : {}),
  };
}

function issuerMatchesProvider(
  provider: OAuthProvider,
  issuer: unknown,
): boolean {
  const value = readString(issuer);
  if (!value) {
    return false;
  }

  if (provider.provider === "gmail") {
    return value === "https://accounts.google.com" || value === "accounts.google.com";
  }

  return (
    value.startsWith("https://login.microsoftonline.com/") &&
    value.endsWith("/v2.0")
  );
}

function profileEmail(
  provider: OAuthProvider["provider"],
  payload: Record<string, unknown>,
): string | undefined {
  if (provider === "gmail") {
    return readString(payload.email);
  }

  return (
    readString(payload.email) ??
    readString(payload.preferred_username) ??
    readString(payload.upn)
  );
}

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const [, payload] = token.split(".");
  if (!payload) {
    return undefined;
  }

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return decoded && typeof decoded === "object" && !Array.isArray(decoded)
      ? (decoded as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function jwtAudienceMatches(value: unknown, clientId: string): boolean {
  if (typeof value === "string") {
    return value === clientId;
  }

  return Array.isArray(value) && value.includes(clientId);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
