import { describe, expect, it } from "vitest";
import { formatAccountCsvImportIssue } from "./csvImportIssues";

describe("formatAccountCsvImportIssue", () => {
  it("turns backend CSV validation strings into user-facing copy", () => {
    expect(formatAccountCsvImportIssue("email is invalid")).toBe(
      "邮箱地址格式不正确",
    );
    expect(
      formatAccountCsvImportIssue(
        "gmail must be added with web login, not CSV import",
      ),
    ).toBe("Gmail 请逐个网页登录，不能用 CSV 批量导入。");
  });
});
