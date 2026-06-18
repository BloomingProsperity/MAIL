import { describe, expect, it } from "vitest";
import {
  buildProtonBridgeOnboardingInput,
  defaultProtonBridgeServerFields,
} from "./protonBridgeOnboarding";

describe("buildProtonBridgeOnboardingInput", () => {
  it("uses the backend Bridge preset when no server override is provided", () => {
    expect(
      buildProtonBridgeOnboardingInput({
        email: "me@proton.me",
        provider: "proton_bridge",
        username: "bridge-user",
        secret: "bridge-secret",
        fields: defaultProtonBridgeServerFields,
      }),
    ).toEqual({
      email: "me@proton.me",
      provider: "proton_bridge",
      username: "bridge-user",
      secret: "bridge-secret",
    });
  });

  it("builds explicit Bridge endpoints for Docker self-hosted access", () => {
    expect(
      buildProtonBridgeOnboardingInput({
        email: " me@proton.me ",
        provider: "proton_bridge",
        username: " bridge-user ",
        secret: " bridge-secret ",
        fields: {
          ...defaultProtonBridgeServerFields,
          receiveHost: "host.docker.internal",
          sendHost: "host.docker.internal",
        },
      }),
    ).toEqual({
      email: "me@proton.me",
      provider: "proton_bridge",
      imap: {
        host: "host.docker.internal",
        port: 1143,
        secure: false,
        username: "bridge-user",
        secret: "bridge-secret",
      },
      smtp: {
        host: "host.docker.internal",
        port: 1025,
        secure: false,
        username: "bridge-user",
        secret: "bridge-secret",
      },
    });
  });

  it("rejects incomplete Bridge connection details before testing", () => {
    expect(
      buildProtonBridgeOnboardingInput({
        email: "me@proton.me",
        provider: "proton_bridge",
        username: "bridge-user",
        secret: "bridge-secret",
        fields: {
          ...defaultProtonBridgeServerFields,
          receiveHost: "host.docker.internal",
          receivePort: "0",
          sendHost: "host.docker.internal",
        },
      }),
    ).toBeUndefined();
  });
});
