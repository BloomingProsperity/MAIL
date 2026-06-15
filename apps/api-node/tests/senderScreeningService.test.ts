import { describe, expect, it } from "vitest";

import {
  createSenderScreeningService,
  type SenderScreeningSettingsReader,
} from "../src/gatekeeper/sender-screening-service.js";
import {
  InvalidSenderScreeningRequestError,
  type SenderScreeningStore,
} from "../src/gatekeeper/sender-screening.js";

describe("sender screening service", () => {
  it("does not list or materialize senders when Gatekeeper is off", async () => {
    const settingsService: SenderScreeningSettingsReader = {
      async getSettings(input) {
        expect(input).toEqual({ accountId: "account_1" });
        return { accountId: "account_1", mode: "off_accept_all" };
      },
    };

    const store: SenderScreeningStore = {
      async listSenders() {
        throw new Error("listSenders should not run when Gatekeeper is off");
      },
      async acceptSender() {
        throw new Error("not used");
      },
      async blockSender() {
        throw new Error("not used");
      },
      async bulkDecideSenders() {
        throw new Error("not used");
      },
      async blockDomain() {
        throw new Error("not used");
      },
    };

    const service = createSenderScreeningService({ store, settingsService });

    await expect(
      service.listSenders({ accountId: "account_1", status: "unknown" }),
    ).resolves.toEqual({ items: [] });
  });

  it("delegates sender listing when Gatekeeper screens before inbox", async () => {
    const calls: unknown[] = [];
    const settingsService: SenderScreeningSettingsReader = {
      async getSettings(input) {
        calls.push({ action: "settings", input });
        return { accountId: "account_1", mode: "before_inbox" };
      },
    };

    const store: SenderScreeningStore = {
      async listSenders(input) {
        calls.push({ action: "list", input });
        return {
          items: [
            {
              senderId: "screen_1",
              email: "new@example.com",
              domain: "example.com",
              status: "unknown",
              messageCount: 1,
              latestMessageId: "message_1",
              bulkAvailable: true,
            },
          ],
        };
      },
      async acceptSender() {
        throw new Error("not used");
      },
      async blockSender() {
        throw new Error("not used");
      },
      async bulkDecideSenders() {
        throw new Error("not used");
      },
      async blockDomain() {
        throw new Error("not used");
      },
    };

    const service = createSenderScreeningService({ store, settingsService });

    await expect(
      service.listSenders({ accountId: "account_1", status: "unknown" }),
    ).resolves.toEqual({
      items: [
        {
          senderId: "screen_1",
          email: "new@example.com",
          domain: "example.com",
          status: "unknown",
          messageCount: 1,
          latestMessageId: "message_1",
          bulkAvailable: true,
        },
      ],
    });
    expect(calls).toEqual([
      { action: "settings", input: { accountId: "account_1" } },
      { action: "list", input: { accountId: "account_1", status: "unknown" } },
    ]);
  });

  it("rejects bulk sender decisions when Gatekeeper is off", async () => {
    const settingsService: SenderScreeningSettingsReader = {
      async getSettings(input) {
        expect(input).toEqual({ accountId: "account_1" });
        return { accountId: "account_1", mode: "off_accept_all" };
      },
    };

    const store: SenderScreeningStore = {
      async listSenders() {
        throw new Error("not used");
      },
      async acceptSender() {
        throw new Error("not used");
      },
      async blockSender() {
        throw new Error("not used");
      },
      async bulkDecideSenders() {
        throw new Error("bulkDecideSenders should not run when Gatekeeper is off");
      },
      async blockDomain() {
        throw new Error("not used");
      },
    };

    const service = createSenderScreeningService({ store, settingsService });

    await expect(
      service.bulkDecideSenders({
        accountId: "account_1",
        senderIds: ["screen_1"],
        action: "accept",
      }),
    ).rejects.toBeInstanceOf(InvalidSenderScreeningRequestError);
  });

  it("rejects sender and domain decisions when Gatekeeper is off", async () => {
    const settingsCalls: unknown[] = [];
    const settingsService: SenderScreeningSettingsReader = {
      async getSettings(input) {
        settingsCalls.push(input);
        return { accountId: "account_1", mode: "off_accept_all" };
      },
    };
    const store: SenderScreeningStore = {
      async listSenders() {
        throw new Error("not used");
      },
      async acceptSender() {
        throw new Error("acceptSender should not run when Gatekeeper is off");
      },
      async blockSender() {
        throw new Error("blockSender should not run when Gatekeeper is off");
      },
      async bulkDecideSenders() {
        throw new Error("not used");
      },
      async blockDomain() {
        throw new Error("blockDomain should not run when Gatekeeper is off");
      },
    };

    const service = createSenderScreeningService({ store, settingsService });

    await expect(
      service.acceptSender({ accountId: "account_1", senderId: "screen_1" }),
    ).rejects.toBeInstanceOf(InvalidSenderScreeningRequestError);
    await expect(
      service.blockSender({ accountId: "account_1", senderId: "screen_1" }),
    ).rejects.toBeInstanceOf(InvalidSenderScreeningRequestError);
    await expect(
      service.blockDomain({ accountId: "account_1", domain: "example.com" }),
    ).rejects.toBeInstanceOf(InvalidSenderScreeningRequestError);
    expect(settingsCalls).toEqual([
      { accountId: "account_1" },
      { accountId: "account_1" },
      { accountId: "account_1" },
    ]);
  });

  it("delegates bulk sender decisions only in before-inbox mode", async () => {
    const calls: unknown[] = [];
    const settingsService: SenderScreeningSettingsReader = {
      async getSettings(input) {
        calls.push({ action: "settings", input });
        return { accountId: "account_1", mode: "before_inbox" };
      },
    };

    const store: SenderScreeningStore = {
      async listSenders() {
        throw new Error("not used");
      },
      async acceptSender() {
        throw new Error("not used");
      },
      async blockSender() {
        throw new Error("not used");
      },
      async bulkDecideSenders(input) {
        calls.push({ action: "bulk", input });
        return {
          items: [
            {
              senderId: "screen_1",
              email: "new@example.com",
              domain: "example.com",
              status: "accepted",
              action: "accept",
              eventId: "event_1",
            },
          ],
          missingSenderIds: [],
        };
      },
      async blockDomain() {
        throw new Error("not used");
      },
    };

    const service = createSenderScreeningService({ store, settingsService });

    await expect(
      service.bulkDecideSenders({
        accountId: "account_1",
        senderIds: ["screen_1"],
        action: "accept",
      }),
    ).resolves.toEqual({
      items: [
        {
          senderId: "screen_1",
          email: "new@example.com",
          domain: "example.com",
          status: "accepted",
          action: "accept",
          eventId: "event_1",
        },
      ],
      missingSenderIds: [],
    });
    expect(calls).toEqual([
      { action: "settings", input: { accountId: "account_1" } },
      {
        action: "bulk",
        input: {
          accountId: "account_1",
          senderIds: ["screen_1"],
          action: "accept",
        },
      },
    ]);
  });
});
