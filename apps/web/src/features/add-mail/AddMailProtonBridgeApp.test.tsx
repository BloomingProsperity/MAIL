import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import type { EmailHubApi } from "../../lib/emailHubApi";

describe("Add Mail Proton Bridge", () => {
  afterEach(() => {
    sessionStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("tests and onboards Proton Bridge through the server-reachable Bridge address", async () => {
    const api = createApiFixture();
    vi.mocked(api.getMailProviderCapabilities).mockRejectedValueOnce(
      new Error("catalog unavailable"),
    );

    render(<App api={api} defaultAccountId="account_1" />);
    fireEvent.click(
      within(screen.getByRole("navigation")).getByRole("button", {
        name: "添加邮箱",
      }),
    );
    const providerNav = await screen.findByLabelText("添加邮箱服务商分类");
    fireEvent.click(within(providerNav).getByRole("button", { name: /Proton/ }));

    fireEvent.change(screen.getByLabelText("Add mail email"), {
      target: { value: "me@proton.me" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "连接 Proton Mail" }));
    await screen.findByLabelText("Add mail secret");
    fireEvent.change(screen.getByLabelText("Add mail username"), {
      target: { value: "bridge-user" },
    });
    fireEvent.change(screen.getByLabelText("Add mail secret"), {
      target: { value: "bridge-password" },
    });
    fireEvent.change(screen.getByLabelText("Proton Bridge receive host"), {
      target: { value: "host.docker.internal" },
    });
    fireEvent.change(screen.getByLabelText("Proton Bridge send host"), {
      target: { value: "host.docker.internal" },
    });
    fireEvent.click(screen.getByRole("button", { name: "接入Proton Mail" }));

    const expectedInput = {
      email: "me@proton.me",
      provider: "proton_bridge",
      imap: {
        host: "host.docker.internal",
        port: 1143,
        secure: false,
        username: "bridge-user",
        secret: "bridge-password",
      },
      smtp: {
        host: "host.docker.internal",
        port: 1025,
        secure: false,
        username: "bridge-user",
        secret: "bridge-password",
      },
    };
    await waitFor(() => {
      expect(api.testImapSmtpConnection).toHaveBeenCalledWith(expectedInput);
      expect(api.onboardImapSmtpAccount).toHaveBeenCalledWith(expectedInput);
    });
    expect(screen.queryByLabelText("Proton Bridge 网络位置提示")).toBeNull();
  });

  it("stops Proton Bridge testing when only one Bridge host is filled", async () => {
    const api = createApiFixture();
    vi.mocked(api.getMailProviderCapabilities).mockRejectedValueOnce(
      new Error("catalog unavailable"),
    );

    render(<App api={api} defaultAccountId="account_1" />);
    fireEvent.click(
      within(screen.getByRole("navigation")).getByRole("button", {
        name: "添加邮箱",
      }),
    );
    const providerNav = await screen.findByLabelText("添加邮箱服务商分类");
    fireEvent.click(within(providerNav).getByRole("button", { name: /Proton/ }));

    fireEvent.change(screen.getByLabelText("Add mail email"), {
      target: { value: "me@proton.me" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "连接 Proton Mail" }));
    await screen.findByLabelText("Add mail secret");
    fireEvent.change(screen.getByLabelText("Add mail username"), {
      target: { value: "bridge-user" },
    });
    fireEvent.change(screen.getByLabelText("Add mail secret"), {
      target: { value: "bridge-password" },
    });
    fireEvent.change(screen.getByLabelText("Proton Bridge receive host"), {
      target: { value: "host.docker.internal" },
    });
    fireEvent.click(screen.getByRole("button", { name: "接入Proton Mail" }));

    expect(
      await screen.findByText(
        "Proton Mail Bridge 地址不完整。",
      ),
    ).toBeTruthy();
    expect(api.testImapSmtpConnection).not.toHaveBeenCalled();
    expect(api.onboardImapSmtpAccount).not.toHaveBeenCalled();
  });
});

function createApiFixture(): EmailHubApi {
  return {
    getMailNavigationSummary: vi.fn(async () => ({
      providerGroups: [{ id: "proton", label: "Proton", count: 1 }],
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
    listMessages: vi.fn(async () => ({
      items: [
        {
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
      bodyText: "Live body",
      attachments: [],
    })),
    listLabels: vi.fn(async () => ({ items: [] })),
    listSendIdentities: vi.fn(async () => ({ items: [] })),
    listMailDrafts: vi.fn(async () => ({ items: [] })),
    listOutbox: vi.fn(async () => ({ items: [] })),
    getMailProviderCapabilities: vi.fn(async () => ({ providers: [] })),
    getMailEngineHealth: vi.fn(async () => ({
      provider: "emailengine",
      ok: true,
      detail: "ready",
      checks: {
        url: "configured",
        http: "ok",
        apiAuth: "ok",
        webhookSecret: "custom",
        accessToken: "configured",
      },
      capabilities: {
        accessTokenConfigured: true,
        imapSmtpOnboarding: true,
        attachmentDownload: true,
        send: true,
      },
      missing: [],
      warnings: [],
      readiness: {
        status: "ready",
        summary: "EmailEngine is ready.",
        setupActions: [],
      },
    })),
    testImapSmtpConnection: vi.fn(async () => ({
      provider: "proton_bridge",
      ok: true,
      checks: {
        imap: { ok: true },
        smtp: { ok: true },
      },
    })),
    onboardImapSmtpAccount: vi.fn(async () => ({
      account: {
        id: "account_proton",
        email: "me@proton.me",
        provider: "proton_bridge",
        authMethod: "password",
        syncState: "pending",
        engineProvider: "emailengine",
      },
      task: {
        id: "task_proton",
        email: "me@proton.me",
        provider: "proton_bridge",
        authMethod: "password",
        status: "completed",
      },
    })),
  } as unknown as EmailHubApi;
}
