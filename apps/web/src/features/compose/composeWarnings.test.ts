import { describe, expect, it } from "vitest";

import { formatComposeWarnings } from "./composeWarnings";

describe("compose warning labels", () => {
  it("formats send-safety warning codes as Chinese review text", () => {
    expect(
      formatComposeWarnings([
        "duplicate_recipient",
        "possible_missing_attachment",
        "external_recipient_warning",
      ]),
    ).toBe("收件人重复，可能缺少附件，包含外部收件人");
  });

  it("keeps existing required-field warnings readable", () => {
    expect(
      formatComposeWarnings([
        "missing_recipient",
        "missing_body",
        "missing_subject",
        "large_body",
      ]),
    ).toBe("缺少收件人，缺少正文，缺少主题，正文过大");
  });
});
