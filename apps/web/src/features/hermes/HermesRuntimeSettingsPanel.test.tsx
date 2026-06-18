import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailHubApi } from "../../lib/emailHubApi";
import { HermesRuntimeSettingsPanel } from "./HermesRuntimeSettingsPanel";

const childPanelCalls = vi.hoisted(() => ({
  audit: vi.fn(),
  memory: vi.fn(),
  rules: vi.fn(),
}));

vi.mock("./HermesLearningPanels", () => ({
  formatHermesMemoryLayer: (layer: string) => layer,
  HermesAuditLogPanel: (props: { accountId?: string }) => {
    childPanelCalls.audit(props);
    return (
      <div aria-label="mock Hermes audit panel">
        audit:{props.accountId ?? "none"}
      </div>
    );
  },
  HermesMemoryManagerPanel: (props: { accountId?: string }) => {
    childPanelCalls.memory(props);
    return (
      <div aria-label="mock Hermes memory panel">
        memory:{props.accountId ?? "none"}
      </div>
    );
  },
}));

vi.mock("./HermesRuleManagerPanel", () => ({
  HermesRuleManagerPanel: (props: { accountId?: string }) => {
    childPanelCalls.rules(props);
    return (
      <div aria-label="mock Hermes rules panel">
        rules:{props.accountId ?? "none"}
      </div>
    );
  },
}));

vi.mock("./HermesSkillSettingsPanel", () => ({
  HermesSkillSettingsPanel: () => (
    <div aria-label="mock Hermes skill settings" />
  ),
}));

describe("HermesRuntimeSettingsPanel", () => {
  beforeEach(() => {
    childPanelCalls.audit.mockClear();
    childPanelCalls.memory.mockClear();
    childPanelCalls.rules.mockClear();
  });

  it("routes the selected account scope to rules, memories, and audit logs", async () => {
    const api = createRuntimeApiFixture();

    render(<HermesRuntimeSettingsPanel api={api} accountId="account_1" />);

    const scopeSelect = await screen.findByRole("combobox", {
      name: "Select Hermes settings account",
    });
    expect((scopeSelect as HTMLSelectElement).value).toBe("account_1");

    await waitFor(() => {
      expect(childPanelCalls.rules).toHaveBeenLastCalledWith(
        expect.objectContaining({ accountId: "account_1" }),
      );
      expect(childPanelCalls.memory).toHaveBeenLastCalledWith(
        expect.objectContaining({ accountId: "account_1" }),
      );
      expect(childPanelCalls.audit).toHaveBeenLastCalledWith(
        expect.objectContaining({ accountId: "account_1" }),
      );
    });

    fireEvent.change(scopeSelect, { target: { value: "account_2" } });

    await waitFor(() => {
      expect(childPanelCalls.rules).toHaveBeenLastCalledWith(
        expect.objectContaining({ accountId: "account_2" }),
      );
      expect(childPanelCalls.memory).toHaveBeenLastCalledWith(
        expect.objectContaining({ accountId: "account_2" }),
      );
      expect(childPanelCalls.audit).toHaveBeenLastCalledWith(
        expect.objectContaining({ accountId: "account_2" }),
      );
    });
    expect(screen.getByLabelText("mock Hermes rules panel").textContent).toBe(
      "rules:account_2",
    );
    expect(api.listSyncCenterAccounts).toHaveBeenCalledTimes(1);
  });
});

function createRuntimeApiFixture(): EmailHubApi {
  return {
    getHermesProviders: vi.fn(async () => ({ providers: [] })),
    getHermesRuntimeSettings: vi.fn(async () => ({
      enabled: true,
      mode: "external_hermes",
      providerKey: "hermes",
      endpointUrl: "http://hermes.local/v1/chat/completions",
      model: "hermes-email",
      apiKeyConfigured: true,
      updatePolicy: "manual",
      updateChannel: "stable",
      updateAvailable: false,
      source: "database",
    })),
    listSyncCenterAccounts: vi.fn(async () => ({
      items: [
        {
          accountId: "account_1",
          email: "work@example.com",
          provider: "gmail",
          displayName: "Work Gmail",
          syncState: "running",
        },
        {
          accountId: "account_2",
          email: "me@example.com",
          provider: "outlook",
          displayName: "Personal Outlook",
          syncState: "running",
        },
      ],
    })),
  } as unknown as EmailHubApi;
}
