export type GatekeeperMode = "before_inbox" | "inside_email" | "off_accept_all";

export interface GatekeeperSettingsDto {
  accountId: string;
  mode: GatekeeperMode;
  updatedAt?: string;
}

export interface GatekeeperSettingsStore {
  getSettings(input: {
    accountId: string;
  }): Promise<GatekeeperSettingsDto | undefined>;
  setMode(input: {
    accountId: string;
    mode: GatekeeperMode;
  }): Promise<GatekeeperSettingsDto>;
}

export interface GatekeeperSettingsService {
  getSettings(input: { accountId: string }): Promise<GatekeeperSettingsDto>;
  updateSettings(input: {
    accountId: string;
    mode: GatekeeperMode;
  }): Promise<GatekeeperSettingsDto>;
}

export class InvalidGatekeeperSettingsRequestError extends Error {
  readonly code = "invalid_gatekeeper_settings_request";

  constructor(message = "invalid gatekeeper settings request") {
    super(message);
  }
}

export function createGatekeeperSettingsService(options: {
  store: GatekeeperSettingsStore;
}): GatekeeperSettingsService {
  return {
    async getSettings(input) {
      assertNonEmpty(input.accountId);
      return (
        (await options.store.getSettings({ accountId: input.accountId })) ?? {
          accountId: input.accountId,
          mode: "off_accept_all",
        }
      );
    },

    async updateSettings(input) {
      assertNonEmpty(input.accountId);
      if (!isGatekeeperMode(input.mode)) {
        throw new InvalidGatekeeperSettingsRequestError();
      }

      return options.store.setMode({
        accountId: input.accountId,
        mode: input.mode,
      });
    },
  };
}

export function isGatekeeperMode(value: unknown): value is GatekeeperMode {
  return (
    value === "before_inbox" ||
    value === "inside_email" ||
    value === "off_accept_all"
  );
}

function assertNonEmpty(value: string): void {
  if (!value.trim()) {
    throw new InvalidGatekeeperSettingsRequestError();
  }
}
