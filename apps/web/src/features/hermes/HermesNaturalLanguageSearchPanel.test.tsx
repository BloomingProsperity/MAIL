import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HermesNaturalLanguageSearchPanel,
  HermesSearchAnswerPanel,
} from "./HermesNaturalLanguageSearchPanel";
import type { HermesEmailSearchQaResult } from "../../lib/emailHubApi";

afterEach(() => {
  cleanup();
});

describe("HermesNaturalLanguageSearchPanel", () => {
  it("routes natural-language query changes and submits to Hermes", () => {
    const onQueryChange = vi.fn();
    const onSubmit = vi.fn();

    render(
      <HermesNaturalLanguageSearchPanel
        query="合同在哪里"
        busy={false}
        onQueryChange={onQueryChange}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText("Hermes 搜索问题"), {
      target: { value: "客户上次提到的合同在哪里？" },
    });
    fireEvent.submit(
      screen.getByRole("form", { name: "Hermes 自然语言搜索" }),
    );

    expect(onQueryChange).toHaveBeenCalledWith(
      "客户上次提到的合同在哪里？",
    );
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("disables the submit action while Hermes is searching", () => {
    render(
      <HermesNaturalLanguageSearchPanel
        query="发票"
        busy
        onQueryChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", {
      name: "Hermes 搜索中",
    }) as HTMLButtonElement;

    expect(button.disabled).toBe(true);
  });

  it("renders Hermes search answers with citations as safe text", () => {
    render(
      <HermesSearchAnswerPanel
        result={searchResult({
          answerText: '<img src=x onerror="window.__xss=1">客户合同在这里。',
        })}
        formatDate={() => "2026年6月18日"}
      />,
    );

    expect(screen.getByLabelText("Hermes 搜索回答")).toBeTruthy();
    expect(
      screen.getByText('<img src=x onerror="window.__xss=1">客户合同在这里。'),
    ).toBeTruthy();
    expect(screen.getByLabelText("Hermes 搜索条件").textContent).toContain(
      "有附件",
    );
    expect(screen.getByText("合同附件")).toBeTruthy();
    expect(screen.getByText(/Lina · 2026年6月18日 · 重要/)).toBeTruthy();
    expect(screen.getByText("命中片段")).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
  });
});

function searchResult(
  input: Partial<HermesEmailSearchQaResult> = {},
): HermesEmailSearchQaResult {
  return {
    skillRunId: "run_1",
    skillId: "email_search_qa",
    answerText: "客户合同在这里。",
    searchQuery: "signed contract",
    searchPlan: {
      searchQuery: "signed contract",
      quickFilters: ["attachments"],
      qScopes: ["sender", "recipients", "subject", "body"],
      filters: [
        {
          field: "hasAttachment",
          operator: "eq",
          value: true,
          label: "有附件",
        },
      ],
      listMessagesInput: { q: "signed contract" },
      explanation: ["限制为带附件的合同邮件。"],
    },
    citations: [
      {
        resultIndex: 0,
        messageId: "message_1",
        accountId: "account_1",
        subject: "合同附件",
        from: { email: "lina@example.com", name: "Lina" },
        receivedAt: "2026-06-18T01:00:00.000Z",
        snippet: "命中片段",
        bucket: "重要",
        reasons: ["Hermes match"],
      },
    ],
    matches: [],
    ...input,
  };
}
