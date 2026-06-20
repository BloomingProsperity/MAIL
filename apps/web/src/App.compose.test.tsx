import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { ApiRequestError } from "./lib/emailHubApi";
import {
  createApiFixture,
  mailDraftFixture,
  mockTwoMessageReader,
  openAdvancedSenderPanel,
  openComposeWindow,
  restoreUrlDownloadMethod,
  scheduledSendFixture,
} from "./test/appTestFixtures";
import type {
  AttachmentDownload,
  EmailHubApi,
  HermesMessageReplyDraftResult,
  HermesRewritePolishResult,
  HermesTranslateTextResult,
  MailDraftDto,
} from "./lib/emailHubApi";

describe("Email Hub compose and outbox", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    sessionStorage.clear();
    localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("saves a reply draft from a backend seed through the compose panel", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    fireEvent.click(screen.getByRole("button", { name: "回复" }));

    await waitFor(() => {
      expect(api.createComposeSeed).toHaveBeenCalledWith({
        accountId: "account_1",
        messageId: "message_1",
        mode: "reply",
      });
    });
    expect(screen.queryByLabelText("Reply body")).toBeNull();
    await waitFor(() => {
      expect(
        (screen.getByLabelText("Compose recipients") as HTMLInputElement).value,
      ).toBe("Live Client <client@example.com>");
    });

    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Thanks, I will check this today." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save composed draft" }));

    await waitFor(() => {
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [{ address: "client@example.com", name: "Live Client" }],
        subject: "Re: Live subject",
        bodyText: "Thanks, I will check this today.",
        source: "reply",
        replyToMessageId: "message_1",
        sourceMessageId: "message_1",
      });
    });
    expect(await screen.findByText(/草稿已保存。/)).toBeTruthy();
  });

  it("creates then sends a reply draft through the unified compose panel", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    fireEvent.click(screen.getByRole("button", { name: "回复" }));
    await screen.findByText(/回复草稿已准备/);

    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Send this after preview." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send composed draft now" }));

    await waitFor(() => {
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [{ address: "client@example.com", name: "Live Client" }],
        subject: "Re: Live subject",
        bodyText: "Send this after preview.",
        source: "reply",
        replyToMessageId: "message_1",
        sourceMessageId: "message_1",
      });
    });
    await waitFor(() => {
      expect(api.sendMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        draftId: "draft_1",
      });
    });
    expect(vi.mocked(api.createMailDraft).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(api.sendMailDraft).mock.invocationCallOrder[0],
    );
    expect(await screen.findByText(/邮件已进入发送队列。/)).toBeTruthy();
  });

  it("downloads message attachments through the backend blob route", async () => {
    const api = createApiFixture();
    vi.mocked(api.getMessage).mockResolvedValueOnce({
      id: "message_1",
      accountId: "account_1",
      subject: "Live subject",
      from: { email: "client@example.com", name: "Live Client" },
      receivedAt: "2026-06-13T10:00:00.000Z",
      snippet: "Live snippet",
      unread: true,
      starred: false,
      mailboxIds: ["mailbox_inbox"],
      attachmentCount: 1,
      classification: {
        bucket: "P1 Urgent",
        priorityScore: 96,
        reasons: ["Direct to you"],
      },
      to: ["me@example.com"],
      cc: [],
      bodyText: "Live body from backend",
      attachments: [
        {
          id: "attachment_1",
          filename: "proposal.pdf",
          contentType: "application/pdf",
          byteSize: 2048,
          embedded: false,
          inline: false,
        },
      ],
    });

    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    const createObjectUrl = vi.fn(() => "blob:attachment_1");
    const revokeObjectUrl = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectUrl,
    });

    try {
      render(<App api={api} defaultAccountId="account_1" />);
      await screen.findByText("proposal.pdf");

      fireEvent.click(
        screen.getByRole("button", { name: "Download attachment proposal.pdf" }),
      );

      await waitFor(() => {
        expect(api.downloadAttachment).toHaveBeenCalledWith({
          accountId: "account_1",
          attachmentId: "attachment_1",
        });
      });
      expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
      expect(click).toHaveBeenCalled();
      expect(revokeObjectUrl).toHaveBeenCalledWith("blob:attachment_1");
      expect(await screen.findByText(/附件已开始下载：proposal.pdf/)).toBeTruthy();
    } finally {
      click.mockRestore();
      restoreUrlDownloadMethod("createObjectURL", originalCreateObjectUrl);
      restoreUrlDownloadMethod("revokeObjectURL", originalRevokeObjectUrl);
    }
  });

  it("does not show stale attachment download notices after switching messages", async () => {
    const api = createApiFixture();
    let resolveDownload: (value: AttachmentDownload) => void = () => {};
    vi.mocked(api.listMessages).mockResolvedValue({
      items: [
        {
          id: "message_1",
          accountId: "account_1",
          subject: "First subject",
          from: { email: "first@example.com", name: "First Sender" },
          receivedAt: "2026-06-13T10:00:00.000Z",
          snippet: "First snippet",
          unread: true,
          starred: false,
          mailboxIds: ["mailbox_inbox"],
          attachmentCount: 1,
          classification: {
            bucket: "P1 Urgent",
            priorityScore: 96,
            reasons: ["First reason"],
          },
        },
        {
          id: "message_2",
          accountId: "account_1",
          subject: "Second subject",
          from: { email: "second@example.com", name: "Second Sender" },
          receivedAt: "2026-06-13T10:05:00.000Z",
          snippet: "Second snippet",
          unread: false,
          starred: false,
          mailboxIds: ["mailbox_inbox"],
          attachmentCount: 0,
          classification: {
            bucket: "P2 Important",
            priorityScore: 88,
            reasons: ["Second reason"],
          },
        },
      ],
    });
    vi.mocked(api.getMessage).mockImplementation(async (input) => ({
      id: input.messageId,
      accountId: "account_1",
      subject: input.messageId === "message_2" ? "Second subject" : "First subject",
      from:
        input.messageId === "message_2"
          ? { email: "second@example.com", name: "Second Sender" }
          : { email: "first@example.com", name: "First Sender" },
      receivedAt: "2026-06-13T10:00:00.000Z",
      snippet: input.messageId === "message_2" ? "Second snippet" : "First snippet",
      unread: false,
      starred: false,
      mailboxIds: ["mailbox_inbox"],
      attachmentCount: input.messageId === "message_2" ? 0 : 1,
      classification: {
        bucket: input.messageId === "message_2" ? "P2 Important" : "P1 Urgent",
        priorityScore: input.messageId === "message_2" ? 88 : 96,
        reasons: ["Loaded detail"],
      },
      to: ["me@example.com"],
      cc: [],
      bodyText:
        input.messageId === "message_2" ? "Second backend body" : "First backend body",
      attachments:
        input.messageId === "message_2"
          ? []
          : [
              {
                id: "attachment_1",
                filename: "proposal.pdf",
                contentType: "application/pdf",
                byteSize: 2048,
                embedded: false,
                inline: false,
              },
            ],
    }));
    vi.mocked(api.downloadAttachment).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDownload = resolve;
        }),
    );

    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    const createObjectUrl = vi.fn(() => "blob:attachment_1");
    const revokeObjectUrl = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectUrl,
    });

    try {
      render(<App api={api} defaultAccountId="account_1" />);
      const messageList = await screen.findByRole("region", { name: "邮件列表" });
      fireEvent.click(
        within(messageList).getByRole("button", { name: /First subject/ }),
      );
      expect(await screen.findByRole("heading", { name: "First subject" })).toBeTruthy();
      await screen.findByText("proposal.pdf");

      fireEvent.click(
        screen.getByRole("button", { name: "Download attachment proposal.pdf" }),
      );
      await waitFor(() => {
        expect(api.downloadAttachment).toHaveBeenCalledWith({
          accountId: "account_1",
          attachmentId: "attachment_1",
        });
      });

      fireEvent.click(screen.getByRole("button", { name: /Second subject/ }));
      expect(await screen.findByRole("heading", { name: "Second subject" })).toBeTruthy();

      await act(async () => {
        resolveDownload({
          filename: "proposal.pdf",
          contentType: "application/pdf",
          blob: new Blob(["proposal"], { type: "application/pdf" }),
        });
      });

      expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
      expect(click).toHaveBeenCalled();
      expect(screen.queryByText(/附件已开始下载：proposal.pdf/)).toBeNull();
    } finally {
      click.mockRestore();
      restoreUrlDownloadMethod("createObjectURL", originalCreateObjectUrl);
      restoreUrlDownloadMethod("revokeObjectURL", originalRevokeObjectUrl);
    }
  });

  it("uses Hermes to draft a reply into the unified compose panel", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    await screen.findByText("Live body from backend");

    fireEvent.click(screen.getByRole("button", { name: "让 Hermes 写回复" }));

    await waitFor(() => {
      expect(api.createComposeSeed).toHaveBeenCalledWith({
        accountId: "account_1",
        messageId: "message_1",
        mode: "reply",
      });
    });
    await waitFor(() => {
      expect(api.draftMessageReply).toHaveBeenCalledWith({
        accountId: "account_1",
        messageId: "message_1",
        instruction: "Draft a concise reply in my normal style.",
        memoryScope: "recipient:client@example.com",
        memoryLayers: [
          "contact_memory",
          "writing_style_profile",
          "procedural_memory",
          "semantic_profile",
        ],
      });
    });
    expect(api.draftReply).not.toHaveBeenCalled();

    expect((screen.getByLabelText("Compose body") as HTMLTextAreaElement).value).toBe(
      "Hi,\n\nI can confirm this plan.",
    );
    expect((screen.getByLabelText("Compose recipients") as HTMLInputElement).value).toBe(
      "Live Client <client@example.com>",
    );
    expect((screen.getByLabelText("Compose subject") as HTMLInputElement).value).toBe(
      "Re: Live subject",
    );
    expect(screen.queryByLabelText("Reply body")).toBeNull();
    expect(await screen.findByText(/Hermes 已生成回复草稿/)).toBeTruthy();
  });

  it("ignores a stale Hermes reply draft after switching messages", async () => {
    const api = createApiFixture();
    let resolveReply: (value: HermesMessageReplyDraftResult) => void = () => {};
    mockTwoMessageReader(api);
    vi.mocked(api.draftMessageReply).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveReply = resolve;
        }),
    );

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "First subject" });
    await screen.findByText("First backend body");

    fireEvent.click(screen.getByRole("button", { name: "让 Hermes 写回复" }));
    await waitFor(() => {
      expect(api.draftMessageReply).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: "account_1",
          messageId: "message_1",
          memoryScope: "recipient:first@example.com",
        }),
      );
    });

    fireEvent.click(
      within(screen.getByRole("region", { name: "邮件列表" })).getByRole(
        "button",
        { name: /Second subject/ },
      ),
    );
    await screen.findByRole("heading", { name: "Second subject" });
    await screen.findByText("Second backend body");
    expect(
      (screen.getByRole("button", {
        name: "让 Hermes 写回复",
      }) as HTMLButtonElement).disabled,
    ).toBe(false);

    await act(async () => {
      resolveReply({
        skillRunId: "run_stale_reply",
        skillId: "reply_draft",
        accountId: "account_1",
        messageId: "message_1",
        draftText: "This stale reply should not enter compose.",
      });
    });

    const composeBody = screen.queryByLabelText(
      "Compose body",
    ) as HTMLTextAreaElement | null;
    expect(composeBody?.value ?? "").not.toContain(
      "This stale reply should not enter compose.",
    );
    expect(screen.queryByText(/run_stale_reply/)).toBeNull();
  });

  it("uses Hermes quick reply with editable reply learning metadata", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    await screen.findByText("Live body from backend");

    fireEvent.click(
      screen.getByRole("button", { name: "让 Hermes 快速回复 感谢" }),
    );

    await waitFor(() => {
      expect(api.createComposeSeed).toHaveBeenCalledWith({
        accountId: "account_1",
        messageId: "message_1",
        mode: "reply",
      });
    });
    await waitFor(() => {
      expect(api.quickMessageReply).toHaveBeenCalledWith({
        accountId: "account_1",
        messageId: "message_1",
        scenario: "thanks",
        instruction: "Thank them warmly and keep the reply short.",
        tone: "warm professional",
        memoryScope: "recipient:client@example.com",
        memoryLayers: [
          "contact_memory",
          "writing_style_profile",
          "procedural_memory",
          "semantic_profile",
        ],
      });
    });
    expect(api.quickReply).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Compose body") as HTMLTextAreaElement).value).toBe(
      "Thanks, I will take a look.",
    );
    expect(await screen.findByText(/Hermes 已生成快速回复/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save composed draft" }));

    await waitFor(() => {
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [{ address: "client@example.com", name: "Live Client" }],
        subject: "Re: Live subject",
        bodyText: "Thanks, I will take a look.",
        source: "hermes_reply",
        replyToMessageId: "message_1",
        sourceMessageId: "message_1",
        hermesSkillRunId: "run_quick_1",
        hermesDraftText: "Thanks, I will take a look.",
      });
    });
  });

  it("saves Hermes-generated reply drafts with the skill run id for learning", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    await screen.findByText("Live body from backend");

    fireEvent.click(screen.getByRole("button", { name: "让 Hermes 写回复" }));
    await screen.findByText(/Hermes 已生成回复草稿/);
    fireEvent.click(screen.getByRole("button", { name: "Save composed draft" }));

    await waitFor(() => {
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [{ address: "client@example.com", name: "Live Client" }],
        subject: "Re: Live subject",
        bodyText: "Hi,\n\nI can confirm this plan.",
        source: "hermes_reply",
        replyToMessageId: "message_1",
        sourceMessageId: "message_1",
        hermesSkillRunId: "run_reply_1",
        hermesDraftText: "Hi,\n\nI can confirm this plan.",
      });
    });
  });

  it("keeps the original Hermes draft text when the composed reply is edited", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    await screen.findByText("Live body from backend");

    fireEvent.click(screen.getByRole("button", { name: "让 Hermes 写回复" }));
    await screen.findByText(/Hermes 已生成回复草稿/);
    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Hi,\n\nI edited this before sending." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save composed draft" }));

    await waitFor(() => {
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [{ address: "client@example.com", name: "Live Client" }],
        subject: "Re: Live subject",
        bodyText: "Hi,\n\nI edited this before sending.",
        source: "hermes_reply",
        replyToMessageId: "message_1",
        sourceMessageId: "message_1",
        hermesSkillRunId: "run_reply_1",
        hermesDraftText: "Hi,\n\nI can confirm this plan.",
      });
    });
  });

  it("sends Hermes-generated reply drafts with the skill run id for learning", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    await screen.findByText("Live body from backend");

    fireEvent.click(screen.getByRole("button", { name: "让 Hermes 写回复" }));
    await screen.findByText(/Hermes 已生成回复草稿/);
    fireEvent.click(screen.getByRole("button", { name: "Send composed draft now" }));

    await waitFor(() => {
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [{ address: "client@example.com", name: "Live Client" }],
        subject: "Re: Live subject",
        bodyText: "Hi,\n\nI can confirm this plan.",
        source: "hermes_reply",
        replyToMessageId: "message_1",
        sourceMessageId: "message_1",
        hermesSkillRunId: "run_reply_1",
        hermesDraftText: "Hi,\n\nI can confirm this plan.",
      });
    });
    await waitFor(() => {
      expect(api.sendMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        draftId: "draft_1",
      });
    });
  });

  it("keeps selected send-as identity when Hermes drafts a reply", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    await openComposeWindow();
    await screen.findByText(/support@demo\.site/);

    fireEvent.change(screen.getByLabelText("Compose from identity"), {
      target: { value: "alias:alias_1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "让 Hermes 写回复" }));

    await waitFor(() => {
      expect(api.createComposeSeed).toHaveBeenCalledWith({
        accountId: "account_1",
        messageId: "message_1",
        mode: "reply",
        from: { address: "support@demo.site", name: "Support" },
      });
    });
    await screen.findByText(/Hermes 已生成回复草稿/);
    fireEvent.click(screen.getByRole("button", { name: "Save composed draft" }));

    await waitFor(() => {
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        from: { address: "support@demo.site", name: "Support" },
        to: [{ address: "client@example.com", name: "Live Client" }],
        subject: "Re: Live subject",
        bodyText: "Hi,\n\nI can confirm this plan.",
        source: "hermes_reply",
        replyToMessageId: "message_1",
        sourceMessageId: "message_1",
        hermesSkillRunId: "run_reply_1",
        hermesDraftText: "Hi,\n\nI can confirm this plan.",
      });
    });
  });

  it("saves manual drafts with provider-native send-as identities", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    await openComposeWindow();
    await screen.findByText(/Team Inbox <team@example\.com> · Outlook共享邮箱/);

    fireEvent.change(screen.getByLabelText("Compose from identity"), {
      target: { value: "provider:identity_1" },
    });
    fireEvent.change(screen.getByLabelText("Compose recipients"), {
      target: { value: "lina@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Compose subject"), {
      target: { value: "Launch confirmation" },
    });
    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Please review the launch plan." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save composed draft" }));

    await waitFor(() => {
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        from: { address: "team@example.com", name: "Team Inbox" },
        to: [{ address: "lina@example.com" }],
        subject: "Launch confirmation",
        bodyText: "Please review the launch plan.",
        source: "manual",
      });
    });
  });

  it("previews Hermes replies through compose preview without learning fields", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    await screen.findByText("Live body from backend");

    fireEvent.click(screen.getByRole("button", { name: "让 Hermes 写回复" }));
    await screen.findByText(/Hermes 已生成回复草稿/);
    fireEvent.click(screen.getByRole("button", { name: "预览草稿" }));

    await waitFor(() => {
      expect(api.previewMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [{ address: "client@example.com", name: "Live Client" }],
        cc: [],
        bcc: [],
        subject: "Re: Live subject",
        bodyText: "Hi,\n\nI can confirm this plan.",
        source: "hermes_reply",
        replyToMessageId: "message_1",
        sourceMessageId: "message_1",
      });
    });
  });

  it("creates and sends a new composed message through backend compose routes", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    await openComposeWindow();

    fireEvent.change(screen.getByLabelText("Compose recipients"), {
      target: { value: "Lina <lina@example.com>, team@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Compose subject"), {
      target: { value: "Launch plan" },
    });
    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Please review the launch plan." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send composed draft now" }));

    await waitFor(() => {
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [
          { address: "lina@example.com", name: "Lina" },
          { address: "team@example.com" },
        ],
        subject: "Launch plan",
        bodyText: "Please review the launch plan.",
        source: "manual",
      });
    });
    await waitFor(() => {
      expect(api.sendMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        draftId: "draft_1",
      });
    });
    expect(await screen.findByText(/邮件已进入发送队列。/)).toBeTruthy();
  });

  it("adds and verifies an Outlook shared sender candidate from compose", async () => {
    const api = createApiFixture();
    const accountIdentity = {
      id: "account:account_1",
      accountId: "account_1",
      from: { address: "work@demo.site", name: "Work" },
      source: "account" as const,
      isDefault: true,
      verified: true,
    };
    const pendingCandidate = {
      id: "provider:identity_candidate",
      accountId: "account_1",
      from: { address: "shared@example.com", name: "Shared" },
      source: "provider_native" as const,
      isDefault: false,
      verified: false,
      provider: "graph",
      providerIdentityId: "shared@example.com",
      identityType: "shared_mailbox" as const,
      verificationState: "pending" as const,
      enabled: false,
    };
    const verifiedCandidate = {
      ...pendingCandidate,
      verified: true,
      verificationState: "verified" as const,
      enabled: true,
    };
    const targetVerifiedCandidate = {
      ...verifiedCandidate,
      sendMailTargetMode: "users" as const,
      userSendMailEligible: true,
      targetMailbox: {
        userPrincipalName: "shared-mailbox@example.com",
      },
      sentItemsBehavior: "from_mailbox" as const,
    };
    const verifiedIdentity = {
      id: "provider:identity_candidate",
      accountId: "account_1",
      from: { address: "shared@example.com", name: "Shared" },
      source: "provider_native" as const,
      isDefault: false,
      verified: true,
      provider: "graph",
      providerIdentityId: "shared@example.com",
      identityType: "shared_mailbox" as const,
    };

    vi.mocked(api.listSendIdentities)
      .mockResolvedValueOnce({
        accountId: "account_1",
        items: [accountIdentity],
        candidates: [],
      })
      .mockResolvedValueOnce({
        accountId: "account_1",
        items: [accountIdentity, verifiedIdentity],
        candidates: [verifiedCandidate],
      })
      .mockResolvedValueOnce({
        accountId: "account_1",
        items: [accountIdentity, verifiedIdentity],
        candidates: [targetVerifiedCandidate],
      });
    vi.mocked(api.addProviderSendIdentityCandidate).mockResolvedValue(
      pendingCandidate,
    );
    vi.mocked(api.verifyProviderSendIdentityCandidate).mockResolvedValue({
      accountId: "account_1",
      verified: true,
      candidate: verifiedCandidate,
    });
    vi.mocked(api.verifyProviderSendIdentityUserTarget).mockResolvedValue({
      accountId: "account_1",
      verified: true,
      candidate: targetVerifiedCandidate,
    });

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    await openComposeWindow();
    expect(screen.queryByText("Outlook 共享发件人")).toBeNull();
    await openAdvancedSenderPanel();

    fireEvent.change(screen.getByLabelText("Outlook shared sender address"), {
      target: { value: "shared@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Outlook shared sender name"), {
      target: { value: "Shared" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Add Outlook shared sender candidate",
      }),
    );

    await waitFor(() => {
      expect(api.addProviderSendIdentityCandidate).toHaveBeenCalledWith({
        accountId: "account_1",
        provider: "graph",
        address: "shared@example.com",
        name: "Shared",
        identityType: "shared_mailbox",
      });
    });
    expect(await screen.findByText("待验证")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Verify Outlook shared sender shared@example.com",
      }),
    );

    await waitFor(() => {
      expect(api.verifyProviderSendIdentityCandidate).toHaveBeenCalledWith({
        accountId: "account_1",
        candidateId: "provider:identity_candidate",
      });
    });
    expect(await screen.findByText(/共享发件人已验证：shared@example.com/)).toBeTruthy();
    expect(
      screen.getByRole("option", {
        name: /Shared <shared@example.com> · Outlook共享邮箱/,
      }),
    ).toBeTruthy();

    fireEvent.change(
      screen.getByLabelText("Outlook shared mailbox target shared@example.com"),
      {
        target: { value: "shared-mailbox@example.com" },
      },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Verify Outlook shared mailbox target shared@example.com",
      }),
    );

    await waitFor(() => {
      expect(api.verifyProviderSendIdentityUserTarget).toHaveBeenCalledWith({
        accountId: "account_1",
        candidateId: "provider:identity_candidate",
        targetMailbox: "shared-mailbox@example.com",
      });
    });
    expect(
      await screen.findByText(/共享发件箱 Sent Items 已启用：shared-mailbox@example.com/),
    ).toBeTruthy();
    expect(await screen.findByText("共享发件箱已启用")).toBeTruthy();
  });

  it("shows Outlook shared sender diagnostics without leaking raw Graph details", async () => {
    const api = createApiFixture();
    const accountIdentity = {
      id: "account:account_1",
      accountId: "account_1",
      from: { address: "work@demo.site", name: "Work" },
      source: "account" as const,
      isDefault: true,
      verified: true,
    };
    const candidate = {
      id: "provider:identity_candidate",
      accountId: "account_1",
      from: { address: "shared@example.com", name: "Shared" },
      source: "provider_native" as const,
      isDefault: false,
      verified: true,
      provider: "graph",
      providerIdentityId: "shared@example.com",
      identityType: "shared_mailbox" as const,
      verificationState: "verified" as const,
      enabled: true,
      userTargetVerificationError: "ErrorAccessDenied",
    };

    vi.mocked(api.listSendIdentities).mockResolvedValue({
      accountId: "account_1",
      items: [accountIdentity],
      candidates: [candidate],
    });
    vi.mocked(api.diagnoseProviderSendIdentityCandidate).mockResolvedValue({
      accountId: "account_1",
      candidateId: "provider:identity_candidate",
      provider: "graph",
      generatedAt: "2026-06-15T20:25:00.000Z",
      from: { address: "shared@example.com", name: "Shared" },
      identityType: "shared_mailbox",
      status: "target_verification_failed",
      summary:
        "From 可用，但共享邮箱 Sent Items 路径验证失败：ErrorAccessDenied。",
      sendPath: "me",
      sentItemsBehavior: "signed_in_user",
      discoverySupported: false,
      checks: [
        {
          id: "explicit_candidate",
          status: "info",
          title: "显式共享发件人",
          detail:
            "Microsoft Graph 不能可靠枚举当前用户可用的共享邮箱，本候选项由用户显式添加。",
        },
        {
          id: "sent_items_target",
          status: "fail",
          title: "共享邮箱 Sent Items",
          detail: "Graph 未接受共享邮箱目标路径：ErrorAccessDenied。",
          action: "验证共享邮箱目标路径",
        },
      ],
      nextActions: [
        "确认用户对共享邮箱具备 Full Access 或可用的 /users/{mailbox}/sendMail 权限。",
      ],
      candidate,
    });

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    await openComposeWindow();
    expect(screen.queryByText("Outlook 共享发件人")).toBeNull();
    await openAdvancedSenderPanel();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Diagnose Outlook shared sender shared@example.com",
      }),
    );

    await waitFor(() => {
      expect(api.diagnoseProviderSendIdentityCandidate).toHaveBeenCalledWith({
        accountId: "account_1",
        candidateId: "provider:identity_candidate",
      });
    });
    expect(
      await screen.findByLabelText(
        "Outlook shared sender diagnostics shared@example.com",
      ),
    ).toBeTruthy();
    expect(await screen.findByText("共享箱目标失败")).toBeTruthy();
    expect(await screen.findByText(/Graph 未接受共享邮箱目标路径/)).toBeTruthy();
    const pageText = document.body.textContent ?? "";
    expect(pageText).not.toContain("raw Graph innerError");
    expect(pageText).not.toContain("access-token");
    expect(pageText).not.toContain("refresh-token");
  });

  it("updates the saved composed draft instead of creating duplicates", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    await openComposeWindow();

    fireEvent.change(screen.getByLabelText("Compose recipients"), {
      target: { value: "lina@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Compose subject"), {
      target: { value: "Launch plan" },
    });
    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Initial draft body." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save composed draft" }));
    expect(await screen.findByText(/草稿已保存。/)).toBeTruthy();
    expect(await screen.findByText(/已保存草稿/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Updated draft body." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save composed draft" }));

    await waitFor(() => {
      expect(api.updateMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        draftId: "draft_1",
        to: [{ address: "lina@example.com" }],
        subject: "Launch plan",
        bodyText: "Updated draft body.",
        source: "manual",
        attachments: [],
      });
    });
    expect(api.createMailDraft).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/草稿已更新。/)).toBeTruthy();
  });

  it("sends a saved composed draft after updating the same draft id", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    await openComposeWindow();

    fireEvent.change(screen.getByLabelText("Compose recipients"), {
      target: { value: "lina@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Compose subject"), {
      target: { value: "Launch plan" },
    });
    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Initial draft body." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save composed draft" }));
    await screen.findByText(/草稿已保存。/);

    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Ready to send body." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send composed draft now" }));

    await waitFor(() => {
      expect(api.updateMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        draftId: "draft_1",
        to: [{ address: "lina@example.com" }],
        subject: "Launch plan",
        bodyText: "Ready to send body.",
        source: "manual",
        attachments: [],
      });
    });
    await waitFor(() => {
      expect(api.sendMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        draftId: "draft_1",
      });
    });
    expect(api.createMailDraft).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.updateMailDraft).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(api.sendMailDraft).mock.invocationCallOrder[0],
    );
  });

  it("does not send or recreate a saved draft when updating it fails", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    await openComposeWindow();

    fireEvent.change(screen.getByLabelText("Compose recipients"), {
      target: { value: "lina@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Compose subject"), {
      target: { value: "Launch plan" },
    });
    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Initial draft body." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save composed draft" }));
    await screen.findByText(/草稿已保存。/);

    vi.mocked(api.updateMailDraft).mockRejectedValueOnce(new Error("conflict"));
    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "This update will fail." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send composed draft now" }));

    await waitFor(() => {
      expect(api.updateMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        draftId: "draft_1",
        to: [{ address: "lina@example.com" }],
        subject: "Launch plan",
        bodyText: "This update will fail.",
        source: "manual",
        attachments: [],
      });
    });
    expect(api.createMailDraft).toHaveBeenCalledTimes(1);
    expect(api.sendMailDraft).not.toHaveBeenCalled();
    expect(await screen.findByText("写信操作失败。")).toBeTruthy();
  });

  it("sends Cc and Bcc from the compose panel through the draft payload", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    await openComposeWindow();

    fireEvent.change(screen.getByLabelText("Compose recipients"), {
      target: { value: "lina@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Compose cc"), {
      target: { value: "Ops <ops@example.com>" },
    });
    fireEvent.change(screen.getByLabelText("Compose bcc"), {
      target: { value: "audit@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Compose subject"), {
      target: { value: "Launch plan" },
    });
    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Please review the launch plan." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send composed draft now" }));

    await waitFor(() => {
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [{ address: "lina@example.com" }],
        cc: [{ address: "ops@example.com", name: "Ops" }],
        bcc: [{ address: "audit@example.com" }],
        subject: "Launch plan",
        bodyText: "Please review the launch plan.",
        source: "manual",
      });
    });
  });

  it("inserts a compose template into the draft body", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    await openComposeWindow();

    fireEvent.change(screen.getByLabelText("Compose recipients"), {
      target: { value: "lina@example.com" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Insert compose template 会议纪要" }),
    );
    expect((screen.getByLabelText("Compose subject") as HTMLInputElement).value).toBe(
      "会议纪要：",
    );
    expect((screen.getByLabelText("Compose body") as HTMLTextAreaElement).value).toContain(
      "- 决议：",
    );

    fireEvent.click(screen.getByRole("button", { name: "Save composed draft" }));

    await waitFor(() => {
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [{ address: "lina@example.com" }],
        subject: "会议纪要：",
        bodyText:
          "大家好，\n\n以下是本次会议纪要：\n\n- 决议：\n- 待办：\n- 截止时间：\n\n如有遗漏请直接补充。",
        source: "manual",
      });
    });
  });

  it("submits compose bodyHtml after rich formatting is used", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    await openComposeWindow();

    fireEvent.change(screen.getByLabelText("Compose recipients"), {
      target: { value: "lina@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Compose subject"), {
      target: { value: "Launch plan" },
    });
    const body = screen.getByLabelText("Compose body") as HTMLTextAreaElement;
    fireEvent.change(body, {
      target: { value: "Launch plan" },
    });
    body.focus();
    body.setSelectionRange(0, "Launch".length);
    fireEvent.click(screen.getByRole("button", { name: "Bold selected compose text" }));

    expect(body.value).toBe("**Launch** plan");

    fireEvent.click(screen.getByRole("button", { name: "预览草稿" }));
    await waitFor(() => {
      expect(api.previewMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [{ address: "lina@example.com" }],
        cc: [],
        bcc: [],
        subject: "Launch plan",
        bodyText: "**Launch** plan",
        bodyHtml: "<p><strong>Launch</strong> plan</p>",
        source: "manual",
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Save composed draft" }));
    await waitFor(() => {
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [{ address: "lina@example.com" }],
        subject: "Launch plan",
        bodyText: "**Launch** plan",
        bodyHtml: "<p><strong>Launch</strong> plan</p>",
        source: "manual",
      });
    });
    const reviewBody = await screen.findByLabelText("Compose review body");
    expect(reviewBody.querySelector("strong")?.textContent).toBe("Launch");
  });

  it("submits quoted compose bodyHtml after the quote tool is used", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    await openComposeWindow();

    fireEvent.change(screen.getByLabelText("Compose recipients"), {
      target: { value: "lina@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Compose subject"), {
      target: { value: "Launch quote" },
    });
    const body = screen.getByLabelText("Compose body") as HTMLTextAreaElement;
    fireEvent.change(body, {
      target: { value: "Please review this line" },
    });
    body.focus();
    body.setSelectionRange(0, body.value.length);
    fireEvent.click(screen.getByRole("button", { name: "Quote selected compose text" }));

    expect(body.value).toBe("> Please review this line");

    fireEvent.click(screen.getByRole("button", { name: "预览草稿" }));
    await waitFor(() => {
      expect(api.previewMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [{ address: "lina@example.com" }],
        cc: [],
        bcc: [],
        subject: "Launch quote",
        bodyText: "> Please review this line",
        bodyHtml: "<blockquote><p>Please review this line</p></blockquote>",
        source: "manual",
      });
    });
  });

  it("translates composed draft text through Hermes", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    await openComposeWindow();

    fireEvent.change(screen.getByLabelText("Compose recipients"), {
      target: { value: "lina@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Compose subject"), {
      target: { value: "发布计划" },
    });
    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "你好，请确认发布计划。" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "让 Hermes 翻译草稿" }),
    );

    await waitFor(() => {
      expect(api.translateText).toHaveBeenCalledWith({
        accountId: "account_1",
        text: "你好，请确认发布计划。",
        targetLanguage: "English",
        tone: "preserve intent, formatting cues, recipients, and commitments",
        memoryScope: "global",
        memoryLayers: ["writing_style_profile", "semantic_profile"],
      });
    });
    expect(await screen.findByText("Hermes 已翻译草稿。")).toBeTruthy();
    expect(screen.queryByText(/run_translate_1/)).toBeNull();
    expect((screen.getByLabelText("Compose body") as HTMLTextAreaElement).value).toBe(
      "Hello, please confirm the launch plan.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Save composed draft" }));

    await waitFor(() => {
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [{ address: "lina@example.com" }],
        subject: "发布计划",
        bodyText: "Hello, please confirm the launch plan.",
        source: "manual",
        hermesSkillRunId: "run_translate_1",
        hermesDraftText: "Hello, please confirm the launch plan.",
      });
    });
  });

  it("ignores stale Hermes composed draft translations after the body changes", async () => {
    const api = createApiFixture();
    let resolveTranslation: (result: HermesTranslateTextResult) => void = () => {};
    vi.mocked(api.translateText).mockImplementationOnce(
      async () =>
        new Promise<HermesTranslateTextResult>((resolve) => {
          resolveTranslation = resolve;
        }),
    );

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    await openComposeWindow();

    const body = screen.getByLabelText("Compose body") as HTMLTextAreaElement;
    fireEvent.change(body, {
      target: { value: "你好，请确认发布计划。" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "让 Hermes 翻译草稿" }),
    );

    await waitFor(() => {
      expect(api.translateText).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: "account_1",
          text: "你好，请确认发布计划。",
        }),
      );
    });
    fireEvent.change(body, {
      target: { value: "我已经手动改了正文。" },
    });

    await act(async () => {
      resolveTranslation({
        skillRunId: "run_translate_stale",
        skillId: "translate_text",
        sourceLanguage: "auto",
        targetLanguage: "English",
        translatedText: "Stale translated draft.",
      });
    });

    expect(body.value).toBe("我已经手动改了正文。");
    expect(screen.queryByText(/run_translate_stale/)).toBeNull();
  });

  it("explains when Hermes composed draft translation is disabled by skill settings", async () => {
    const api = createApiFixture();
    vi.mocked(api.translateText).mockRejectedValueOnce(
      new ApiRequestError(403, "hermes_skill_disabled", {
        error: "hermes_skill_disabled",
        skillId: "translate_text",
      }),
    );

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    await openComposeWindow();

    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "你好，请确认发布计划。" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "让 Hermes 翻译草稿" }),
    );

    expect(
      await screen.findByText(
        "Hermes 邮件翻译暂时不可用。",
      ),
    ).toBeTruthy();
    expect((screen.getByLabelText("Compose body") as HTMLTextAreaElement).value).toBe(
      "你好，请确认发布计划。",
    );

    expect(screen.queryByRole("button", { name: "打开能力选项" })).toBeNull();
    expect(screen.queryByLabelText("Hermes skill settings")).toBeNull();
  });

  it("adds uploaded files to the composed draft payload", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    await openComposeWindow();

    fireEvent.change(screen.getByLabelText("Compose recipients"), {
      target: { value: "lina@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Compose subject"), {
      target: { value: "Launch plan" },
    });
    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Please review the launch plan." },
    });
    fireEvent.change(screen.getByLabelText("Attach files to compose"), {
      target: {
        files: [new File(["hello"], "brief.txt", { type: "text/plain" })],
      },
    });

    expect(await screen.findByText("brief.txt")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save composed draft" }));

    await waitFor(() => {
      expect(api.uploadComposeAttachment).toHaveBeenCalledWith({
        accountId: "account_1",
        file: expect.objectContaining({
          name: "brief.txt",
          size: 5,
          type: "text/plain",
        }),
      });
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [{ address: "lina@example.com" }],
        subject: "Launch plan",
        bodyText: "Please review the launch plan.",
        source: "manual",
        attachments: [
          expect.objectContaining({
            source: "uploaded_file",
            filename: "brief.txt",
            contentType: "text/plain",
            byteSize: 5,
            inline: false,
            storageKey: "11111111-1111-4111-8111-111111111111",
          }),
        ],
      });
    });
  });

  it("rejects oversized compose attachments before uploading", async () => {
    const api = createApiFixture();
    const oversizedFile = {
      name: "too-large.bin",
      size: 25 * 1024 * 1024 + 1,
      type: "application/octet-stream",
    } as File;

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    await openComposeWindow();

    fireEvent.change(screen.getByLabelText("Attach files to compose"), {
      target: { files: [oversizedFile] },
    });

    expect(await screen.findByText("附件总大小不能超过 25 MB。")).toBeTruthy();
    expect(api.uploadComposeAttachment).not.toHaveBeenCalled();
  });

  it("shows a specific compose attachment upload limit error", async () => {
    const api = createApiFixture();
    vi.mocked(api.uploadComposeAttachment).mockRejectedValueOnce(
      new ApiRequestError(413, "request_body_too_large", {
        error: "request_body_too_large",
      }),
    );

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    await openComposeWindow();

    fireEvent.change(screen.getByLabelText("Attach files to compose"), {
      target: {
        files: [new File(["hello"], "brief.txt", { type: "text/plain" })],
      },
    });

    expect(
      await screen.findByText("附件超过 25 MB，请压缩或拆分后再上传。"),
    ).toBeTruthy();
    expect(api.createMailDraft).not.toHaveBeenCalled();
  });

  it("keeps existing compose attachments when a later upload fails", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    await openComposeWindow();

    fireEvent.change(screen.getByLabelText("Attach files to compose"), {
      target: {
        files: [new File(["hello"], "brief.txt", { type: "text/plain" })],
      },
    });
    expect(await screen.findByText("brief.txt")).toBeTruthy();

    vi.mocked(api.uploadComposeAttachment).mockRejectedValueOnce(
      new Error("network failed"),
    );
    fireEvent.change(screen.getByLabelText("Attach files to compose"), {
      target: {
        files: [new File(["later"], "later.txt", { type: "text/plain" })],
      },
    });

    expect(
      await screen.findByText("附件上传失败。"),
    ).toBeTruthy();
    expect(screen.getByText("brief.txt")).toBeTruthy();
    expect(screen.queryByText("later.txt")).toBeNull();

    fireEvent.change(screen.getByLabelText("Compose recipients"), {
      target: { value: "lina@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Compose subject"), {
      target: { value: "Launch plan" },
    });
    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Please review the launch plan." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save composed draft" }));

    await waitFor(() => {
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [{ address: "lina@example.com" }],
        subject: "Launch plan",
        bodyText: "Please review the launch plan.",
        source: "manual",
        attachments: [
          expect.objectContaining({
            filename: "brief.txt",
            storageKey: "11111111-1111-4111-8111-111111111111",
          }),
        ],
      });
    });
  });

  it("sends selected send-as identity from the compose panel", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    await openComposeWindow();
    await screen.findByText(/support@demo\.site/);

    fireEvent.change(screen.getByLabelText("Compose from identity"), {
      target: { value: "alias:alias_1" },
    });
    fireEvent.change(screen.getByLabelText("Compose recipients"), {
      target: { value: "lina@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Compose subject"), {
      target: { value: "Launch plan" },
    });
    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Please review the launch plan." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send composed draft now" }));

    await waitFor(() => {
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        from: { address: "support@demo.site", name: "Support" },
        to: [{ address: "lina@example.com" }],
        subject: "Launch plan",
        bodyText: "Please review the launch plan.",
        source: "manual",
      });
    });
  });

  it("fills the compose panel from a backend reply-all seed", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    fireEvent.click(screen.getByRole("button", { name: "回复全部" }));

    await waitFor(() => {
      expect(api.createComposeSeed).toHaveBeenCalledWith({
        accountId: "account_1",
        messageId: "message_1",
        mode: "reply_all",
      });
    });
    await waitFor(() => {
      expect(
        (screen.getByLabelText("Compose recipients") as HTMLInputElement).value,
      ).toBe("Live Client <client@example.com>");
      expect((screen.getByLabelText("Compose cc") as HTMLInputElement).value).toBe(
        "Ops <ops@example.com>",
      );
      expect(
        (screen.getByLabelText("Compose subject") as HTMLInputElement).value,
      ).toBe("Re: Live subject");
      expect(
        (screen.getByLabelText("Compose body") as HTMLTextAreaElement).value,
      ).toContain("> Live body from backend");
    });

    fireEvent.click(screen.getByRole("button", { name: "Save composed draft" }));

    await waitFor(() => {
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [{ address: "client@example.com", name: "Live Client" }],
        cc: [{ address: "ops@example.com", name: "Ops" }],
        subject: "Re: Live subject",
        bodyText:
          "On Sat, Live Client <client@example.com> wrote:\n> Live body from backend",
        source: "reply_all",
        replyToMessageId: "message_1",
        sourceMessageId: "message_1",
      });
    });
  });

  it("carries forwarded seed attachments into the composed draft payload", async () => {
    const api = createApiFixture();
    vi.mocked(api.createComposeSeed).mockResolvedValueOnce({
      accountId: "account_1",
      messageId: "message_1",
      mode: "forward",
      to: [],
      cc: [],
      bcc: [],
      subject: "Fwd: Live subject",
      bodyText:
        "\n\n---------- Forwarded message ---------\nFrom: Live Client <client@example.com>\nSubject: Live subject\n\nLive body from backend",
      source: "forward",
      sourceMessageId: "message_1",
      attachments: [
        {
          id: "attachment_1",
          filename: "proposal.pdf",
          contentType: "application/pdf",
          byteSize: 2048,
          inline: false,
        },
      ],
      warnings: ["missing_recipient"],
      generatedAt: "2026-06-13T10:00:00.000Z",
    });

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    fireEvent.click(screen.getByRole("button", { name: "转发" }));

    expect(await screen.findByText("proposal.pdf")).toBeTruthy();
    expect(screen.getByText("2 KB")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Compose recipients"), {
      target: { value: "lina@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save composed draft" }));

    await waitFor(() => {
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [{ address: "lina@example.com" }],
        subject: "Fwd: Live subject",
        bodyText:
          "---------- Forwarded message ---------\nFrom: Live Client <client@example.com>\nSubject: Live subject\n\nLive body from backend",
        source: "forward",
        sourceMessageId: "message_1",
        attachments: [
          {
            id: "attachment_1",
            source: "message_attachment",
            attachmentId: "attachment_1",
            filename: "proposal.pdf",
            contentType: "application/pdf",
            byteSize: 2048,
            inline: false,
          },
        ],
      });
    });
  });

  it("previews composed mail without sending it", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    await openComposeWindow();

    fireEvent.change(screen.getByLabelText("Compose recipients"), {
      target: { value: "lina@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Compose subject"), {
      target: { value: "Launch plan" },
    });
    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Please review the launch plan." },
    });
    fireEvent.click(screen.getByRole("button", { name: "预览草稿" }));

    await waitFor(() => {
      expect(api.previewMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [{ address: "lina@example.com" }],
        cc: [],
        bcc: [],
        subject: "Launch plan",
        bodyText: "Please review the launch plan.",
        source: "manual",
      });
    });
    expect(api.sendMailDraft).not.toHaveBeenCalled();
    const review = await screen.findByLabelText("Compose review");
    expect(within(review).getByText("可发送预览")).toBeTruthy();
    expect(within(review).getByText("Launch plan")).toBeTruthy();
    expect(within(screen.getByLabelText("Compose review body")).getByText(
      "Please review the launch plan.",
    )).toBeTruthy();
    expect(within(screen.getByLabelText("Compose review attachments")).getByText(
      "附件 0",
    )).toBeTruthy();
  });

  it("polishes a composed draft through Hermes before saving it", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    await openComposeWindow();

    fireEvent.change(screen.getByLabelText("Compose recipients"), {
      target: { value: "lina@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Compose subject"), {
      target: { value: "Launch plan" },
    });
    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "please review launch plan" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "让 Hermes 润色草稿",
      }),
    );

    await waitFor(() => {
      expect(api.rewritePolishDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        text: "please review launch plan",
        action: "polish",
        instruction:
          "Polish this email while preserving intent, recipient details, and concrete commitments.",
        tone: "clear professional",
      });
    });
    expect((screen.getByLabelText("Compose body") as HTMLTextAreaElement).value).toBe(
      "Hi Lina,\n\nPlease review the launch plan today.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Save composed draft" }));

    await waitFor(() => {
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [{ address: "lina@example.com" }],
        subject: "Launch plan",
        bodyText: "Hi Lina,\n\nPlease review the launch plan today.",
        source: "manual",
        hermesSkillRunId: "run_rewrite_1",
        hermesDraftText: "Hi Lina,\n\nPlease review the launch plan today.",
      });
    });
  });

  it("ignores stale Hermes polished drafts after the body changes", async () => {
    const api = createApiFixture();
    let resolveRewrite: (result: HermesRewritePolishResult) => void = () => {};
    vi.mocked(api.rewritePolishDraft).mockImplementationOnce(
      async () =>
        new Promise<HermesRewritePolishResult>((resolve) => {
          resolveRewrite = resolve;
        }),
    );

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    await openComposeWindow();

    const body = screen.getByLabelText("Compose body") as HTMLTextAreaElement;
    fireEvent.change(body, {
      target: { value: "please review launch plan" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "让 Hermes 润色草稿",
      }),
    );

    await waitFor(() => {
      expect(api.rewritePolishDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: "account_1",
          text: "please review launch plan",
        }),
      );
    });
    fireEvent.change(body, {
      target: { value: "I edited this draft myself." },
    });

    await act(async () => {
      resolveRewrite({
        skillRunId: "run_rewrite_stale",
        skillId: "rewrite_polish",
        action: "polish",
        rewrittenText: "Stale polished draft.",
        editable: true,
        sendsDirectly: false,
      });
    });

    expect(body.value).toBe("I edited this draft myself.");
    expect(screen.queryByText(/run_rewrite_stale/)).toBeNull();
  });

  it("keeps the Hermes polished text when the user edits before saving", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    await openComposeWindow();

    fireEvent.change(screen.getByLabelText("Compose recipients"), {
      target: { value: "lina@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Compose subject"), {
      target: { value: "Launch plan" },
    });
    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "please review launch plan" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "让 Hermes 润色草稿",
      }),
    );
    await waitFor(() => {
      expect(api.rewritePolishDraft).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Hi Lina,\n\nPlease review the launch plan today. Thanks." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save composed draft" }));

    await waitFor(() => {
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [{ address: "lina@example.com" }],
        subject: "Launch plan",
        bodyText: "Hi Lina,\n\nPlease review the launch plan today. Thanks.",
        source: "manual",
        hermesSkillRunId: "run_rewrite_1",
        hermesDraftText: "Hi Lina,\n\nPlease review the launch plan today.",
      });
    });
  });

  it("sends Hermes-polished composed drafts with rewrite metadata", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    await openComposeWindow();

    fireEvent.change(screen.getByLabelText("Compose recipients"), {
      target: { value: "lina@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Compose subject"), {
      target: { value: "Launch plan" },
    });
    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "please review launch plan" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "让 Hermes 润色草稿",
      }),
    );
    await waitFor(() => {
      expect(api.rewritePolishDraft).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Send composed draft now" }));

    await waitFor(() => {
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [{ address: "lina@example.com" }],
        subject: "Launch plan",
        bodyText: "Hi Lina,\n\nPlease review the launch plan today.",
        source: "manual",
        hermesSkillRunId: "run_rewrite_1",
        hermesDraftText: "Hi Lina,\n\nPlease review the launch plan today.",
      });
    });
    await waitFor(() => {
      expect(api.sendMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        draftId: "draft_1",
      });
    });
  });

  it("refreshes the outbox after immediate sends enter the background queue", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    await waitFor(() => {
      expect(api.listOutbox).toHaveBeenCalledWith({
        accountId: "account_1",
        limit: 20,
      });
    });
    vi.mocked(api.listOutbox).mockClear();
    await openComposeWindow();

    fireEvent.change(screen.getByLabelText("Compose recipients"), {
      target: { value: "lina@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Compose subject"), {
      target: { value: "Launch plan" },
    });
    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Send this through the background queue." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send composed draft now" }));

    await waitFor(() => {
      expect(api.sendMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        draftId: "draft_1",
      });
    });
    await waitFor(() => {
      expect(api.listOutbox).toHaveBeenCalledWith({
        accountId: "account_1",
        limit: 20,
      });
    });
    expect(
      vi.mocked(api.sendMailDraft).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(api.listOutbox).mock.invocationCallOrder[0]);
    expect(await screen.findByText(/邮件已进入发送队列。/)).toBeTruthy();
  });

  it("schedules composed drafts and refreshes the outbox", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    await openComposeWindow();

    fireEvent.change(screen.getByLabelText("Compose recipients"), {
      target: { value: "lina@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Compose subject"), {
      target: { value: "Tomorrow review" },
    });
    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Send this tomorrow morning." },
    });
    fireEvent.change(screen.getByLabelText("Compose scheduled time"), {
      target: { value: "2026-06-14T09:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Schedule composed draft" }));

    await waitFor(() => {
      expect(api.scheduleMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        draftId: "draft_1",
        scheduledAt: "2026-06-14T09:30:00.000Z",
      });
    });
    expect(vi.mocked(api.createMailDraft).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(api.scheduleMailDraft).mock.invocationCallOrder[0],
    );
    await waitFor(() => {
      expect(api.listOutbox).toHaveBeenCalledWith({
        accountId: "account_1",
        limit: 20,
      });
    });
    expect(await screen.findByText(/邮件已定时/)).toBeTruthy();
  });

  it("schedules a saved composed draft after updating the same draft id", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    await openComposeWindow();

    fireEvent.change(screen.getByLabelText("Compose recipients"), {
      target: { value: "lina@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Compose subject"), {
      target: { value: "Tomorrow review" },
    });
    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Initial scheduled body." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save composed draft" }));
    await screen.findByText(/草稿已保存。/);

    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Updated scheduled body." },
    });
    fireEvent.change(screen.getByLabelText("Compose scheduled time"), {
      target: { value: "2026-06-14T09:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Schedule composed draft" }));

    await waitFor(() => {
      expect(api.updateMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        draftId: "draft_1",
        to: [{ address: "lina@example.com" }],
        subject: "Tomorrow review",
        bodyText: "Updated scheduled body.",
        source: "manual",
        attachments: [],
      });
    });
    await waitFor(() => {
      expect(api.scheduleMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        draftId: "draft_1",
        scheduledAt: "2026-06-14T09:30:00.000Z",
      });
    });
    expect(api.createMailDraft).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(api.updateMailDraft).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(api.scheduleMailDraft).mock.invocationCallOrder[0]);
  });

  it("auto-saves new composed drafts after the user pauses", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    await openComposeWindow();
    vi.useFakeTimers();

    fireEvent.change(screen.getByLabelText("Compose recipients"), {
      target: { value: "lina@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Compose subject"), {
      target: { value: "Auto saved subject" },
    });
    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Auto save this draft after a pause." },
    });

    act(() => {
      vi.advanceTimersByTime(1_999);
    });
    expect(api.createMailDraft).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(api.createMailDraft).toHaveBeenCalledWith({
      accountId: "account_1",
      to: [{ address: "lina@example.com" }],
      subject: "Auto saved subject",
      bodyText: "Auto save this draft after a pause.",
      source: "manual",
    });
    expect(screen.getByText(/已自动保存/)).toBeTruthy();
    expect(api.listMailDrafts).toHaveBeenCalledTimes(2);
  });

  it("auto-saves edits to a loaded saved draft without creating a replacement", async () => {
    const api = createApiFixture();
    vi.mocked(api.listMailDrafts).mockResolvedValue({
      accountId: "account_1",
      items: [
        mailDraftFixture({
          id: "draft_saved",
          subject: "Saved subject",
          bodyText: "Saved body.",
        }),
      ],
    });

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    await openComposeWindow();
    await screen.findByText("Saved subject");
    vi.useFakeTimers();
    fireEvent.click(
      screen.getByRole("button", { name: "编辑草稿 Saved subject" }),
    );

    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.updateMailDraft).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Autosaved edited body." },
    });
    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(api.updateMailDraft).toHaveBeenCalledWith({
      accountId: "account_1",
      draftId: "draft_saved",
      to: [{ address: "client@example.com", name: "Client" }],
      subject: "Saved subject",
      bodyText: "Autosaved edited body.",
      source: "manual",
      attachments: [],
      replyToMessageId: "message_1",
    });
    expect(api.createMailDraft).not.toHaveBeenCalled();
  });

  it("does not auto-save scheduled outbox draft edits", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await openComposeWindow();
    await screen.findByText("定时邮件");
    fireEvent.click(
      screen.getByRole("button", { name: "编辑待发邮件" }),
    );
    await screen.findByText(/待发草稿已打开。/);
    vi.useFakeTimers();

    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Scheduled body should not auto-save." },
    });
    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(api.updateScheduledDraft).not.toHaveBeenCalled();
    expect(api.updateMailDraft).not.toHaveBeenCalled();
    expect(api.createMailDraft).not.toHaveBeenCalled();
  });

  it("does not auto-save again after sending clears the compose form", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    await openComposeWindow();
    vi.useFakeTimers();

    fireEvent.change(screen.getByLabelText("Compose recipients"), {
      target: { value: "lina@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Compose subject"), {
      target: { value: "Send without trailing autosave" },
    });
    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Send this body now." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send composed draft now" }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createMailDraft).toHaveBeenCalledTimes(1);
    expect(api.sendMailDraft).toHaveBeenCalledWith({
      accountId: "account_1",
      draftId: "draft_1",
    });

    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
    });
    expect(api.createMailDraft).toHaveBeenCalledTimes(1);
    expect(api.updateMailDraft).not.toHaveBeenCalled();
  });

  it("sends through the in-flight autosaved draft instead of creating a duplicate", async () => {
    const api = createApiFixture();
    let resolveAutosave: (draft: MailDraftDto) => void = () => {};
    vi.mocked(api.createMailDraft).mockImplementationOnce(
      async () =>
        new Promise<MailDraftDto>((resolve) => {
          resolveAutosave = resolve;
        }),
    );

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    await openComposeWindow();
    vi.useFakeTimers();

    fireEvent.change(screen.getByLabelText("Compose recipients"), {
      target: { value: "lina@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Compose subject"), {
      target: { value: "Race-safe send" },
    });
    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Do not leave a duplicate draft behind." },
    });
    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
    });
    expect(api.createMailDraft).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Send composed draft now" }));
    await act(async () => {
      resolveAutosave(mailDraftFixture({ id: "draft_autosave" }));
      await Promise.resolve();
      await Promise.resolve();
    });
    vi.useRealTimers();

    await waitFor(() => {
      expect(api.sendMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        draftId: "draft_autosave",
      });
    });
    expect(api.createMailDraft).toHaveBeenCalledTimes(1);
    expect(api.updateMailDraft).not.toHaveBeenCalled();
  });

  it("loads saved compose drafts into the compose panel for editing", async () => {
    const api = createApiFixture();
    vi.mocked(api.listMailDrafts).mockResolvedValue({
      accountId: "account_1",
      items: [
        mailDraftFixture({
          id: "draft_saved",
          subject: "Saved subject",
          bodyText: "Saved body.",
          updatedAt: "2026-06-13T11:00:00.000Z",
        }),
      ],
    });

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    await openComposeWindow();
    await screen.findByText("Saved subject");
    expect(document.body.textContent).not.toContain("draft_saved");

    fireEvent.click(
      screen.getByRole("button", { name: "编辑草稿 Saved subject" }),
    );

    expect((screen.getByLabelText("Compose subject") as HTMLInputElement).value).toBe(
      "Saved subject",
    );
    expect((screen.getByLabelText("Compose body") as HTMLTextAreaElement).value).toBe(
      "Saved body.",
    );
    expect(screen.getAllByText(/已保存草稿/).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Edited saved body." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save composed draft" }));

    await waitFor(() => {
      expect(api.updateMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        draftId: "draft_saved",
        to: [{ address: "client@example.com", name: "Client" }],
        subject: "Saved subject",
        bodyText: "Edited saved body.",
        source: "manual",
        attachments: [],
        replyToMessageId: "message_1",
      });
    });
    expect(api.createMailDraft).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(api.listMailDrafts).toHaveBeenCalledTimes(2);
    });
  });

  it("sends a loaded saved draft after updating the same draft id", async () => {
    const api = createApiFixture();
    vi.mocked(api.listMailDrafts).mockResolvedValue({
      accountId: "account_1",
      items: [
        mailDraftFixture({
          id: "draft_saved",
          subject: "Saved subject",
          bodyText: "Saved body.",
        }),
      ],
    });

    render(<App api={api} defaultAccountId="account_1" />);
    await openComposeWindow();
    await screen.findByText("Saved subject");
    fireEvent.click(
      screen.getByRole("button", { name: "编辑草稿 Saved subject" }),
    );
    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Send edited saved body." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send composed draft now" }));

    await waitFor(() => {
      expect(api.updateMailDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: "account_1",
          draftId: "draft_saved",
          bodyText: "Send edited saved body.",
        }),
      );
    });
    await waitFor(() => {
      expect(api.sendMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        draftId: "draft_saved",
      });
    });
    expect(api.createMailDraft).not.toHaveBeenCalled();
    expect(
      vi.mocked(api.updateMailDraft).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(api.sendMailDraft).mock.invocationCallOrder[0]);
  });

  it("manages scheduled outbox items through backend routes", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await openComposeWindow();
    await screen.findByText("定时邮件");

    fireEvent.change(screen.getByLabelText("调整发送时间"), {
      target: { value: "2026-06-14T12:30" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "调整待发时间" }),
    );

    await waitFor(() => {
      expect(api.rescheduleScheduledSend).toHaveBeenCalledWith({
        accountId: "account_1",
        scheduledId: "schedule_1",
        scheduledAt: "2026-06-14T12:30:00.000Z",
      });
    });

    fireEvent.click(
      screen.getByRole("button", { name: "立即发送待发邮件" }),
    );
    await waitFor(() => {
      expect(api.sendScheduledNow).toHaveBeenCalledWith({
        accountId: "account_1",
        scheduledId: "schedule_1",
      });
    });

    fireEvent.click(
      screen.getByRole("button", { name: "取消待发邮件" }),
    );
    await waitFor(() => {
      expect(api.cancelScheduledSend).toHaveBeenCalledWith({
        accountId: "account_1",
        scheduledId: "schedule_1",
      });
    });
  });

  it("loads an outbox draft into the compose panel for editing", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await openComposeWindow();
    await screen.findByText("定时邮件");
    expect(document.body.textContent).not.toContain("draft_1");
    expect(document.body.textContent).not.toContain("schedule_1");

    fireEvent.click(
      screen.getByRole("button", { name: "编辑待发邮件" }),
    );

    await waitFor(() => {
      expect(api.getScheduledDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        scheduledId: "schedule_1",
      });
    });
    expect((screen.getByLabelText("Compose subject") as HTMLInputElement).value).toBe(
      "Scheduled subject",
    );
    expect((screen.getByLabelText("Compose body") as HTMLTextAreaElement).value).toBe(
      "Scheduled body",
    );
    expect((screen.getByLabelText("Compose recipients") as HTMLInputElement).value).toBe(
      "Client <client@example.com>",
    );
    expect(screen.getByText(/已加入待发/)).toBeTruthy();
    expect(screen.getByText("plan.pdf")).toBeTruthy();
  });

  it("ignores stale outbox draft loads after selecting a saved draft", async () => {
    const api = createApiFixture();
    let resolveScheduledDraft: (detail: Awaited<ReturnType<EmailHubApi["getScheduledDraft"]>>) => void = () => {};
    vi.mocked(api.listMailDrafts).mockResolvedValue({
      accountId: "account_1",
      items: [
        mailDraftFixture({
          id: "draft_saved",
          subject: "Saved subject",
          bodyText: "Saved body.",
        }),
      ],
    });
    vi.mocked(api.getScheduledDraft).mockImplementationOnce(
      async () =>
        new Promise((resolve) => {
          resolveScheduledDraft = resolve;
        }),
    );

    render(<App api={api} defaultAccountId="account_1" />);
    await openComposeWindow();
    await screen.findByText("Saved subject");
    await screen.findByText("定时邮件");

    fireEvent.click(screen.getByRole("button", { name: "编辑待发邮件" }));
    await waitFor(() => {
      expect(api.getScheduledDraft).toHaveBeenCalled();
    });
    fireEvent.click(screen.getByRole("button", { name: "编辑草稿 Saved subject" }));

    await act(async () => {
      resolveScheduledDraft({
        scheduledSend: scheduledSendFixture(),
        draft: mailDraftFixture({
          status: "scheduled",
          subject: "Stale scheduled subject",
          bodyText: "Stale scheduled body.",
        }),
      });
      await Promise.resolve();
    });

    expect((screen.getByLabelText("Compose subject") as HTMLInputElement).value).toBe(
      "Saved subject",
    );
    expect((screen.getByLabelText("Compose body") as HTMLTextAreaElement).value).toBe(
      "Saved body.",
    );
  });

  it("updates an edited outbox draft without creating a replacement", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await openComposeWindow();
    await screen.findByText("定时邮件");
    fireEvent.click(
      screen.getByRole("button", { name: "编辑待发邮件" }),
    );
    await screen.findByText(/待发草稿已打开。/);

    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Edited scheduled body." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save composed draft" }));

    await waitFor(() => {
      expect(api.updateScheduledDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        scheduledId: "schedule_1",
        to: [{ address: "client@example.com", name: "Client" }],
        subject: "Scheduled subject",
        bodyText: "Edited scheduled body.",
        source: "manual",
        replyToMessageId: "message_1",
        attachments: [
          {
            id: "upload_1",
            source: "uploaded_file",
            attachmentId: "upload_1",
            filename: "plan.pdf",
            contentType: "application/pdf",
            byteSize: 4,
            inline: false,
          },
        ],
      });
    });
    expect(api.createMailDraft).not.toHaveBeenCalled();
    expect(api.updateMailDraft).not.toHaveBeenCalled();
    expect(await screen.findByText(/待发草稿已更新。/)).toBeTruthy();
  });

  it("clears attachments from an edited outbox draft", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await openComposeWindow();
    await screen.findByText("定时邮件");
    fireEvent.click(
      screen.getByRole("button", { name: "编辑待发邮件" }),
    );
    await screen.findByText(/待发草稿已打开。/);
    expect(screen.getByText("plan.pdf")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Remove attachment plan.pdf" }),
    );
    expect(screen.queryByText("plan.pdf")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save composed draft" }));

    await waitFor(() => {
      expect(api.updateScheduledDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        scheduledId: "schedule_1",
        to: [{ address: "client@example.com", name: "Client" }],
        subject: "Scheduled subject",
        bodyText: "Scheduled body",
        source: "manual",
        replyToMessageId: "message_1",
        attachments: [],
      });
    });
  });

  it("sends an edited outbox draft through the scheduled item", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await openComposeWindow();
    await screen.findByText("定时邮件");
    fireEvent.click(
      screen.getByRole("button", { name: "编辑待发邮件" }),
    );
    await screen.findByText(/待发草稿已打开。/);

    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Send the edited scheduled body now." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send composed draft now" }));

    await waitFor(() => {
      expect(api.updateScheduledDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: "account_1",
          scheduledId: "schedule_1",
          bodyText: "Send the edited scheduled body now.",
        }),
      );
    });
    await waitFor(() => {
      expect(api.sendScheduledNow).toHaveBeenCalledWith({
        accountId: "account_1",
        scheduledId: "schedule_1",
      });
    });
    expect(api.sendMailDraft).not.toHaveBeenCalled();
    expect(api.createMailDraft).not.toHaveBeenCalled();
  });

  it("reschedules an edited outbox draft after updating the same scheduled id", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await openComposeWindow();
    await screen.findByText("定时邮件");
    fireEvent.click(
      screen.getByRole("button", { name: "编辑待发邮件" }),
    );
    await screen.findByText(/待发草稿已打开。/);

    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Edited then rescheduled body." },
    });
    fireEvent.change(screen.getByLabelText("Compose scheduled time"), {
      target: { value: "2026-06-14T12:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Schedule composed draft" }));

    await waitFor(() => {
      expect(api.updateScheduledDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: "account_1",
          scheduledId: "schedule_1",
          bodyText: "Edited then rescheduled body.",
        }),
      );
    });
    await waitFor(() => {
      expect(api.rescheduleScheduledSend).toHaveBeenCalledWith({
        accountId: "account_1",
        scheduledId: "schedule_1",
        scheduledAt: "2026-06-14T12:30:00.000Z",
      });
    });
    expect(api.scheduleMailDraft).not.toHaveBeenCalled();
    expect(api.createMailDraft).not.toHaveBeenCalled();
  });

  it("does not send an outbox draft when updating it fails", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await openComposeWindow();
    await screen.findByText("定时邮件");
    fireEvent.click(
      screen.getByRole("button", { name: "编辑待发邮件" }),
    );
    await screen.findByText(/待发草稿已打开。/);

    vi.mocked(api.updateScheduledDraft).mockRejectedValueOnce(
      new Error("scheduled draft was claimed"),
    );
    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "This update will fail." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send composed draft now" }));

    await waitFor(() => {
      expect(api.updateScheduledDraft).toHaveBeenCalled();
    });
    expect(api.sendScheduledNow).not.toHaveBeenCalled();
    expect(api.sendMailDraft).not.toHaveBeenCalled();
    expect(await screen.findByText("写信操作失败。")).toBeTruthy();
  });
});
