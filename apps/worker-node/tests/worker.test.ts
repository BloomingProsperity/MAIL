import { describe, expect, it } from "vitest";

import { describeWorker } from "../src/worker";

describe("worker contract", () => {
  it("declares backend job lanes including provider command outbox execution", () => {
    expect(describeWorker()).toEqual({
      name: "email-hub-worker",
      lanes: [
        "sync",
        "mirror",
        "commands",
        "hermes",
        "import",
        "alias_delivery",
        "scheduled_send",
        "follow_up_reminder",
        "attachment_text_extraction",
        "compose_attachment_cleanup",
      ],
      ready: true,
    });
  });
});
