import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { ApiRequestError } from "./lib/emailHubApi";
import type {
  EmailHubApi,
  ReauthorizationTaskDto,
  SyncManualResyncResult,
  SyncPauseResult,
  SyncResumeResult,
  SyncRetryFailedResult,
} from "./lib/emailHubApi";

describe("Email Hub sync center", () => {
  it("keeps an older account action notice from overriding the latest action", async () => {
    let resolveResync: (result: SyncManualResyncResult) => void = () => {};
    const requestSyncCenterResync = vi.fn(
      async () =>
        new Promise<SyncManualResyncResult>((resolve) => {
          resolveResync = resolve;
        }),
    );
    const retryFailedSyncCenterJobs = vi.fn(
      async (): Promise<SyncRetryFailedResult> => ({
        accountId: "account_outlook",
        action: "failed_sync_requeued",
        retriedJobCount: 2,
      }),
    );
    const api = {
      getMailNavigationSummary: vi.fn(async () => ({
        folders: [],
        providerGroups: [],
        quickCategories: [],
      })),
      listSyncCenterAccounts: vi.fn(async () => ({
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
      })),
      listSyncCenterReauthorizations: vi.fn(async () => ({ items: [] })),
      requestSyncCenterResync,
      retryFailedSyncCenterJobs,
      listMailboxes: vi.fn(async () => ({ items: [] })),
      listMessages: vi.fn(async () => ({ items: [] })),
      listLabels: vi.fn(async () => ({ items: [] })),
    } as unknown as EmailHubApi;

    render(<App api={api} defaultAccountId="account_1" initialView="sync" />);
    expect(await screen.findByText("sync@example.com")).toBeTruthy();
    expect(await screen.findByText("outlook@example.com")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "重新同步 sync@example.com" }),
    );
    await waitFor(() => {
      expect(requestSyncCenterResync).toHaveBeenCalledWith({
        accountId: "account_1",
      });
    });
    expect(
      (screen.getByRole("button", {
        name: "重新同步 sync@example.com",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", {
        name: "重试同步 outlook@example.com",
      }) as HTMLButtonElement).disabled,
    ).toBe(false);

    fireEvent.click(
      screen.getByRole("button", { name: "重试同步 outlook@example.com" }),
    );
    expect(await screen.findByText("已重新排队 2 个失败任务。")).toBeTruthy();

    await act(async () => {
      resolveResync({
        accountId: "account_1",
        action: "manual_sync_queued",
        job: {
          id: "job_sync",
          jobType: "sync_account",
          accountId: "account_1",
          idempotencyKey: "job:manual-sync:account_1:job_sync",
          status: "queued",
          createdAt: "2026-06-13T08:00:00.000Z",
        },
      });
      await Promise.resolve();
    });

    expect(screen.getByText("已重新排队 2 个失败任务。")).toBeTruthy();
    expect(screen.queryByText("重新同步已加入队列：queued")).toBeNull();
  });

  it("shows account status and reauthorization tasks in the email connection module", async () => {
    const api = createSyncCenterApiFixture();

    render(<App api={api} defaultAccountId="account_1" initialView="sync" />);

    expect(await screen.findByText("sync@example.com")).toBeTruthy();
    expect(await screen.findByText(/同步中/)).toBeTruthy();
    expect(api.listSyncCenterAccounts).toHaveBeenCalled();
    expect(api.listSyncCenterReauthorizations).toHaveBeenCalled();
    const reauthorizationPanel = screen.getByRole("region", {
      name: "需要重新授权",
    });
    expect(within(reauthorizationPanel).getByText("reauth@example.com")).toBeTruthy();
    expect(
      within(reauthorizationPanel).getByText(
        (_, element) =>
          element?.tagName.toLowerCase() === "span" &&
          (element.textContent ?? "").includes("发信权限"),
      ),
    ).toBeTruthy();
  });

  it("starts OAuth reauthorization from email connection", async () => {
    const api = createSyncCenterApiFixture();
    const oauthRedirect = vi.fn();

    render(
      <App
        api={api}
        defaultAccountId="account_1"
        initialView="sync"
        oauthRedirect={oauthRedirect}
      />,
    );
    expect(await screen.findByText("reauth@example.com")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: "重新登录 reauth@example.com",
      }),
    );

    await waitFor(() => {
      expect(api.startSyncCenterOAuthReauthorization).toHaveBeenCalledWith({
        taskId: "task_reauth_1",
        redirectUri: "http://localhost:3000/oauth/callback",
      });
    });
    expect(oauthRedirect).toHaveBeenCalledWith(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(sessionStorage.getItem("email-hub:oauth:state_1")).toContain(
      '"provider":"gmail"',
    );
    expect(sessionStorage.getItem("email-hub:oauth:state_1")).toContain(
      '"flow":"reauthorization"',
    );
  });

  it("completes password reauthorization from email connection", async () => {
    const api = createSyncCenterApiFixture();
    vi.mocked(api.listSyncCenterReauthorizations).mockResolvedValueOnce({
      items: [
        reauthorizationTaskFixture({
          taskId: "task_password_1",
          email: "password-reauth@qq.com",
          provider: "qq",
          authMethod: "password",
          source: "account_transfer_import",
          username: "password-reauth@qq.com",
        }),
      ],
    });

    render(<App api={api} defaultAccountId="account_1" initialView="sync" />);
    expect(await screen.findByText("password-reauth@qq.com")).toBeTruthy();

    fireEvent.change(
      screen.getByLabelText("授权码或专用密码 password-reauth@qq.com"),
      { target: { value: "new-auth-code" } },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "提交重新授权 password-reauth@qq.com",
      }),
    );

    await waitFor(() => {
      expect(api.completeSyncCenterImapSmtpReauthorization).toHaveBeenCalledWith({
        taskId: "task_password_1",
        username: "password-reauth@qq.com",
        secret: "new-auth-code",
      });
    });
    expect(await screen.findByText("password-reauth@qq.com 已恢复同步。")).toBeTruthy();
    expect(screen.queryByDisplayValue("new-auth-code")).toBeNull();
  });

  it("shows safe recovery guidance when password reauthorization diagnostics fail", async () => {
    const api = createSyncCenterApiFixture();
    vi.mocked(api.listSyncCenterReauthorizations).mockResolvedValueOnce({
      items: [
        reauthorizationTaskFixture({
          taskId: "task_password_1",
          email: "password-reauth@qq.com",
          provider: "qq",
          authMethod: "password",
          source: "account_transfer_import",
          username: "password-reauth@qq.com",
        }),
      ],
    });
    vi.mocked(api.completeSyncCenterImapSmtpReauthorization).mockRejectedValueOnce(
      new ApiRequestError(400, "reauthorization_failed", {
        error: "reauthorization_failed",
        provider: "qq",
        diagnostics: [
          {
            code: "qq_authorization_code_required",
            provider: "qq",
            severity: "action_required",
            affected: "account",
            message: "Use qq-auth-code-secret instead of password.",
            recoveryAction: "enable_qq_mail_authorization_code",
          },
        ],
      }),
    );

    render(<App api={api} defaultAccountId="account_1" initialView="sync" />);
    expect(await screen.findByText("password-reauth@qq.com")).toBeTruthy();

    fireEvent.change(
      screen.getByLabelText("授权码或专用密码 password-reauth@qq.com"),
      { target: { value: "qq-auth-code-secret" } },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "提交重新授权 password-reauth@qq.com",
      }),
    );

    expect(await screen.findByText("QQ 邮箱授权码")).toBeTruthy();
    expect(screen.getByText("QQ 邮箱授权码不可用。")).toBeTruthy();
    expect(
      await screen.findByText("password-reauth@qq.com 重新授权未通过。"),
    ).toBeTruthy();

    const secretInput = screen.getByLabelText(
      "授权码或专用密码 password-reauth@qq.com",
    ) as HTMLInputElement;
    await waitFor(() => {
      expect(secretInput.value).toBe("");
    });
    expect(screen.queryByText("qq_authorization_code_required")).toBeNull();
    expect(screen.queryByText("enable_qq_mail_authorization_code")).toBeNull();
    expect(screen.queryByText("qq-auth-code-secret")).toBeNull();
  });

  it("submits custom IMAP and SMTP settings for password reauthorization", async () => {
    const api = createSyncCenterApiFixture();
    vi.mocked(api.listSyncCenterReauthorizations).mockResolvedValueOnce({
      items: [
        reauthorizationTaskFixture({
          taskId: "task_custom_1",
          email: "custom@example.com",
          provider: "custom",
          authMethod: "password",
          source: "csv_import",
          username: "custom@example.com",
        }),
      ],
    });

    render(<App api={api} defaultAccountId="account_1" initialView="sync" />);
    expect(await screen.findByText("custom@example.com")).toBeTruthy();

    fireEvent.click(
      screen.getByLabelText("使用自定义收发信服务 custom@example.com"),
    );
    fireEvent.change(
      screen.getByLabelText("授权码或专用密码 custom@example.com"),
      { target: { value: "domain-app-password" } },
    );
    fireEvent.change(screen.getByLabelText("收信主机 custom@example.com"), {
      target: { value: "imap.example.com" },
    });
    fireEvent.change(screen.getByLabelText("发信主机 custom@example.com"), {
      target: { value: "smtp.example.com" },
    });
    fireEvent.change(screen.getByLabelText("发信端口 custom@example.com"), {
      target: { value: "587" },
    });
    fireEvent.click(screen.getByLabelText("发信安全连接 custom@example.com"));
    fireEvent.click(
      screen.getByRole("button", {
        name: "提交重新授权 custom@example.com",
      }),
    );

    await waitFor(() => {
      expect(api.completeSyncCenterImapSmtpReauthorization).toHaveBeenCalledWith({
        taskId: "task_custom_1",
        username: "custom@example.com",
        secret: "domain-app-password",
        imap: {
          host: "imap.example.com",
          port: 993,
          secure: true,
          username: "custom@example.com",
          secret: "domain-app-password",
        },
        smtp: {
          host: "smtp.example.com",
          port: 587,
          secure: false,
          username: "custom@example.com",
          secret: "domain-app-password",
        },
      });
    });
  });

  it("wires email connection account controls to backend actions", async () => {
    const api = createSyncCenterApiFixture();

    render(<App api={api} defaultAccountId="account_1" initialView="sync" />);

    expect(await screen.findByText("sync@example.com")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "重新同步 sync@example.com" }),
    );
    await waitFor(() => {
      expect(api.requestSyncCenterResync).toHaveBeenCalledWith({
        accountId: "account_1",
      });
    });

    fireEvent.click(
      screen.getByRole("button", { name: "暂停同步 sync@example.com" }),
    );
    await waitFor(() => {
      expect(api.pauseSyncCenterAccount).toHaveBeenCalledWith({
        accountId: "account_1",
      });
    });
    expect((await screen.findAllByText(/已暂停/)).length).toBeGreaterThan(0);

    fireEvent.click(
      screen.getByRole("button", { name: "恢复同步 sync@example.com" }),
    );
    await waitFor(() => {
      expect(api.resumeSyncCenterAccount).toHaveBeenCalledWith({
        accountId: "account_1",
      });
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "重试同步 sync@example.com",
      }),
    );
    await waitFor(() => {
      expect(api.retryFailedSyncCenterJobs).toHaveBeenCalledWith({
        accountId: "account_1",
      });
    });
    expect(screen.getByRole("status").textContent).toContain("1");
  });

  it("opens email connection account diagnostics from backend operational events", async () => {
    const api = createSyncCenterApiFixture();

    render(<App api={api} defaultAccountId="account_1" initialView="sync" />);

    expect(await screen.findByText("sync@example.com")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: "检查同步 sync@example.com",
      }),
    );

    await waitFor(() => {
      expect(api.listSyncCenterAccountDiagnostics).toHaveBeenCalledWith({
        accountId: "account_1",
        limit: 200,
      });
    });
    const diagnosticsPanel = await screen.findByRole("region", {
      name: "同步诊断",
    });
    expect(within(diagnosticsPanel).getByText("邮箱服务状态已更新")).toBeTruthy();
    expect(within(diagnosticsPanel).getByText("已收到邮箱更新。")).toBeTruthy();
  });
});

