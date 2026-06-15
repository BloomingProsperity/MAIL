import { describe, expect, it } from "vitest";
import { scoreMessage } from "./priority";

describe("scoreMessage", () => {
  it("keeps urgent direct customer requests ahead of newsletter noise", () => {
    const customer = scoreMessage({
      directness: 1,
      relationship: 0.9,
      actionability: 1,
      urgency: 0.9,
      threadMomentum: 0.7,
      userContext: 0.6,
      noise: 0,
      negativeHistory: 0
    });

    const newsletter = scoreMessage({
      directness: 0.1,
      relationship: 0.1,
      actionability: 0,
      urgency: 0,
      threadMomentum: 0.1,
      userContext: 0.1,
      noise: 1,
      negativeHistory: 0.8
    });

    expect(customer.score).toBeGreaterThan(newsletter.score);
    expect(customer.bucket).toBe("P1 Urgent");
    expect(newsletter.bucket).toBe("P6 Feed");
    expect(customer.reasons).toContain("直接发给你");
    expect(newsletter.reasons).toContain("newsletter / bulk sender 扣分");
  });
});
