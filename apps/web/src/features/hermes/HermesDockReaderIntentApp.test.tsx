import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App";
import type { EmailHubApi } from "../../lib/emailHubApi";

describe("Hermes dock reader intents", () => {
  afterEach(() => {
    sessionStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("routes current-message prompts to reader actions", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    fireEvent.click(screen.getByRole("button", { name: "打开 Hermes" }));
    submitDockPrompt("总结这封邮件");

    await waitFor(() => {
      expect(api.summarizeMessage).toHaveBeenCalledWith({
        accountId: "account_1",
        messageId: "message_1",
        mode: "action_points",
        focus: "decisions, deadlines, blockers, and reply needs",
        language: "zh-CN",
        memoryScope: "global",
      });
    });
    expect(await screen.findByText("需要确认发布时间，并在今天回复 Lina。")).toBeTruthy();

    submitDockPrompt("翻译当前邮件");
    await waitFor(() => {
      expect(api.translateMessage).toHaveBeenCalledWith({
        accountId: "account_1",
        messageId: "message_1",
        targetLanguage: "Chinese",
        tone: "preserve original meaning and formatting",
        memoryScope: "sender:client@example.com",
      });
    });
    expect(await screen.findByText("你好，请确认发布计划。")).toBeTruthy();

    submitDockPrompt("帮我回复这封邮件");
    await waitFor(() => {
      expect(api.createComposeSeed).toHaveBeenCalledWith({
        accountId: "account_1",
        messageId: "message_1",
        mode: "reply",
      });
      expect(api.draftMessageReply).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: "account_1",
          messageId: "message_1",
          instruction: "Draft a concise reply in my normal style.",
        }),
      );
    });
    expect(
      (screen.getByLabelText("Compose body") as HTMLTextAreaElement).value,
    ).toBe("Hi,\n\nI can confirm this plan.");
    expect(api.searchMailWithHermes).not.toHaveBeenCalled();
  });
});

function submitDockPrompt(prompt: string) {
  fireEvent.change(screen.getByLabelText("Hermes 指令"), {
    target: { value: prompt },
  });
  fireEvent.click(screen.getByRole("button", { name: "发送给 Hermes" }));
}

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
      navigation: {
        providerGroups: [],
        quickCategories: [],
        labels: [],
      },
      labels: [],
      rules: [],
      pendingRuleCandidates: [],
      skills: [],
      mailEngine: { readiness: { status: "ready" } },
      operationBoundaries: [],
      unavailableModules: [],
    })),
    summarizeMessage: vi.fn(async (input) => ({
      skillRunId: "run_summary_1",
      skillId: "thread_summarize",
      accountId: input.accountId,
      messageId: input.messageId,
      mode: input.mode ?? "detailed",
      summaryText: "需要确认发布时间，并在今天回复 Lina。",
      cached: false,
    })),
    translateMessage: vi.fn(async (input) => ({
      skillRunId: "run_translate_1",
      auditEventId: "audit_translate_1",
      skillId: "translate_text",
      accountId: input.accountId,
      messageId: input.messageId,
      sourceLanguage: input.sourceLanguage ?? "auto",
      targetLanguage: input.targetLanguage,
      translatedText: "你好，请确认发布计划。",
      cached: false,
    })),
    createComposeSeed: vi.fn(async (input) => ({
      accountId: input.accountId,
      messageId: input.messageId,
      mode: input.mode,
      to: [{ address: "client@example.com", name: "Live Client" }],
      cc: [],
      bcc: [],
      subject: "Re: Live subject",
      bodyText:
        "\n\nOn Sat, Live Client <client@example.com> wrote:\n> Live body from backend",
      source: "reply",
      replyToMessageId: input.messageId,
      sourceMessageId: input.messageId,
      attachments: [],
      warnings: [],
      generatedAt: "2026-06-13T10:00:00.000Z",
    })),
    draftMessageReply: vi.fn(async (input) => ({
      skillRunId: "run_reply_1",
      skillId: "reply_draft",
      accountId: input.accountId,
      messageId: input.messageId,
      draftText: "Hi,\n\nI can confirm this plan.",
    })),
    searchMailWithHermes: vi.fn(),
  } as unknown as EmailHubApi;
}
