import { describe, expect, it } from "vitest";

import {
  findBuiltInSavedView,
  getBuiltInSavedViews,
  getSavedViewKeywordValuesSql,
} from "../src/mail-navigation/saved-views";

describe("built-in saved views", () => {
  it("defines stable virtual categories without moving provider folders", () => {
    const views = getBuiltInSavedViews();

    expect(views.map((view) => view.id)).toEqual([
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
    expect(views).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "codes",
          label: "验证码",
          tone: "blue",
          kind: "keyword",
          keywords: expect.arrayContaining(["验证码", "verification", "otp"]),
        }),
        expect.objectContaining({
          id: "needs_reply",
          label: "待回复",
          kind: "message_fact",
          keywords: expect.arrayContaining(["待回复", "reply"]),
        }),
        expect.objectContaining({
          id: "large_attachments",
          label: "大附件",
          kind: "message_fact",
          minAttachmentCount: 1,
        }),
      ]),
    );
  });

  it("builds escaped SQL VALUES for keyword-backed view counts", () => {
    const sql = getSavedViewKeywordValuesSql();

    expect(sql).toContain("'codes'");
    expect(sql).toContain("'验证码'");
    expect(sql).toContain("'发票'");
    expect(sql).toContain("'newsletter'");
    expect(sql).not.toContain("undefined");
  });

  it("resolves built-in saved views by stable id without exposing mutable catalog state", () => {
    const codes = findBuiltInSavedView("codes");

    expect(codes).toMatchObject({
      id: "codes",
      label: "验证码",
      keywords: expect.arrayContaining(["验证码", "otp"]),
    });
    expect(findBuiltInSavedView("unknown")).toBeUndefined();

    codes?.keywords.push("mutated");
    expect(findBuiltInSavedView("codes")?.keywords).not.toContain("mutated");
  });
});
