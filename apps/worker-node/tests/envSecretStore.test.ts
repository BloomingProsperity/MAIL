import { describe, expect, it } from "vitest";

import { createEnvSecretStore } from "../src/secrets/env-secret-store";

describe("env secret store", () => {
  it("resolves env secret refs without transforming the secret", async () => {
    const store = createEnvSecretStore({
      GMAIL_REFRESH_TOKEN_ACC_1: "refresh-token-secret",
    });

    await expect(
      store.getSecret("env:GMAIL_REFRESH_TOKEN_ACC_1"),
    ).resolves.toBe("refresh-token-secret");
  });

  it("rejects unsupported refs with a sanitized message", async () => {
    const store = createEnvSecretStore({
      GMAIL_REFRESH_TOKEN_ACC_1: "refresh-token-secret",
    });

    await expect(
      store.getSecret("file:/tmp/refresh-token-secret"),
    ).rejects.toThrow("unsupported secret ref scheme: file");

    await expect(
      store.getSecret("file:/tmp/refresh-token-secret"),
    ).rejects.not.toThrow(/refresh-token-secret/);
  });

  it("rejects missing env vars without leaking available secrets", async () => {
    const store = createEnvSecretStore({
      OTHER_SECRET: "refresh-token-secret",
    });

    await expect(
      store.getSecret("env:GMAIL_REFRESH_TOKEN_ACC_1"),
    ).rejects.toThrow("secret ref not configured: env:GMAIL_REFRESH_TOKEN_ACC_1");

    await expect(
      store.getSecret("env:GMAIL_REFRESH_TOKEN_ACC_1"),
    ).rejects.not.toThrow(/refresh-token-secret/);
  });
});
