import { describe, expect, it } from "vitest";

import { createJsonLogger } from "../src/logging/logger";

describe("worker logger", () => {
  it("writes structured worker logs and filters by level", () => {
    const lines: string[] = [];
    const logger = createJsonLogger({
      service: "email-hub-worker",
      level: "warn",
      sink: (line) => lines.push(line),
      now: () => "2026-06-13T00:00:00.000Z",
    });

    logger.info("worker_ready", { workerId: "worker_1" });
    logger.warn("worker_configuration_missing", {
      workerId: "worker_1",
      secret: "emailengine-token",
    });

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({
      timestamp: "2026-06-13T00:00:00.000Z",
      level: "warn",
      service: "email-hub-worker",
      event: "worker_configuration_missing",
      workerId: "worker_1",
      secret: "[redacted]",
    });
  });
});
