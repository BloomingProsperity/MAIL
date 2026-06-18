import type { ImapSmtpOnboardingInput } from "../../lib/emailHubApi";

export interface ProtonBridgeServerFields {
  receiveHost: string;
  receivePort: string;
  receiveSecure: boolean;
  sendHost: string;
  sendPort: string;
  sendSecure: boolean;
}

export const defaultProtonBridgeServerFields: ProtonBridgeServerFields = {
  receiveHost: "",
  receivePort: "1143",
  receiveSecure: false,
  sendHost: "",
  sendPort: "1025",
  sendSecure: false,
};

export function buildProtonBridgeOnboardingInput(input: {
  email: string;
  provider: string;
  username: string;
  secret: string;
  fields: ProtonBridgeServerFields;
}): ImapSmtpOnboardingInput | undefined {
  const email = input.email.trim();
  const username = input.username.trim();
  const secret = input.secret.trim();
  const receiveHost = input.fields.receiveHost.trim();
  const sendHost = input.fields.sendHost.trim();
  const receivePort = toServerPort(input.fields.receivePort);
  const sendPort = toServerPort(input.fields.sendPort);

  if (!email || !username || !secret) {
    return undefined;
  }

  const hasBridgeOverride = Boolean(receiveHost || sendHost);
  if (!hasBridgeOverride) {
    return {
      email,
      provider: input.provider,
      username,
      secret,
    };
  }

  if (!receiveHost || !sendHost || !receivePort || !sendPort) {
    return undefined;
  }

  return {
    email,
    provider: input.provider,
    imap: {
      host: receiveHost,
      port: receivePort,
      secure: input.fields.receiveSecure,
      username,
      secret,
    },
    smtp: {
      host: sendHost,
      port: sendPort,
      secure: input.fields.sendSecure,
      username,
      secret,
    },
  };
}

function toServerPort(value: string): number | undefined {
  const port = Number(value.trim());
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined;
}
