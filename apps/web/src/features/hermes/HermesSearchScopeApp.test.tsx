import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import type { EmailHubApi, HermesEmailSearchQaResult } from "../../lib/emailHubApi";

describe("Hermes search account scope", () => {
  afterEach(() => {
    sessionStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("keeps all-account Search workspace prompts global", async () => {
    const api = createApiFixture();
    vi.mocked(api.searchMailWithHermes).mockResolvedValueOnce(
      searchResult("run_global", "global contract"),
    );

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    fireEvent.click(
      within(screen.getByRole("navigation")).getByRole("button", {
        name: "搜索",
      }),
    );
    fireEvent.change(screen.getByLabelText("Hermes 搜索问题"), {
      target: { value: "所有邮箱里谁发过合同？" },
    });
    fireEvent.submit(screen.getByRole("form", { name: "Hermes 自然语言搜索" }));

    await waitFor(() => {
      expect(api.searchMailWithHermes).toHaveBeenCalled();
    });
    const hermesInput = vi.mocked(api.searchMailWithHermes).mock.calls[0][0];
    expect(hermesInput).toEqual({
      question: "所有邮箱里谁发过合同？",
      language: "zh-CN",
      limit: 10,
      memoryScope: "global",
    });
    await waitFor(() => {
      expect(api.listMessages).toHaveBeenLastCalledWith({
        limit: 50,
        q: "global contract",
        sort: "smart",
        quickFilters: ["attachments"],
        qScopes: ["sender", "recipients", "subject", "body"],
        hasAttachment: true,
      });
    });
  });
});

function createApiFixture(): EmailHubApi {
  return {
    getMailNavigationSummary: vi.fn(async () => ({
      providerGroups: [],
      quickCategories: [],
      labels: [],
    })),
    listSyncCenterAccounts: vi.fn(async () => ({
      items: [
        {
          accountId: "account_1",
          email: "me@example.com",
          provider: "custom_domain",
          syncState: "syncing",
          nextAction: "wait_for_sync",
        },
      ],
    })),
    listMailboxes: vi.fn(async () => ({
      items: [{ id: "mailbox_inbox", name: "收件箱", messageCount: 1 }],
    })),
    listMessages: vi.fn(async (input) => ({
      items: [
        {
          id: input.q ? "message_search" : "message_1",
          accountId: input.accountId ?? "account_2",
          subject: input.q ? "Cross-account contract" : "Live subject",
          from: { email: "client@example.com", name: "Live Client" },
          receivedAt: "2026-06-13T10:00:00.000Z",
          snippet: input.q ? "Matched by Hermes" : "Live snippet",
          unread: true,
          starred: false,
          mailboxIds: ["mailbox_inbox"],
          attachmentCount: input.q ? 1 : 0,
          classification: {
            bucket: "P1 Urgent",
            priorityScore: input.q ? 90 : 96,
            reasons: input.q ? ["Hermes search"] : ["Direct to you"],
          },
        },
      ],
    })),
    getMessage: vi.fn(async () => ({
      id: "message_1",
      accountId: "account_1",
      subject: "Live subject",
      from: { email: "client@example.com", name: "Live Client" },
      receivedAt: "2026-06-13T10:00:00.000Z",
      snippet: "Live snippet",
      unread: true,
      starred: false,
      mailboxIds: ["mailbox_inbox"],
      attachmentCount: 0,
      classification: {
        bucket: "P1 Urgent",
        priorityScore: 96,
        reasons: ["Direct to you"],
      },
      to: ["me@example.com"],
      cc: [],
      bodyText: "Live body from backend",
      attachments: [],
    })),
    listLabels: vi.fn(async () => ({ items: [] })),
    listSendIdentities: vi.fn(async () => ({ items: [] })),
    listMailDrafts: vi.fn(async () => ({ items: [] })),
    listOutbox: vi.fn(async () => ({ items: [] })),
    searchMailWithHermes: vi.fn(),
  } as unknown as EmailHubApi;
}

function searchResult(
  skillRunId: string,
  searchQuery: string,
): HermesEmailSearchQaResult {
  return {
    skillRunId,
    skillId: "email_search_qa",
    answerText: "Found matching messages across accounts.",
    searchQuery,
    searchPlan: {
      searchQuery,
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
      listMessagesInput: {
        q: searchQuery,
        quickFilters: ["attachments"],
        qScopes: ["sender", "recipients", "subject", "body"],
        hasAttachment: true,
      },
      explanation: ["Search all synced accounts."],
    },
    citations: [],
    matches: [],
  };
}
