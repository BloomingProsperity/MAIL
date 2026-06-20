import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { createApiFixture } from "./test/appTestFixtures";
import type { EmailHubApi } from "./lib/emailHubApi";

describe("Email Hub sync center account switching", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    sessionStorage.clear();
    localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  function openSearchPageFromTopbar(query = "") {
    fireEvent.change(screen.getByLabelText("全局搜索邮件"), {
      target: { value: query },
    });
    fireEvent.submit(screen.getByRole("search", { name: "全局邮件搜索" }));
  }

  it("keeps operations diagnostics out of email connection and opens them from Settings", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" initialView="sync" />);

    expect(await screen.findByText("sync@example.com")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "运行状态" })).toBeNull();
    expect(
      screen.queryByRole("region", { name: "邮箱接入状态" }),
    ).toBeNull();
    expect(
      screen.queryByRole("region", { name: "同步记录" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "设置" }));

    fireEvent.click(screen.getByRole("button", { name: /状态与维护/ }));
    fireEvent.click(screen.getByRole("button", { name: /维护项目/ }));
    expect(await screen.findByRole("region", { name: "运行状态" })).toBeTruthy();
    expect(
      await screen.findByRole("region", { name: "邮箱接入状态" }),
    ).toBeTruthy();
  });

  it("keeps stale account diagnostics off the newly selected account", async () => {
    const api = createApiFixture();
    let resolveFirstDiagnostics: (page: Awaited<ReturnType<EmailHubApi["listSyncCenterAccountDiagnostics"]>>) => void = () => {};
    vi.mocked(api.listSyncCenterAccounts).mockResolvedValue({
      items: [
        {
          accountId: "account_1",
          email: "sync@example.com",
          provider: "gmail",
          syncState: "syncing",
        },
        {
          accountId: "account_outlook",
          email: "outlook@example.com",
          provider: "outlook",
          syncState: "syncing",
        },
      ],
    });
    vi.mocked(api.listSyncCenterAccountDiagnostics).mockImplementation((input) =>
      input.accountId === "account_1"
        ? new Promise((resolve) => {
            resolveFirstDiagnostics = resolve;
          })
        : Promise.resolve({
            items: [
              {
                id: "op_outlook",
                occurredAt: "2026-06-14T08:02:00.000Z",
                service: "email-hub-worker",
                level: "info" as const,
                event: "worker_result",
                accountId: "account_outlook",
                lane: "sync",
                context: {},
              },
            ],
          }),
    );

    render(<App api={api} defaultAccountId="account_1" initialView="sync" />);
    expect(await screen.findByText("sync@example.com")).toBeTruthy();
    expect(await screen.findByText("outlook@example.com")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "检查同步 sync@example.com" }));
    await waitFor(() => {
      expect(api.listSyncCenterAccountDiagnostics).toHaveBeenCalledWith({
        accountId: "account_1",
        limit: 200,
      });
    });
    fireEvent.click(
      screen.getByRole("button", { name: "检查同步 outlook@example.com" }),
    );
    expect(await screen.findByText("邮箱内容已同步。")).toBeTruthy();

    await act(async () => {
      resolveFirstDiagnostics({
        items: [
          {
            id: "op_stale",
            occurredAt: "2026-06-14T08:00:00.000Z",
            service: "email-hub-api",
            level: "info" as const,
            event: "emailengine_webhook_ingested",
            accountId: "account_1",
            lane: "sync",
            context: {},
          },
        ],
      });
      await Promise.resolve();
    });

    const diagnosticsPanel = screen.getByRole("region", { name: "同步诊断" });
    expect(within(diagnosticsPanel).getByText(/outlook@example.com/)).toBeTruthy();
    expect(within(diagnosticsPanel).queryByText("已收到邮箱更新。")).toBeNull();
  });

  it("switches the active mailbox account from email connection before loading mail and search", async () => {
    const api = createApiFixture();
    vi.mocked(api.listSyncCenterAccounts).mockResolvedValue({
      items: [
        {
          accountId: "account_1",
          email: "sync@example.com",
          provider: "gmail",
          syncState: "syncing",
          nextAction: "wait_for_sync",
        },
        {
          accountId: "account_outlook",
          email: "outlook@example.com",
          provider: "outlook",
          syncState: "syncing",
          nextAction: "wait_for_sync",
        },
      ],
    });
    vi.mocked(api.listMessages).mockImplementation(async (input) => ({
      items: [
        {
          id: input.accountId === "account_outlook" ? "message_outlook" : "message_1",
          accountId: input.accountId ?? "account_1",
          subject: input.q
            ? "Outlook search result"
            : input.accountId === "account_outlook"
              ? "Outlook inbox subject"
              : "Live subject",
          from: { email: "client@example.com", name: "Live Client" },
          receivedAt: "2026-06-13T10:00:00.000Z",
          snippet: input.q ? "Matched from Outlook" : "Live snippet",
          unread: true,
          starred: false,
          mailboxIds: ["mailbox_inbox"],
          attachmentCount: 0,
          classification: {
            bucket: "P1 Urgent",
            priorityScore: 90,
            reasons: ["Selected account"],
          },
        },
      ],
    }));

    render(<App api={api} defaultAccountId="account_1" initialView="sync" />);
    expect(await screen.findByText("outlook@example.com")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "使用邮箱 outlook@example.com" }),
    );

    await waitFor(() => {
      expect(api.listMailboxes).toHaveBeenCalledWith({
        accountId: "account_outlook",
      });
    });
    expect(sessionStorage.getItem("email-hub:selected-account-id")).toBe(
      "account_outlook",
    );

    openSearchPageFromTopbar();
    fireEvent.change(screen.getByLabelText("搜索邮件"), {
      target: { value: "contract" },
    });
    fireEvent.click(screen.getByRole("button", { name: "搜索当前账号" }));
    fireEvent.click(screen.getByRole("button", { name: "执行搜索" }));

    await waitFor(() => {
      expect(api.listMessages).toHaveBeenLastCalledWith({
        accountId: "account_outlook",
        limit: 50,
        q: "contract",
        sort: "time",
      });
    });
  });
});
