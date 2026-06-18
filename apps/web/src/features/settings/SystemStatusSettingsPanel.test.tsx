import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SystemStatusSettingsPanel } from "./SystemStatusSettingsPanel";
import type { EmailHubApi } from "../../lib/emailHubApi";

describe("SystemStatusSettingsPanel", () => {
  it("shows deployment diagnostics only inside system settings", async () => {
    const api = systemStatusApiFixture();

    render(<SystemStatusSettingsPanel api={api} />);

    const apiPanel = await screen.findByRole("region", {
      name: "服务运行体检",
    });
    expect(within(apiPanel).getByText("服务运行正常")).toBeTruthy();
    expect(within(apiPanel).getByText("数据库")).toBeTruthy();

    const mailEnginePanel = await screen.findByRole("region", {
      name: "邮箱接入体检",
    });
    expect(within(mailEnginePanel).getByText("邮箱接入还差配置")).toBeTruthy();
    expect(
      within(mailEnginePanel).getByText("邮箱接入服务配置未完全就绪，部分接入能力会降级。"),
    ).toBeTruthy();
    expect(within(mailEnginePanel).getByText("认证探测")).toBeTruthy();
    expect(within(mailEnginePanel).getByText("被拒绝")).toBeTruthy();
    expect(
      within(mailEnginePanel)
        .getAllByText(/EMAILENGINE_ACCESS_TOKEN/)[0]
        .closest("details")
        ?.hasAttribute("open"),
    ).toBe(false);

    fireEvent.click(within(mailEnginePanel).getByText("管理员配置明细"));
    expect(within(mailEnginePanel).getAllByText(/EMAILENGINE_ACCESS_TOKEN/).length).toBeGreaterThan(0);
    expect(within(mailEnginePanel).getByText("更新邮箱接入访问令牌")).toBeTruthy();

    const eventsPanel = await screen.findByRole("region", {
      name: "邮箱同步运行记录",
    });
    expect(await within(eventsPanel).findByText("同步任务已处理")).toBeTruthy();
    expect(within(eventsPanel).getByText("邮箱服务状态已更新")).toBeTruthy();
    await waitFor(() => {
      expect(api.listOperationalEvents).toHaveBeenCalledWith({
        service: "email-hub-api",
        event: "emailengine_webhook_ingested",
        lane: "sync",
        limit: 3,
      });
      expect(api.listOperationalEvents).toHaveBeenCalledWith({
        service: "email-hub-worker",
        lane: "sync",
        limit: 5,
      });
    });
  });

  it("keeps settings usable when diagnostics cannot be loaded", async () => {
    const api = systemStatusApiFixture();
    vi.mocked(api.getApiHealth).mockRejectedValueOnce(new Error("offline"));
    vi.mocked(api.getMailEngineHealth).mockRejectedValueOnce(new Error("offline"));
    vi.mocked(api.listOperationalEvents).mockRejectedValue(new Error("offline"));

    render(<SystemStatusSettingsPanel api={api} />);

    expect(await screen.findByText("服务运行需要检查")).toBeTruthy();
    expect(await screen.findByText("邮箱接入体检暂时不可用")).toBeTruthy();
    expect(await screen.findByText("最近运行事件暂时不可用。")).toBeTruthy();
  });
});

function systemStatusApiFixture(): EmailHubApi {
  return {
    getApiHealth: vi.fn(async () => ({
      service: "email-hub-api",
      ok: true,
      checks: {
        database: "ok",
      },
    })),
    getMailEngineHealth: vi.fn(async () => ({
      provider: "emailengine",
      ok: false,
      detail: "adapter boundary ready: http://emailengine:3000",
      checks: {
        url: "configured",
        http: "ok",
        accessToken: "configured",
        apiAuth: "unauthorized",
        webhookSecret: "custom",
      },
      capabilities: {
        urlConfigured: true,
        accessTokenConfigured: true,
        imapSmtpOnboarding: false,
        attachmentDownload: false,
        send: false,
      },
      missing: [],
      warnings: ["EMAILENGINE_ACCESS_TOKEN_REJECTED"],
      readiness: {
        status: "degraded",
        summary: "EmailEngine 配置未完全就绪，部分上线能力会降级。",
        setupActions: [
          {
            code: "replace_emailengine_access_token",
            label: "更新 EmailEngine 访问令牌",
            env: ["EMAILENGINE_ACCESS_TOKEN", "EENGINE_PREPARED_TOKEN"],
            effect:
              "EmailEngine 拒绝当前访问令牌，添加邮箱、附件下载、发信和同步任务会失败。",
          },
        ],
      },
    })),
    listOperationalEvents: vi.fn(async (input) => {
      if (input?.service === "email-hub-api") {
        return {
          items: [
            {
              id: "op_webhook_1",
              occurredAt: "2026-06-14T08:03:00.000Z",
              service: "email-hub-api",
              level: "info",
              event: "emailengine_webhook_ingested",
              lane: "sync",
              accountId: "account_1",
              jobId: "job_webhook",
              context: {},
            },
          ],
        };
      }

      return {
        items: [
          {
            id: "op_worker_1",
            occurredAt: "2026-06-14T08:04:00.000Z",
            service: "email-hub-worker",
            level: "info",
            event: "worker_result",
            lane: "sync",
            accountId: "account_1",
            jobId: "job_sync",
            context: {},
          },
        ],
      };
    }),
  } as Partial<EmailHubApi> as EmailHubApi;
}
