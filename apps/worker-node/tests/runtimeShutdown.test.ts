import { describe, expect, it } from "vitest";

import { createRuntimeShutdownHandler } from "../src/runtime-shutdown";

describe("runtime shutdown", () => {
  it("closes all resources and exits zero on the first signal", async () => {
    const events: string[] = [];
    const exitCodes: number[] = [];
    const shutdown = createRuntimeShutdownHandler({
      logger: captureLogger(events),
      exit: (code) => {
        exitCodes.push(code);
      },
      resources: [
        {
          name: "worker_poller",
          close: () => {
            events.push("closed:worker_poller");
          },
        },
        {
          name: "postgres_pool",
          close: async () => {
            events.push("closed:postgres_pool");
          },
        },
      ],
    });

    await shutdown("SIGTERM");

    expect(events).toContain("info:runtime_shutdown_started:SIGTERM");
    expect(events).toContain("closed:worker_poller");
    expect(events).toContain("closed:postgres_pool");
    expect(events).toContain("info:runtime_shutdown_completed:SIGTERM");
    expect(exitCodes).toEqual([0]);
  });

  it("keeps closing later resources and exits one when a resource fails", async () => {
    const events: string[] = [];
    const exitCodes: number[] = [];
    const shutdown = createRuntimeShutdownHandler({
      logger: captureLogger(events),
      exit: (code) => {
        exitCodes.push(code);
      },
      resources: [
        {
          name: "worker_poller",
          close: () => {
            throw new Error("timer failed");
          },
        },
        {
          name: "postgres_pool",
          close: async () => {
            events.push("closed:postgres_pool");
          },
        },
      ],
    });

    await shutdown("SIGINT");

    expect(events).toContain("error:runtime_shutdown_resource_failed:SIGINT:worker_poller:timer failed");
    expect(events).toContain("closed:postgres_pool");
    expect(events).toContain("error:runtime_shutdown_failed:SIGINT");
    expect(exitCodes).toEqual([1]);
  });
});

function captureLogger(events: string[]) {
  return {
    info(event: string, fields?: Record<string, unknown>) {
      events.push(eventLevel("info", event, fields));
    },
    warn(event: string, fields?: Record<string, unknown>) {
      events.push(eventLevel("warn", event, fields));
    },
    error(event: string, fields?: Record<string, unknown>) {
      events.push(eventLevel("error", event, fields));
    },
  };
}

function eventLevel(
  level: string,
  event: string,
  fields?: Record<string, unknown>,
): string {
  return [
    level,
    event,
    fields?.signal,
    fields?.resource,
    fields?.errorMessage,
  ]
    .filter((value) => value !== undefined)
    .join(":");
}
