import { describe, expect, it } from "vitest";

import {
  createLabelService,
  InvalidLabelRequestError,
  type LabelStore,
} from "../src/labels/labels";

describe("label service", () => {
  it("normalizes and upserts account-scoped labels", async () => {
    const calls: unknown[] = [];
    const service = createLabelService({
      createId: () => "label_1",
      store: {
        async listLabels() {
          return { items: [] };
        },
        async upsertLabel(input) {
          calls.push(input);
          return {
            id: input.id,
            accountId: input.accountId,
            name: input.name,
            color: input.color,
            messageCount: 0,
            createdAt: "2026-06-13T10:00:00.000Z",
          };
        },
      },
    });

    await expect(
      service.upsertLabel({
        accountId: "account_1",
        name: "  验证码   分组  ",
        color: "blue",
      }),
    ).resolves.toMatchObject({
      id: "label_1",
      name: "验证码 分组",
      color: "blue",
    });
    expect(calls).toEqual([
      {
        id: "label_1",
        accountId: "account_1",
        name: "验证码 分组",
        color: "blue",
      },
    ]);
  });

  it("rejects invalid labels before touching the store", async () => {
    const store: LabelStore = {
      async listLabels() {
        throw new Error("not used");
      },
      async upsertLabel() {
        throw new Error("not used");
      },
    };
    const service = createLabelService({
      createId: () => "unused",
      store,
    });

    await expect(
      service.upsertLabel({ accountId: "", name: "验证码" }),
    ).rejects.toBeInstanceOf(InvalidLabelRequestError);
    await expect(
      service.upsertLabel({ accountId: "account_1", name: "", color: "blue" }),
    ).rejects.toBeInstanceOf(InvalidLabelRequestError);
    await expect(
      service.upsertLabel({
        accountId: "account_1",
        name: "验证码",
        color: "orange" as never,
      }),
    ).rejects.toBeInstanceOf(InvalidLabelRequestError);
  });
});
