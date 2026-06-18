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

export type ProtonBridgeOnboardingResult =
  | { ok: true; input: ImapSmtpOnboardingInput }
  | { ok: false; notice: string };

export function buildProtonBridgeOnboardingInput(input: {
  email: string;
  provider: string;
  username: string;
  secret: string;
  fields: ProtonBridgeServerFields;
}): ImapSmtpOnboardingInput | undefined {
  const result = buildProtonBridgeOnboardingResult({
    ...input,
    title: "Proton Mail",
  });
  return result.ok ? result.input : undefined;
}

export function buildProtonBridgeOnboardingResult(input: {
  email: string;
  provider: string;
  title: string;
  username: string;
  secret: string;
  fields: ProtonBridgeServerFields;
}): ProtonBridgeOnboardingResult {
  const email = input.email.trim();
  const username = input.username.trim();
  const secret = input.secret.trim();
  const receiveHost = input.fields.receiveHost.trim();
  const sendHost = input.fields.sendHost.trim();
  const receivePort = toServerPort(input.fields.receivePort);
  const sendPort = toServerPort(input.fields.sendPort);

  if (!email || !username || !secret) {
    return {
      ok: false,
      notice: `${input.title} 需要先填写邮箱、Bridge 用户名和 Bridge 密码。`,
    };
  }

  const hasBridgeOverride =
    Boolean(receiveHost || sendHost) ||
    input.fields.receivePort !== defaultProtonBridgeServerFields.receivePort ||
    input.fields.sendPort !== defaultProtonBridgeServerFields.sendPort ||
    input.fields.receiveSecure !== defaultProtonBridgeServerFields.receiveSecure ||
    input.fields.sendSecure !== defaultProtonBridgeServerFields.sendSecure;
  if (!hasBridgeOverride) {
    return {
      ok: true,
      input: {
        email,
        provider: input.provider,
        username,
        secret,
      },
    };
  }

  if (!receiveHost || !sendHost) {
    return {
      ok: false,
      notice: `${input.title} 的 Bridge 收信和发信地址需要一起填写，或都留空使用服务器默认配置。`,
    };
  }
  if (!receivePort) {
    return {
      ok: false,
      notice: `${input.title} 的 Bridge 收信端口需要是 1 到 65535 的数字。`,
    };
  }
  if (!sendPort) {
    return {
      ok: false,
      notice: `${input.title} 的 Bridge 发信端口需要是 1 到 65535 的数字。`,
    };
  }

  return {
    ok: true,
    input: {
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
    },
  };
}

function toServerPort(value: string): number | undefined {
  const port = Number(value.trim());
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined;
}
