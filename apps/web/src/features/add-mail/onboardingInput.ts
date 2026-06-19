import type { ImapSmtpOnboardingInput } from "../../lib/emailHubApi";
import type { AddMailProviderOption } from "./providerCapabilities";
import {
  buildProtonBridgeOnboardingResult,
  type ProtonBridgeServerFields,
} from "./protonBridgeOnboarding";

export interface CustomServerFields {
  username: string;
  secret: string;
  receiveHost: string;
  receivePort: string;
  receiveSecure: boolean;
  sendHost: string;
  sendPort: string;
  sendSecure: boolean;
}

export const defaultCustomServerFields: CustomServerFields = {
  username: "",
  secret: "",
  receiveHost: "",
  receivePort: "993",
  receiveSecure: true,
  sendHost: "",
  sendPort: "465",
  sendSecure: true,
};

export type OnboardingInputResult =
  | { ok: true; input: ImapSmtpOnboardingInput }
  | { ok: false; notice: string };

export function buildPresetOnboardingInput(
  provider: AddMailProviderOption,
  fields: {
    email: string;
    username: string;
    secret: string;
    bridgeFields: ProtonBridgeServerFields;
  },
): OnboardingInputResult {
  const email = fields.email.trim();
  const username = fields.username.trim();
  const secret = fields.secret.trim();
  if (provider.action === "bridge") {
    return buildProtonBridgeOnboardingResult({
      email,
      provider: provider.provider,
      title: provider.title,
      username,
      secret,
      fields: fields.bridgeFields,
    });
  }

  if (!email || !secret) {
    return {
      ok: false,
      notice: `${provider.title} 需要先填写邮箱和授权码或专用密码。`,
    };
  }

  return {
    ok: true,
    input: {
      email,
      provider: provider.provider,
      secret,
      ...(username ? { username } : {}),
    },
  };
}

export function buildManualOnboardingInput(
  provider: AddMailProviderOption,
  input: { email: string; fields: CustomServerFields },
): OnboardingInputResult {
  const email = input.email.trim();
  const username = input.fields.username.trim() || email;
  const secret = input.fields.secret.trim();
  const receiveHost = input.fields.receiveHost.trim();
  const sendHost = input.fields.sendHost.trim();
  const receivePort = toServerPort(input.fields.receivePort);
  const sendPort = toServerPort(input.fields.sendPort);

  if (!email) {
    return { ok: false, notice: `${provider.title} 需要填写邮箱地址。` };
  }
  if (!username || !secret) {
    return {
      ok: false,
      notice: `${provider.title} 需要填写登录用户名和专用密码。`,
    };
  }
  if (!receiveHost) {
    return { ok: false, notice: `${provider.title} 需要填写收信服务器。` };
  }
  if (!receivePort) {
    return {
      ok: false,
      notice: `${provider.title}的收信端口需要是 1 到 65535 的数字。`,
    };
  }
  if (!sendHost) {
    return { ok: false, notice: `${provider.title} 需要填写发信服务器。` };
  }
  if (!sendPort) {
    return {
      ok: false,
      notice: `${provider.title}的发信端口需要是 1 到 65535 的数字。`,
    };
  }

  return {
    ok: true,
    input: {
      email,
      provider: provider.provider === "custom" ? "custom_domain" : provider.provider,
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

export function toServerPort(value: string): number | undefined {
  const port = Number(value.trim());
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined;
}
