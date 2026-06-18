import { describe, expect, it } from "vitest";
import type { HermesEmailSearchQaResult } from "../../lib/emailHubApi";
import { searchLaunchFromHermesResult } from "./hermesSearchLaunch";

describe("hermesSearchLaunch helpers", () => {
  it("maps Hermes search plans into SearchPage launch filters", () => {
    const result = {
      skillRunId: "run_search_1",
      skillId: "email_search_qa",
      answerText: "Found matching invoices.",
      searchQuery: "invoice attachment",
      searchPlan: {
        searchQuery: "invoice attachment",
        quickFilters: ["attachments"],
        qScopes: ["subject", "body"],
        filters: [
          {
            field: "attachment",
            operator: "eq",
            value: true,
            label: "有附件",
          },
        ],
        listMessagesInput: {
          q: "invoice attachment",
          quickFilters: ["attachments"],
          qScopes: ["subject", "body"],
          senderQuery: "billing@example.com",
          recipientQuery: "finance@example.com",
          receivedAfter: "2026-06-01T00:00:00.000Z",
          receivedBefore: "2026-06-18T00:00:00.000Z",
          hasAttachment: true,
          labelIds: ["label_invoice"],
          tagMode: "all",
        },
        explanation: ["Search invoice messages with attachments."],
      },
      citations: [],
      matches: [],
    } satisfies HermesEmailSearchQaResult;

    expect(searchLaunchFromHermesResult(result, "account_1")).toEqual({
      accountId: "account_1",
      quickFilters: ["attachments"],
      qScopes: ["subject", "body"],
      senderQuery: "billing@example.com",
      recipientQuery: "finance@example.com",
      receivedAfter: "2026-06-01T00:00:00.000Z",
      receivedBefore: "2026-06-18T00:00:00.000Z",
      hasAttachment: true,
      labelIds: ["label_invoice"],
      tagMode: "all",
    });
  });

  it("omits absent optional filters for global launches", () => {
    const result = {
      skillRunId: "run_search_2",
      skillId: "email_search_qa",
      answerText: "Found messages.",
      searchQuery: "contract",
      searchPlan: {
        searchQuery: "contract",
        quickFilters: [],
        qScopes: ["sender", "recipients", "subject", "body"],
        filters: [],
        listMessagesInput: { q: "contract" },
        explanation: ["Search contract messages."],
      },
      citations: [],
      matches: [],
    } satisfies HermesEmailSearchQaResult;

    expect(searchLaunchFromHermesResult(result)).toEqual({});
  });
});
