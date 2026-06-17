import { randomUUID } from "node:crypto";

export function resolveSmokeMailboxEmail(input: {
  env: NodeJS.ProcessEnv;
  envKey: string;
  prefix: string;
  createId?: () => string;
}): string {
  const configured = input.env[input.envKey]?.trim();
  if (configured) {
    return configured;
  }

  const createId = input.createId ?? randomUUID;
  return `${input.prefix}-${safeSmokeId(createId())}@example.com`;
}

function safeSmokeId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "mailbox";
}
