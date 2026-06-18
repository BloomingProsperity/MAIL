import { describe, expect, it } from "vitest";
import { detectHermesCommandIntent } from "./hermesCommandIntent";

describe("detectHermesCommandIntent", () => {
  it("keeps explicit mail searches on the search path", () => {
    expect(detectHermesCommandIntent("搜索带客户标签的合同")).toEqual({
      kind: "search",
    });
    expect(detectHermesCommandIntent("find invoices from Alice")).toEqual({
      kind: "search",
    });
  });

  it("routes automation prompts to rule creation", () => {
    expect(
      detectHermesCommandIntent("把验证码邮件自动放到左侧验证码"),
    ).toEqual({
      kind: "rule",
    });
    expect(
      detectHermesCommandIntent("create a rule to label invoices"),
    ).toEqual({
      kind: "rule",
    });
  });

  it("routes current-message assistant prompts to reader actions", () => {
    expect(detectHermesCommandIntent("总结这封邮件")).toEqual({
      kind: "reader",
      action: "summarize_message",
    });
    expect(detectHermesCommandIntent("translate this email to English")).toEqual({
      kind: "reader",
      action: "translate_message",
    });
    expect(detectHermesCommandIntent("帮我回复这封邮件")).toEqual({
      kind: "reader",
      action: "draft_reply",
    });
  });

  it("uses search as the fallback intent", () => {
    expect(detectHermesCommandIntent("客户上次提到的合同是什么")).toEqual({
      kind: "search",
    });
  });
});
