import type { GatekeeperSettingsService } from "./settings.js";
import {
  InvalidSenderScreeningRequestError,
  type SenderScreeningStore,
} from "./sender-screening.js";

export type SenderScreeningSettingsReader = Pick<
  GatekeeperSettingsService,
  "getSettings"
>;

export function createSenderScreeningService(options: {
  store: SenderScreeningStore;
  settingsService?: SenderScreeningSettingsReader;
}): SenderScreeningStore {
  return {
    async listSenders(input) {
      const settings = await options.settingsService?.getSettings({
        accountId: input.accountId,
      });

      if (settings?.mode === "off_accept_all") {
        return { items: [] };
      }

      return options.store.listSenders(input);
    },

    async acceptSender(input) {
      await ensureGatekeeperOn(options.settingsService, input.accountId);
      return options.store.acceptSender(input);
    },

    async blockSender(input) {
      await ensureGatekeeperOn(options.settingsService, input.accountId);
      return options.store.blockSender(input);
    },

    async bulkDecideSenders(input) {
      const settings = await options.settingsService?.getSettings({
        accountId: input.accountId,
      });

      if (settings && settings.mode !== "before_inbox") {
        throw new InvalidSenderScreeningRequestError(
          "bulk sender screening is only available in before-inbox mode",
        );
      }

      return options.store.bulkDecideSenders(input);
    },

    async blockDomain(input) {
      await ensureGatekeeperOn(options.settingsService, input.accountId);
      return options.store.blockDomain(input);
    },
  };
}

async function ensureGatekeeperOn(
  settingsService: SenderScreeningSettingsReader | undefined,
  accountId: string,
): Promise<void> {
  const settings = await settingsService?.getSettings({ accountId });
  if (settings?.mode === "off_accept_all") {
    throw new InvalidSenderScreeningRequestError("Gatekeeper is off");
  }
}
