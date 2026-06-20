import { describe, expect, it } from "vitest";

import {
  findProviderCapability,
  listProviderCapabilities,
} from "../src/mail-provider/provider-capabilities.js";

describe("mail provider capabilities", () => {
  it("only declares official web login when the OAuth provider is configured", () => {
    const providers = listProviderCapabilities({
      oauthProvidersConfigured: {
        gmail: true,
        outlook: false,
      },
    });

    expect(providers.find((provider) => provider.provider === "gmail")).toMatchObject({
      supportsLogin: true,
      supportsWebLogin: true,
    });
    expect(providers.find((provider) => provider.provider === "outlook")).toMatchObject({
      supportsLogin: false,
      supportsWebLogin: false,
    });
  });

  it("applies the same OAuth availability rules to provider lookup aliases", () => {
    expect(
      findProviderCapability("m365", {
        oauthProvidersConfigured: { outlook: false },
      }),
    ).toMatchObject({
      provider: "outlook",
      supportsLogin: false,
      supportsWebLogin: false,
    });
  });
});
