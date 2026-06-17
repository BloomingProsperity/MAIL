import { describe, expect, it } from "vitest";

import {
  buildComposePreviewWarnings,
  estimateComposeDraftSize,
} from "../src/mail-compose/compose-preview-warnings";
import {
  createMailComposeService,
  type MailSendIdentityStore,
  type MailComposeStore,
} from "../src/mail-compose/mail-compose";

describe("compose preview warnings", () => {
  it("detects duplicate recipients, possible missing attachments, and external recipients", () => {
    const warnings = buildComposePreviewWarnings({
      from: { address: "me@example.com" },
      to: [
        { address: "Client@External.test" },
        { address: " teammate@example.com " },
      ],
      cc: [{ address: "client@external.test" }],
      bcc: [],
      subject: "Proposal attached",
      bodyText: "Please see the attached proposal.",
      attachments: [],
    });

    expect(warnings).toEqual([
      "duplicate_recipient",
      "possible_missing_attachment",
      "external_recipient_warning",
    ]);
  });

  it("does not raise soft safety warnings when attachments and internal recipients are consistent", () => {
    const warnings = buildComposePreviewWarnings({
      from: { address: "me@example.com" },
      to: [{ address: "teammate@example.com" }],
      subject: "Proposal attached",
      bodyText: "Please see the attached proposal.",
      attachments: [{}],
    });

    expect(warnings).toEqual([]);
    expect(
      estimateComposeDraftSize({
        to: [{ address: "teammate@example.com", name: "Team Mate" }],
        subject: "Proposal attached",
        bodyText: "Please see the attached proposal.",
      }),
    ).toBeGreaterThan(0);
  });

  it("returns the safety warnings through the compose preview service", async () => {
    const service = createMailComposeService({
      store: {} as MailComposeStore,
      createId: () => "draft_1",
      transports: {},
      sendIdentityStore: {
        async listSendIdentities() {
          return [
            {
              id: "identity_1",
              accountId: "acc_1",
              from: { address: "me@example.com" },
              source: "account",
              isDefault: true,
              verified: true,
            },
          ];
        },
      } satisfies MailSendIdentityStore,
      now: () => new Date("2026-06-17T12:00:00.000Z"),
    });

    const preview = await service.previewDraft({
      accountId: "acc_1",
      from: { address: "me@example.com" },
      to: [{ address: "client@external.test" }],
      cc: [{ address: "CLIENT@external.test" }],
      subject: "请见附件",
      bodyText: "请见附件，确认合同。",
      source: "manual",
    });

    expect(preview).toMatchObject({
      warnings: [
        "duplicate_recipient",
        "possible_missing_attachment",
        "external_recipient_warning",
      ],
      readyToSend: false,
      generatedAt: "2026-06-17T12:00:00.000Z",
    });
  });
});
