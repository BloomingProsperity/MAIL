import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { EmailHubApi } from "../../lib/emailHubApi";
import {
  HermesAuditLogPanel,
  HermesMemoryManagerPanel,
} from "./HermesLearningPanels";

describe("Hermes learning panels", () => {
  it("filters memories that need review and validates confidence before saving", async () => {
    const api = {
      listHermesMemories: vi.fn(async () => ({
        items: [
          memoryFixture({
            id: "memory_low",
            layer: "writing_style_profile",
            confidence: 0.42,
            content: { preference: "Needs review" },
          }),
          memoryFixture({
            id: "memory_high",
            layer: "procedural_memory",
            confidence: 0.91,
            content: { rule: "Stable habit" },
          }),
        ],
      })),
      updateHermesMemory: vi.fn(),
      deleteHermesMemory: vi.fn(),
    } as unknown as EmailHubApi;

    render(<HermesMemoryManagerPanel api={api} accountId="account_1" />);

    expect(await screen.findByText("写作风格")).toBeTruthy();
    expect(screen.getByText("处理规则")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Show Hermes memories needing review"));
    expect(screen.getByText("写作风格")).toBeTruthy();
    expect(screen.queryByText("处理规则")).toBeNull();

    fireEvent.change(screen.getByLabelText("Hermes memory confidence memory_low"), {
      target: { value: "1.5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存学习记录" }));

    expect(await screen.findByText("置信度必须在 0 到 1 之间。")).toBeTruthy();
    expect(api.updateHermesMemory).not.toHaveBeenCalled();
  });

  it("filters audit events to entries that used Hermes memory", async () => {
    const api = {
      listHermesAuditLog: vi.fn(async () => ({
        items: [
          auditEventFixture({
            id: "audit_with_memory",
            skillTitle: "邮件翻译",
            memoryIds: ["memory_1"],
            action: { skillId: "translate_text", targetLanguage: "zh-CN" },
          }),
          auditEventFixture({
            id: "audit_without_memory",
            skillTitle: "搜索问答",
            skillId: "email_search_qa",
            eventType: "hermes.skill.email_search_qa",
            memoryIds: [],
            action: { skillId: "email_search_qa", searchQuery: "launch" },
          }),
        ],
      })),
    } as unknown as EmailHubApi;

    render(<HermesAuditLogPanel api={api} accountId="account_1" />);

    const auditPanel = await screen.findByLabelText("Hermes 审计日志");
    expect(await within(auditPanel).findByText("邮件翻译")).toBeTruthy();
    expect(
      within(
        within(auditPanel).getByLabelText("Hermes audit event audit_without_memory"),
      ).getByText("搜索问答"),
    ).toBeTruthy();

    fireEvent.click(
      within(auditPanel).getByLabelText("Show Hermes audit events with memory usage"),
    );

    expect(within(auditPanel).getByText("邮件翻译")).toBeTruthy();
    expect(
      within(auditPanel).queryByLabelText("Hermes audit event audit_without_memory"),
    ).toBeNull();
    await waitFor(() => {
      expect(api.listHermesAuditLog).toHaveBeenCalledWith({
        accountId: "account_1",
        limit: 50,
      });
    });
  });

  it("clears stale audit filters when focusing Hermes memory usage", async () => {
    const api = {
      listHermesAuditLog: vi.fn(async () => ({ items: [] })),
    } as unknown as EmailHubApi;

    const { rerender } = render(
      <HermesAuditLogPanel api={api} accountId="account_1" />,
    );

    const auditPanel = await screen.findByLabelText("Hermes 审计日志");
    await waitFor(() => {
      expect(api.listHermesAuditLog).toHaveBeenLastCalledWith({
        accountId: "account_1",
        limit: 50,
      });
    });

    fireEvent.change(
      within(auditPanel).getByLabelText("Hermes audit skill filter"),
      {
        target: { value: "translate_text" },
      },
    );
    fireEvent.change(
      within(auditPanel).getByLabelText("Hermes audit message filter"),
      {
        target: { value: "message_1" },
      },
    );
    fireEvent.click(within(auditPanel).getByRole("button", { name: "刷新审计" }));
    await waitFor(() => {
      expect(api.listHermesAuditLog).toHaveBeenLastCalledWith({
        accountId: "account_1",
        skillId: "translate_text",
        messageId: "message_1",
        limit: 50,
      });
    });

    rerender(
      <HermesAuditLogPanel
        api={api}
        accountId="account_1"
        focusedMemoryId="memory_1"
        focusedMemoryLabel="写作风格 · global"
      />,
    );

    await waitFor(() => {
      expect(api.listHermesAuditLog).toHaveBeenLastCalledWith({
        accountId: "account_1",
        memoryId: "memory_1",
        limit: 50,
      });
    });
    expect(
      (
        within(auditPanel).getByLabelText(
          "Hermes audit skill filter",
        ) as HTMLSelectElement
      ).value,
    ).toBe("");
    expect(
      (
        within(auditPanel).getByLabelText(
          "Hermes audit message filter",
        ) as HTMLInputElement
      ).value,
    ).toBe("");
    expect(
      (
        within(auditPanel).getByLabelText(
          "Hermes audit memory filter",
        ) as HTMLInputElement
      ).value,
    ).toBe("memory_1");
  });
});

function memoryFixture(
  overrides: Partial<{
    id: string;
    layer: string;
    scope: string;
    content: Record<string, unknown>;
    confidence: number;
  }> = {},
) {
  return {
    id: overrides.id ?? "memory_1",
    layer: overrides.layer ?? "writing_style_profile",
    scope: overrides.scope ?? "global",
    content: overrides.content ?? { preference: "Keep replies concise" },
    confidence: overrides.confidence ?? 0.82,
    createdAt: "2026-06-15T08:00:00.000Z",
    updatedAt: "2026-06-15T09:00:00.000Z",
  };
}

function auditEventFixture(
  overrides: Partial<{
    id: string;
    eventType: string;
    skillId: string;
    skillTitle: string;
    memoryIds: string[];
    action: Record<string, unknown>;
  }> = {},
) {
  return {
    id: overrides.id ?? "audit_1",
    eventType: overrides.eventType ?? "hermes.skill.translate_text",
    skillRunId: "run_1",
    skillId: overrides.skillId ?? "translate_text",
    skillTitle: overrides.skillTitle ?? "邮件翻译",
    readMessageIds: ["message_1"],
    memoryIds: overrides.memoryIds ?? ["memory_1"],
    action: overrides.action ?? { skillId: "translate_text" },
    createdAt: "2026-06-15T09:30:00.000Z",
  };
}
