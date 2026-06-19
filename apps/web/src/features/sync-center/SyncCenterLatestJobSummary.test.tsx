import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  SyncCenterLatestJobSummary,
  syncCenterLatestJobSummary,
} from "./SyncCenterLatestJobSummary";

describe("SyncCenterLatestJobSummary", () => {
  it("keeps accounts without job summaries quiet", () => {
    render(<SyncCenterLatestJobSummary account={{}} />);

    expect(screen.queryByText(/最近同步/)).toBeNull();
  });

  it("shows running sync progress without raw job ids", () => {
    render(
      <SyncCenterLatestJobSummary
        account={{
          latestSyncJob: {
            id: "job_private_1",
            jobType: "sync_account",
            status: "running",
            attempts: 2,
            maxAttempts: 8,
            notBefore: "2026-06-13T08:01:00.000Z",
            updatedAt: "2026-06-13T08:02:00.000Z",
          },
        }}
      />,
    );

    expect(
      screen.getByText("最近同步：邮箱同步 · 同步中 · 第 2/8 次 · 更新 06-13 08:02"),
    ).toBeTruthy();
    expect(screen.queryByText("job_private_1")).toBeNull();
  });

  it("uses queued not-before time as the next processing clue", () => {
    expect(
      syncCenterLatestJobSummary({
        latestSyncJob: {
          id: "job_queued_1",
          jobType: "sync_account",
          status: "queued",
          attempts: 0,
          maxAttempts: 8,
          notBefore: "2026-06-13T08:01:00.000Z",
          updatedAt: "2026-06-13T08:00:00.000Z",
        },
      }),
    ).toBe("邮箱同步 · 排队中 · 第 0/8 次 · 稍后 06-13 08:01");
  });

  it("routes failed jobs to diagnostics without exposing provider errors", () => {
    render(
      <SyncCenterLatestJobSummary
        account={{
          latestSyncJob: {
            id: "job_failed_1",
            jobType: "sync_account",
            status: "dead_letter",
            attempts: 8,
            maxAttempts: 8,
            notBefore: "2026-06-13T07:30:00.000Z",
            errorMessage: "invalid_grant raw provider detail",
            updatedAt: "2026-06-13T07:31:00.000Z",
          },
        }}
      />,
    );

    expect(
      screen.getByText(
        "最近同步：邮箱同步 · 多次失败已停止 · 第 8/8 次 · 更新 06-13 07:31 · 可检查",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/invalid_grant/)).toBeNull();
  });

  it("accepts legacy latestJob payloads defensively", () => {
    expect(
      syncCenterLatestJobSummary({
        latestJob: {
          id: "job_done_1",
          jobType: "other_job",
          status: "done",
          attempts: 1,
          maxAttempts: 8,
          notBefore: "2026-06-13T08:30:00.000Z",
          updatedAt: "2026-06-13T09:00:00.000Z",
        },
      }),
    ).toBe("邮箱同步 · 最近已完成 · 第 1/8 次 · 更新 06-13 09:00");
  });

  it("ignores malformed job payloads", () => {
    expect(
      syncCenterLatestJobSummary({
        latestSyncJob: {
          status: "retrying",
          attempts: 3,
          updatedAt: "2026-06-13T09:00:00.000Z",
        } as never,
      }),
    ).toBe("");
  });
});