function createSyncCenterApiFixture(): EmailHubApi {
  return {
    getMailNavigationSummary: vi.fn(async () => ({
      folders: [],
      providerGroups: [],
      quickCategories: [],
    })),
    listSyncCenterAccounts: vi.fn(async () => ({
      items: [
        {
          accountId: "account_1",
          email: "sync@example.com",
          provider: "gmail",
          syncState: "syncing",
          nextAction: "wait_for_sync",
        },
      ],
    })),
    listSyncCenterReauthorizations: vi.fn(async () => ({
      items: [reauthorizationTaskFixture()],
    })),
    startSyncCenterOAuthReauthorization: vi.fn(async () => oauthStartFixture()),
    completeSyncCenterImapSmtpReauthorization: vi.fn(async (input) => ({
      task: {
        id: input.taskId,
        email: "password-reauth@qq.com",
        provider: "qq",
        authMethod: "password",
        status: "completed",
      },
      account: {
        id: "account_password_reauth",
        email: "password-reauth@qq.com",
        provider: "qq",
        authMethod: "password",
        syncState: "syncing",
        engineProvider: "emailengine",
      },
    })),
    listSyncCenterAccountDiagnostics: vi.fn(async () => ({
      items: [
        {
          id: "op_sync_1",
          occurredAt: "2026-06-14T08:00:00.000Z",
          service: "email-hub-api",
          level: "info" as const,
          event: "emailengine_webhook_ingested",
          accountId: "account_1",
          lane: "sync",
          jobId: "job_sync",
          message: "EmailEngine webhook auth_failed ingested for account_1",
          context: {
            duplicate: false,
            syncJobType: "account_state",
          },
        },
      ],
    })),
    requestSyncCenterResync: vi.fn(async () =>
      ({
        accountId: "account_1",
        action: "manual_sync_queued",
        job: {
          id: "job_sync",
          jobType: "sync_account",
          accountId: "account_1",
          idempotencyKey: "job:manual-sync:account_1:job_sync",
          status: "queued",
          createdAt: "2026-06-13T08:00:00.000Z",
        },
      }) satisfies SyncManualResyncResult,
    ),
    pauseSyncCenterAccount: vi.fn(async () =>
      ({
        accountId: "account_1",
        action: "sync_paused",
        account: { accountId: "account_1", syncState: "paused" },
      }) satisfies SyncPauseResult,
    ),
    resumeSyncCenterAccount: vi.fn(async () =>
      ({
        accountId: "account_1",
        action: "sync_resumed",
        account: { accountId: "account_1", syncState: "syncing" },
      }) satisfies SyncResumeResult,
    ),
    retryFailedSyncCenterJobs: vi.fn(async () =>
      ({
        accountId: "account_1",
        action: "failed_sync_requeued",
        retriedJobCount: 1,
      }) satisfies SyncRetryFailedResult,
    ),
    listMailboxes: vi.fn(async () => ({ items: [] })),
    listMessages: vi.fn(async () => ({ items: [] })),
    listLabels: vi.fn(async () => ({ items: [] })),
  } as unknown as EmailHubApi;
}

function reauthorizationTaskFixture(
  overrides: Partial<ReauthorizationTaskDto> = {},
): ReauthorizationTaskDto {
  return {
    taskId: "task_reauth_1",
    email: "reauth@example.com",
    provider: "gmail",
    authMethod: "oauth",
    status: "pending",
    source: "native_send",
    reauthRequired: true,
    loginHint: "reauth@example.com",
    createdAt: "2026-06-14T08:00:00.000Z",
    updatedAt: "2026-06-14T08:00:00.000Z",
    ...overrides,
  };
}

function oauthStartFixture() {
  return {
    provider: "gmail" as const,
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    state: "state_1",
    task: {
      id: "task_1",
      email: "pending@gmail.oauth",
      provider: "gmail",
      authMethod: "oauth",
      status: "pending",
    },
  };
}
