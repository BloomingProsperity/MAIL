import { describe, expect, it } from "vitest";

import { resolveSmokeMailboxEmail } from "../src/mail-engine/smoke-defaults";

describe("EmailEngine smoke defaults", () => {
  it("generates a fresh mailbox when no fixed smoke email is configured", () => {
    const email = resolveSmokeMailboxEmail({
      env: {},
      envKey: "EMAILHUB_SMOKE_MAIL_EMAIL",
      prefix: "emailhub-smoke",
      createId: () => "ABC_123",
    });

    expect(email).toBe("emailhub-smoke-abc-123@example.com");
  });

  it("uses an explicit smoke mailbox only when the env var is set", () => {
    const email = resolveSmokeMailboxEmail({
      env: {
        EMAILHUB_SMOKE_MAIL_EMAIL: " fixed@example.com ",
      },
      envKey: "EMAILHUB_SMOKE_MAIL_EMAIL",
      prefix: "emailhub-smoke",
      createId: () => "ignored",
    });

    expect(email).toBe("fixed@example.com");
  });
});
