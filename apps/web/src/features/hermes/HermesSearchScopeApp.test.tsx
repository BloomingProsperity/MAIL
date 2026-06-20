import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import type { EmailHubApi, HermesEmailSearchQaResult } from "../../lib/emailHubApi";

describe("Hermes search account scope", () => {
  afterEach(() => {
    sessionStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("keeps Search ordinary and routes Hermes mail search through the dock", async () => {
    const api = createApiFixture();
    vi.mocked(api.searchMailWithHermes).mockResolvedValueOnce(
      searchResult("run_selected", "global contract"),
    );

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    fireEvent.submit(screen.getByRole("search", { name: "全局邮件搜索" }));
    await screen.findByRole("heading", { name: "搜索" });
    expect(screen.queryByLabelText("Hermes 搜索问题")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "打开 Hermes" }));
    fireEvent.change(screen.getByLabelText("Hermes 指令"), {
      target: { value: "所有邮箱里谁发过合同？" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送给 Hermes" }));

    await waitFor(() => {
      expect(api.searchMailWithHermes).toHaveBeenCalledWith({
        accountId: "account_1",
        question: "所有邮箱里谁发过合同？",
        language: "zh-CN",
        limit: 5,
        memoryScope: "sender:client@example.com",
      });
    });

    expect(
      within(screen.getByLabelText("Hermes 搜索回答")).getByText(
        "Found matching messages across accounts.",
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "打开搜索结果" }));
    await waitFor(() => {
      expect(api.listMessages).toHaveBeenLastCalledWith({
        accountId: "account_1",
        hasAttachment: true,
        limit: 50,
        q: "global contract",
        qScopes: ["sender", "recipients", "subject", "body"],
        quickFilters: ["attachments"],
        sort: "time",
      });
    });
  });

  it("ignores stale dock natural-language search results", async () => {
    const api = createApiFixture();
    let resolveOldSearch: (result: HermesEmailSearchQaResult) => void = () => {};
    vi.mocked(api.searchMailWithHermes)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOldSearch = resolve;
          }),
      )
      .mockResolvedValueOnce(
        searchResult("run_new", "new contract", "New answer."),
      );

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    fireEvent.click(screen.getByRole("button", { name: "打开 Hermes" }));
    fireEvent.change(screen.getByLabelText("Hermes 指令"), {
      target: { value: "旧问题" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送给 Hermes" }));
    await waitFor(() => {
      expect(api.searchMailWithHermes).toHaveBeenCalledTimes(1);
    });

    fireEvent.change(screen.getByLabelText("Hermes 指令"), {
      target: { value: "新问题" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送给 Hermes" }));
    expect(await screen.findByText("New answer.")).toBeTruthy();

    await act(async () => {
      resolveOldSearch(searchResult("run_old", "old contract", "Old answer."));
      await Promise.resolve();
    });

    expect(screen.queryByText("Old answer.")).toBeNull();
    expect(screen.getByText("New answer.")).toBeTruthy();
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
          accountId: input.accountId ?? "account_1",
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
    getHermesWorkspaceContext: vi.fn(async () => ({
      generatedAt: "2026-06-13T10:00:00.000Z",
      accountScope: {
        requestedAccountId: "account_1",
        availableAccountIds: ["account_1"],
      },
      accounts: [
        {
          accountId: "account_1",
          email: "me@example.com",
          provider: "custom_domain",
          syncState: "syncing",
          nextAction: "wait_for_sync",
        },
      ],
      navigation: { providerGroups: [], quickCategories: [], labels: [] },
      labels: [],
      rules: [],
      pendingRuleCandidates: [],
      skills: [],
      mailEngine: { readiness: { status: "ready" } },
      operationBoundaries: [],
      unavailableModules: [],
    })),
    searchMailWithHermes: vi.fn(),
  } as unknown as EmailHubApi;
}

function searchResult(
  skillRunId: string,
  searchQuery: string,
  answerText = "Found matching messages across accounts.",
): HermesEmailSearchQaResult {
  return {
    skillRunId,
    skillId: "email_search_qa",
    answerText,
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
