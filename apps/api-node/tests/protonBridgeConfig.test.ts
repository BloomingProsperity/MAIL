import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readImapSmtpProviderPresetOverrides } from "../src/config";

const repoRoot = join(import.meta.dirname, "..", "..", "..");

describe("Proton Bridge deployment configuration", () => {
  it("reads Proton Bridge host and port overrides from runtime environment", () => {
    expect(
      readImapSmtpProviderPresetOverrides({
        PROTON_BRIDGE_HOST: "host.docker.internal",
        PROTON_BRIDGE_IMAP_PORT: "2143",
        PROTON_BRIDGE_SMTP_PORT: "2025",
      } as NodeJS.ProcessEnv),
    ).toEqual({
      proton_bridge: {
        imap: {
          host: "host.docker.internal",
          port: 2143,
          secure: false,
        },
        smtp: {
          host: "host.docker.internal",
          port: 2025,
          secure: false,
        },
      },
    });
  });

  it("documents Docker host-gateway defaults for Proton Bridge", async () => {
    const envExample = await readFile(join(repoRoot, ".env.example"), "utf8");
    const compose = await readFile(
      join(repoRoot, "infra", "docker-compose.yml"),
      "utf8",
    );

    expect(envExample).toContain("PROTON_BRIDGE_HOST=host.docker.internal");
    expect(envExample).toContain("PROTON_BRIDGE_IMAP_PORT=1143");
    expect(envExample).toContain("PROTON_BRIDGE_SMTP_PORT=1025");
    expect(compose).toContain(
      "PROTON_BRIDGE_HOST: ${PROTON_BRIDGE_HOST:-host.docker.internal}",
    );
    expect(compose).toContain(
      "PROTON_BRIDGE_IMAP_PORT: ${PROTON_BRIDGE_IMAP_PORT:-1143}",
    );
    expect(compose).toContain(
      "PROTON_BRIDGE_SMTP_PORT: ${PROTON_BRIDGE_SMTP_PORT:-1025}",
    );
    expect(compose.match(/host\.docker\.internal:host-gateway/g)).toHaveLength(
      2,
    );
  });
});
