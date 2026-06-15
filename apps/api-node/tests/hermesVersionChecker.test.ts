import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { createHermesHttpVersionChecker } from "../src/hermes/version-checker";

const repoRoot = join(import.meta.dirname, "..", "..", "..");

describe("Hermes HTTP version checker", () => {
  it("checks the configured release endpoint with channel and installed version", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ latestVersion: "0.2.0" }),
    );
    const checker = createHermesHttpVersionChecker({
      url: "https://updates.example.test/hermes",
      fetchImpl: fetchImpl as any,
    });

    await expect(
      checker?.({
        installedVersion: "0.1.0",
        updateChannel: "preview",
      }),
    ).resolves.toEqual({ latestVersion: "0.2.0" });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://updates.example.test/hermes?channel=preview&installedVersion=0.1.0",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ accept: "application/json" }),
      }),
    );
  });

  it("returns undefined when no update endpoint is configured", () => {
    expect(createHermesHttpVersionChecker({ url: "" })).toBeUndefined();
    expect(createHermesHttpVersionChecker({})).toBeUndefined();
  });

  it("rejects malformed update responses without leaking response text", async () => {
    const checker = createHermesHttpVersionChecker({
      url: "https://updates.example.test/hermes",
      fetchImpl: async () =>
        Response.json(
          { error: "private rollout token secret-value" },
          { status: 500 },
        ),
    });

    await expect(
      checker?.({ updateChannel: "stable" }),
    ).rejects.toThrow("hermes_version_check_failed");
    await expect(
      checker?.({ updateChannel: "stable" }),
    ).rejects.not.toThrow(/secret-value|private rollout token/i);
  });

  it("documents and forwards the optional update endpoint for Docker deployments", async () => {
    const envExample = await readFile(join(repoRoot, ".env.example"), "utf8");
    const compose = await readFile(
      join(repoRoot, "infra", "docker-compose.yml"),
      "utf8",
    );

    expect(envExample).toContain("HERMES_VERSION_CHECK_URL=");
    expect(compose).toContain(
      "HERMES_VERSION_CHECK_URL: ${HERMES_VERSION_CHECK_URL:-}",
    );
  });
});
