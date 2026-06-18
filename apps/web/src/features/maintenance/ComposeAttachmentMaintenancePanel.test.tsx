import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  ComposeAttachmentMaintenanceCleanupResultDto,
  ComposeAttachmentMaintenanceStatusDto,
  EmailHubApi,
  HermesRetentionMaintenanceCleanupResultDto,
  HermesRetentionMaintenanceStatusDto,
} from "../../lib/emailHubApi";
import { ComposeAttachmentMaintenancePanel } from "./ComposeAttachmentMaintenancePanel";

function composeMaintenanceStatusFixture(): ComposeAttachmentMaintenanceStatusDto {
  return {
    generatedAt: "2026-06-16T00:00:00.000Z",
    storage: "local",
    retentionMs: 7 * 24 * 60 * 60 * 1000,
    cleanupLimit: 100,
    protectedStorageKeyCount: 2,
    scanned: 12,
    scanLimit: 5000,
    scanLimited: false,
    uploads: 10,
    totalBytes: 8 * 1024 * 1024,
    protected: 2,
    fresh: 3,
    staleUnreferenced: 5,
    staleUnreferencedBytes: 2 * 1024 * 1024,
    invalid: 0,
  };
}

function composeMaintenanceCleanupFixture(): ComposeAttachmentMaintenanceCleanupResultDto {
  return {
    generatedAt: "2026-06-16T00:05:00.000Z",
    storage: "local",
    retentionMs: 48 * 60 * 60 * 1000,
    cleanupLimit: 2,
    protectedStorageKeyCount: 2,
    cleanup: {
      scanned: 4,
      deleted: 2,
      retained: 2,
      skippedFresh: 1,
      skippedProtected: 1,
      skippedInvalid: 0,
      bytesDeleted: 4096,
    },
    after: {
      scanned: 10,
      scanLimit: 5000,
      scanLimited: false,
      uploads: 8,
      totalBytes: 7 * 1024 * 1024,
      protected: 2,
      fresh: 3,
      staleUnreferenced: 0,
      staleUnreferencedBytes: 0,
      invalid: 0,
    },
  };
}

function hermesRetentionMaintenanceStatusFixture(
  overrides: Partial<HermesRetentionMaintenanceStatusDto> = {},
): HermesRetentionMaintenanceStatusDto {
  return {
    generatedAt: "2026-06-17T12:00:00.000Z",
    retentionMs: 30 * 24 * 60 * 60 * 1000,
    retentionDays: 30,
    cleanupLimit: 500,
    cutoff: "2026-05-18T12:00:00.000Z",
    tables: [
      {
        table: "hermes_skill_runs",
        timestampColumn: "created_at",
        expiredRows: 12,
        scanLimit: 500,
        scanLimited: false,
      },
      {
        table: "hermes_audit_events",
        timestampColumn: "created_at",
        expiredRows: 6,
        scanLimit: 500,
        scanLimited: false,
      },
    ],
    expiredRows: 18,
    scanLimited: false,
    ...overrides,
  };
}

function hermesRetentionMaintenanceCleanupFixture(): HermesRetentionMaintenanceCleanupResultDto {
  return {
    generatedAt: "2026-06-17T12:05:00.000Z",
    retentionMs: 14 * 24 * 60 * 60 * 1000,
    retentionDays: 14,
    cleanupLimit: 25,
    cutoff: "2026-06-03T12:05:00.000Z",
    cleanup: {
      messageTranslations: 1,
      messageSummaries: 2,
      staleActionPlanConfirmations: 2,
      actionPlans: 3,
      feedback: 4,
      auditEvents: 5,
      skillRuns: 6,
      deleted: 23,
    },
    after: hermesRetentionMaintenanceStatusFixture({
      generatedAt: "2026-06-17T12:05:00.000Z",
      retentionMs: 14 * 24 * 60 * 60 * 1000,
      retentionDays: 14,
      cleanupLimit: 25,
      cutoff: "2026-06-03T12:05:00.000Z",
      expiredRows: 0,
      tables: [],
    }),
  };
}

function createMaintenanceApiFixture() {
  return {
    getComposeAttachmentMaintenanceStatus: vi.fn(
      async () => composeMaintenanceStatusFixture(),
    ),
    cleanupComposeAttachments: vi.fn(
      async () => composeMaintenanceCleanupFixture(),
    ),
    getHermesRetentionMaintenanceStatus: vi.fn(
      async () => hermesRetentionMaintenanceStatusFixture(),
    ),
    cleanupHermesRetention: vi.fn(
      async () => hermesRetentionMaintenanceCleanupFixture(),
    ),
  };
}

describe("ComposeAttachmentMaintenancePanel", () => {
  it("inspects and cleans compose attachments and Hermes retention data", async () => {
    const api = createMaintenanceApiFixture();

    render(
      <ComposeAttachmentMaintenancePanel api={api as unknown as EmailHubApi} />,
    );

    const maintenancePanel = await screen.findByLabelText("数据维护面板");
    await waitFor(() => {
      expect(api.getComposeAttachmentMaintenanceStatus).toHaveBeenCalled();
      expect(api.getHermesRetentionMaintenanceStatus).toHaveBeenCalled();
    });
    expect(within(maintenancePanel).getByText("未引用附件")).toBeTruthy();
    expect(within(maintenancePanel).getByText("2 MB 可清理")).toBeTruthy();
    expect(within(maintenancePanel).getByText("Hermes 过期记录")).toBeTruthy();
    expect(within(maintenancePanel).getByText("运行记录")).toBeTruthy();

    fireEvent.change(within(maintenancePanel).getByLabelText("清理最小保留小时"), {
      target: { value: "48" },
    });
    fireEvent.change(within(maintenancePanel).getByLabelText("清理批量上限"), {
      target: { value: "2" },
    });
    fireEvent.click(
      within(maintenancePanel).getByRole("button", { name: "清理未引用附件" }),
    );

    await waitFor(() => {
      expect(api.cleanupComposeAttachments).toHaveBeenCalledWith({
        minAgeHours: 48,
        limit: 2,
      });
    });
    expect(
      await within(maintenancePanel).findByText("已清理 2 个未引用附件，释放 4 KB。"),
    ).toBeTruthy();

    fireEvent.change(within(maintenancePanel).getByLabelText("Hermes 保留天数"), {
      target: { value: "14" },
    });
    fireEvent.change(
      within(maintenancePanel).getByLabelText("Hermes 清理批量上限"),
      {
        target: { value: "25" },
      },
    );
    fireEvent.click(
      within(maintenancePanel).getByRole("button", {
        name: "清理 Hermes 过期数据",
      }),
    );

    await waitFor(() => {
      expect(api.cleanupHermesRetention).toHaveBeenCalledWith({
        retentionDays: 14,
        limit: 25,
      });
    });
    expect(
      await within(maintenancePanel).findByText("已清理 23 条 Hermes 过期记录。"),
    ).toBeTruthy();
  });

  it("shows local preview maintenance data without an api", async () => {
    render(<ComposeAttachmentMaintenancePanel />);

    expect(await screen.findByText("本地预览维护状态，连接后会读取真实缓存。")).toBeTruthy();
    expect(screen.getByText("2 MB 可清理")).toBeTruthy();
    expect(screen.getByText("Hermes 过期记录")).toBeTruthy();
  });
});
