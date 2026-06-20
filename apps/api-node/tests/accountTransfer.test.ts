import { describe, expect, it } from "vitest";

import { createAccountTransferService } from "../src/accounts/account-transfer";

describe("account transfer service", () => {
  it("exports account configuration without tokens or passwords", async () => {
    const service = createAccountTransferService({
      createId: () => "task_unused",
      now: () => "2026-06-13T08:00:00.000Z",
      accountSource: {
        async listTransferAccounts(input) {
          expect(input).toEqual({ accountIds: ["acc_1", "acc_2"] });
          return [
            {
              id: "acc_1",
              email: "support@qq.com",
              provider: "qq",
              authMethod: "password",
              displayName: "Support",
              engineProvider: "emailengine",
              labels: ["support"],
              group: "ops",
              notes: "primary support",
              unsafePayload: {
                secret: "qq-auth-code",
                password: "mail-password",
              },
            },
            {
              id: "acc_2",
              email: "boss@gmail.com",
              provider: "gmail",
              authMethod: "oauth",
              displayName: "Boss",
              engineProvider: "native",
              unsafePayload: {
                refreshToken: "refresh-token",
                access_token: "access-token",
              },
            },
          ];
        },
      },
      taskStore: {
        async createTask() {
          throw new Error("not used");
        },
      },
    });

    const result = await service.exportConfig({
      accountIds: ["acc_1", "acc_2"],
    });

    expect(result).toEqual({
      schemaVersion: 1,
      exportedAt: "2026-06-13T08:00:00.000Z",
      accounts: [
        {
          id: "acc_1",
          email: "support@qq.com",
          provider: "qq",
          authMethod: "password",
          displayName: "Support",
          engineProvider: "emailengine",
          labels: ["support"],
          group: "ops",
          notes: "primary support",
        },
        {
          id: "acc_2",
          email: "boss@gmail.com",
          provider: "gmail",
          authMethod: "oauth",
          displayName: "Boss",
          engineProvider: "native",
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("qq-auth-code");
    expect(JSON.stringify(result)).not.toContain("mail-password");
    expect(JSON.stringify(result)).not.toContain("refresh-token");
    expect(JSON.stringify(result)).not.toContain("access-token");
  });

  it("imports account configuration as reauthorization tasks", async () => {
    const createdTasks: unknown[] = [];
    const ids = ["task_password", "task_oauth"];
    const service = createAccountTransferService({
      createId: () => ids.shift() ?? "extra",
      now: () => "2026-06-13T08:00:00.000Z",
      accountSource: {
        async listTransferAccounts() {
          throw new Error("not used");
        },
      },
      taskStore: {
        async createTask(input) {
          createdTasks.push(input);
          return input;
        },
      },
    });

    const result = await service.importConfig({
      package: {
        schemaVersion: 1,
        exportedAt: "2026-06-12T10:00:00.000Z",
        accounts: [
          {
            id: "acc_import_password",
            email: "support@qq.com",
            provider: "qq",
            authMethod: "password",
            displayName: "Support",
            engineProvider: "emailengine",
            providerPreset: "qq",
            username: "support@qq.com",
            labels: ["support"],
            group: "ops",
          },
          {
            id: "acc_import_oauth",
            email: "boss@gmail.com",
            provider: "gmail",
            authMethod: "oauth",
            displayName: "Boss",
            engineProvider: "native",
          },
        ],
      },
    });

    expect(result).toEqual({
      importedTaskCount: 2,
      reauthRequiredCount: 2,
      tasks: [
        {
          id: "task_password",
          email: "support@qq.com",
          provider: "qq",
          authMethod: "password",
          status: "pending",
          payload: {
            source: "account_transfer_import",
            transferVersion: 1,
            reauthRequired: true,
            accountId: "acc_import_password",
            displayName: "Support",
            engineProvider: "emailengine",
            providerPreset: "qq",
            username: "support@qq.com",
            labels: ["support"],
            group: "ops",
          },
        },
        {
          id: "task_oauth",
          email: "boss@gmail.com",
          provider: "gmail",
          authMethod: "oauth",
          status: "pending",
          payload: {
            source: "account_transfer_import",
            transferVersion: 1,
            reauthRequired: true,
            accountId: "acc_import_oauth",
            displayName: "Boss",
            engineProvider: "native",
            loginHint: "boss@gmail.com",
          },
        },
      ],
    });
    expect(createdTasks).toEqual(result.tasks);
  });
});
