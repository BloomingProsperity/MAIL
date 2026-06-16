import { describe, expect, it } from "vitest";

import { createMailNavigationSummaryService } from "../src/mail-navigation/navigation-summary";

describe("mail navigation summary", () => {
  it("groups connected accounts into provider families for the Add Mail sidebar", async () => {
    const service = createMailNavigationSummaryService({
      async listProviderCounts() {
        return [
          { provider: "gmail", count: 2 },
          { provider: "outlook", count: 1 },
          { provider: "icloud", count: 1 },
          { provider: "163", count: 1 },
          { provider: "qq", count: 1 },
          { provider: "proton_bridge", count: 1 },
          { provider: "custom", count: 3 },
          { provider: "custom_domain", count: 4 },
        ];
      },
      async listQuickCategoryCounts() {
        return [];
      },
    });

    await expect(service.getSummary()).resolves.toMatchObject({
      providerGroups: [
        { id: "gmail", label: "Gmail", count: 2 },
        { id: "outlook", label: "Outlook", count: 1 },
        { id: "icloud", label: "iCloud", count: 1 },
        { id: "domestic", label: "163 / QQ", count: 2 },
        { id: "proton", label: "Proton", count: 1 },
        { id: "domain", label: "个人域名", count: 7 },
      ],
    });
  });

  it("keeps built-in saved views stable while filling backend counts", async () => {
    const service = createMailNavigationSummaryService({
      async listProviderCounts() {
        return [];
      },
      async listQuickCategoryCounts() {
        return [
          { id: "codes", count: 18 },
          { id: "receipts", count: 24 },
          { id: "shipping", count: 21 },
          { id: "newsletters", count: 67 },
          { id: "needs_reply", count: 6 },
          { id: "large_attachments", count: 9 },
        ];
      },
    });

    const summary = await service.getSummary();

    expect(summary.quickCategories.map((category) => category.id)).toEqual([
      "codes",
      "receipts",
      "meetings",
      "travel",
      "shipping",
      "notifications",
      "newsletters",
      "needs_reply",
      "large_attachments",
    ]);
    expect(summary.quickCategories).toEqual(
      expect.arrayContaining([
        { id: "codes", label: "验证码", count: 18, tone: "blue" },
        { id: "receipts", label: "发票/账单", count: 24, tone: "green" },
        { id: "shipping", label: "快递/物流", count: 21, tone: "yellow" },
        { id: "meetings", label: "会议/日程", count: 0, tone: "purple" },
        { id: "newsletters", label: "订阅/营销", count: 67, tone: "purple" },
        { id: "needs_reply", label: "待回复", count: 6, tone: "coral" },
        { id: "large_attachments", label: "大附件", count: 9, tone: "blue" },
      ]),
    );
  });

  it("appends dynamic Hermes saved views after built-in categories", async () => {
    const service = createMailNavigationSummaryService({
      async listProviderCounts() {
        return [];
      },
      async listQuickCategoryCounts() {
        return [
          { id: "codes", count: 18 },
          { id: "hermes_contract", count: 3 },
        ];
      },
      async listQuickCategories() {
        return [
          { id: "codes", label: "验证码覆盖", tone: "coral" },
          { id: "hermes_contract", label: "合同", tone: "blue" },
        ];
      },
    });

    const summary = await service.getSummary();

    expect(summary.quickCategories.find((item) => item.id === "codes")).toEqual({
      id: "codes",
      label: "验证码",
      count: 18,
      tone: "blue",
    });
    expect(summary.quickCategories.at(-1)).toEqual({
      id: "hermes_contract",
      label: "合同",
      count: 3,
      tone: "blue",
    });
  });
});
