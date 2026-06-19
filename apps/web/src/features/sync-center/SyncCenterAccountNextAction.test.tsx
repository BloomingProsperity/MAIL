import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  SyncCenterAccountNextAction,
  syncCenterNextActionLabel,
} from "./SyncCenterAccountNextAction";

describe("SyncCenterAccountNextAction", () => {
  it("keeps healthy accounts quiet", () => {
    render(
      <SyncCenterAccountNextAction
        account={{
          provider: "gmail",
          syncState: "syncing",
          nextAction: "none",
        }}
      />,
    );

    expect(screen.queryByText(/下一步/)).toBeNull();
  });

  it("shows provider-specific recovery for app-password accounts", () => {
    expect(
      syncCenterNextActionLabel({
        provider: "qq",
        syncState: "reauth_required",
        nextAction: "reauthorize",
      }),
    ).toBe("使用 QQ 邮箱授权码重新授权");

    expect(
      syncCenterNextActionLabel({
        provider: "163",
        syncState: "reauth_required",
        nextAction: "reauthorize",
      }),
    ).toBe("使用 163 邮箱授权码重新授权");

    expect(
      syncCenterNextActionLabel({
        provider: "icloud",
        syncState: "reauth_required",
        nextAction: "reauthorize",
      }),
    ).toBe("使用 Apple 专用密码重新授权");
  });

  it("uses Proton Bridge recovery wording without exposing protocol jargon", () => {
    render(
      <SyncCenterAccountNextAction
        account={{
          provider: "proton_bridge",
          syncState: "reauth_required",
          nextAction: "reauthorize",
        }}
      />,
    );

    expect(screen.getByText("下一步：启动 Proton Bridge 后重试")).toBeTruthy();
    expect(screen.queryByText(/IMAP|SMTP|token|provider/i)).toBeNull();
  });

  it("falls back from missing nextAction using sync state", () => {
    expect(
      syncCenterNextActionLabel({
        provider: "custom_domain",
        syncState: "paused",
      }),
    ).toBe("恢复同步后继续收信");

    expect(
      syncCenterNextActionLabel({
        provider: "outlook",
        syncState: "reauth_required",
      }),
    ).toBe("重新授权这个邮箱");
  });

  it("shows custom-domain recovery when authorization is required", () => {
    expect(
      syncCenterNextActionLabel({
        provider: "custom_domain",
        syncState: "reauth_required",
        nextAction: "reauthorize",
      }),
    ).toBe("检查自定义收发信服务并重新授权");

    expect(
      syncCenterNextActionLabel({
        provider: "custom",
        syncState: "reauth_required",
      }),
    ).toBe("检查自定义收发信服务并重新授权");
  });

  it("shows Tencent Exmail recovery without protocol wording", () => {
    expect(
      syncCenterNextActionLabel({
        provider: "tencent_exmail",
        syncState: "reauth_required",
        nextAction: "reauthorize",
      }),
    ).toBe("开启企业邮箱客户端服务并重新授权");
  });

  it("keeps unknown backend actions actionable without leaking raw codes", () => {
    expect(
      syncCenterNextActionLabel({
        provider: "custom_domain",
        syncState: "syncing",
        nextAction: "server_mismatch",
      }),
    ).toBe("检查");
  });
});
