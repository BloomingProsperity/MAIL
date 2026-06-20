import { describe, expect, it, vi } from "vitest";

import {
  createEmailHubApi,
  type HermesProviderCatalogResponse,
  type HermesRuntimeTestResult,
} from "./emailHubApi";
import { jsonResponse } from "./emailHubApiTestHelpers";

describe("emailHubApi Hermes routes", () => {
  it("reads, saves, probes, tests, clears, and checks Hermes runtime settings through one client", async () => {
    const runtimeTestResult: HermesRuntimeTestResult = {
      ok: true,
      checkedAt: "2026-06-14T08:00:00.000Z",
      providerKey: "nvidia",
      requestProtocol: "openai_chat_completions",
      endpointUrl: "https://integrate.api.nvidia.com/v1/chat/completions",
      model: "nvidia/llama-3.3-nemotron-super-49b-v1",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          providers: [
            {
              key: "nvidia",
              label: "NVIDIA Build",
              category: "cloud",
              authType: "api_key",
              endpointEditable: true,
              aliases: ["nvidia-nim"],
              modelExamples: ["nvidia/llama-3.3-nemotron-super-49b-v1"],
              defaultEndpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
              capabilities: ["chat", "email_skills"],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          enabled: true,
          mode: "external_hermes",
          providerKey: "openai-api",
          endpointUrl: "https://api.openai.com/v1/chat/completions",
          model: "gpt-5.2",
          apiKeyConfigured: true,
          updatePolicy: "manual",
          updateChannel: "stable",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          enabled: true,
          mode: "external_hermes",
          providerKey: "nvidia",
          endpointUrl: "https://integrate.api.nvidia.com/v1/chat/completions",
          model: "nvidia/llama-3.3-nemotron-super-49b-v1",
          apiKeyConfigured: true,
          updatePolicy: "notify",
          updateChannel: "stable",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          status: "ready",
          providerKey: "nvidia",
          label: "NVIDIA Build",
          category: "cloud",
          authType: "api_key",
          endpointUrl: "https://integrate.api.nvidia.com/v1/chat/completions",
          model: "nvidia/llama-3.3-nemotron-super-49b-v1",
          missing: [],
          checkedAt: "2026-06-14T08:02:00.000Z",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          enabled: true,
          mode: "external_hermes",
          providerKey: "nvidia",
          endpointUrl: "https://integrate.api.nvidia.com/v1/chat/completions",
          model: "nvidia/llama-3.3-nemotron-super-49b-v1",
          apiKeyConfigured: false,
          updatePolicy: "notify",
          updateChannel: "stable",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(runtimeTestResult),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          installedVersion: "0.1.0",
          latestVersion: "0.2.0",
          updateAvailable: true,
          updatePolicy: "notify",
          updateChannel: "stable",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          installedVersion: "0.1.0",
          latestVersion: "0.2.0",
          updateAvailable: true,
          updatePolicy: "notify",
          updateChannel: "stable",
          lastCheckedAt: "2026-06-14T08:05:00.000Z",
        }),
      );
    const api = createEmailHubApi({
      baseUrl: "http://localhost:8080",
      fetchImpl: fetchMock as any,
    });

    await api.getHermesProviders();
    await api.getHermesRuntimeSettings();
    await api.updateHermesRuntimeSettings({
      enabled: true,
      mode: "external_hermes",
      assistantName: "Mail Copilot",
      providerKey: "nvidia",
      endpointUrl: "https://integrate.api.nvidia.com/v1/chat/completions",
      model: "nvidia/llama-3.3-nemotron-super-49b-v1",
      apiKey: "runtime-secret",
      updatePolicy: "notify",
      updateChannel: "stable",
    });
    await api.probeHermesProvider({
      providerKey: "nvidia",
      endpointUrl: "https://integrate.api.nvidia.com/v1/chat/completions",
      model: "nvidia/llama-3.3-nemotron-super-49b-v1",
      apiKey: "runtime-secret",
    });
    await api.clearHermesRuntimeApiKey({
      enabled: true,
      mode: "external_hermes",
      assistantName: "Mail Copilot",
      providerKey: "nvidia",
      endpointUrl: "https://integrate.api.nvidia.com/v1/chat/completions",
      model: "nvidia/llama-3.3-nemotron-super-49b-v1",
      updatePolicy: "notify",
      updateChannel: "stable",
    });
    await api.testHermesRuntimeConnection();
    await api.getHermesRuntimeVersion();
    await api.checkHermesRuntimeUpdate();

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8080/api/hermes/providers",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:8080/api/hermes/runtime",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "http://localhost:8080/api/hermes/runtime",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          enabled: true,
          mode: "external_hermes",
          assistantName: "Mail Copilot",
          providerKey: "nvidia",
          endpointUrl: "https://integrate.api.nvidia.com/v1/chat/completions",
          model: "nvidia/llama-3.3-nemotron-super-49b-v1",
          apiKey: "runtime-secret",
          updatePolicy: "notify",
          updateChannel: "stable",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "http://localhost:8080/api/hermes/providers/nvidia/probe",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          endpointUrl: "https://integrate.api.nvidia.com/v1/chat/completions",
          model: "nvidia/llama-3.3-nemotron-super-49b-v1",
          apiKey: "runtime-secret",
        }),
      }),
    );
    const clearKeyCall = fetchMock.mock.calls[4];
    expect(clearKeyCall[0]).toBe("http://localhost:8080/api/hermes/runtime");
    expect(clearKeyCall[1]).toEqual(
      expect.objectContaining({ method: "PUT" }),
    );
    expect(JSON.parse(String(clearKeyCall[1]?.body))).toEqual({
      enabled: true,
      mode: "external_hermes",
      assistantName: "Mail Copilot",
      providerKey: "nvidia",
      endpointUrl: "https://integrate.api.nvidia.com/v1/chat/completions",
      model: "nvidia/llama-3.3-nemotron-super-49b-v1",
      clearApiKey: true,
      updatePolicy: "notify",
      updateChannel: "stable",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      6,
      "http://localhost:8080/api/hermes/runtime/test",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      7,
      "http://localhost:8080/api/hermes/runtime/version",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      8,
      "http://localhost:8080/api/hermes/runtime/update/check",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("lists and updates editable Hermes skill settings", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: "translate_text",
            title: "翻译邮件",
            mode: "read",
            description: "翻译邮件正文",
            settings: {
              enabled: true,
              maxContextChars: 24000,
              memoryLimit: 6,
              allowBodyRead: true,
              allowMemoryWrite: false,
              requireConfirmation: false,
              customInstructions: "Prefer concise translations.",
            },
            settingBounds: {
              maxContextChars: { min: 1000, max: 200000, step: 1000 },
              memoryLimit: { min: 0, max: 50, step: 1 },
              customInstructions: { maxLength: 2000 },
            },
          },
        ]),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: "translate_text",
          title: "翻译邮件",
          mode: "read",
          description: "翻译邮件正文",
          settings: {
            enabled: false,
            maxContextChars: 12000,
            memoryLimit: 2,
            allowBodyRead: false,
            allowMemoryWrite: false,
            requireConfirmation: true,
            customInstructions: "Use formal language.",
          },
          settingBounds: {
            maxContextChars: { min: 1000, max: 200000, step: 1000 },
            memoryLimit: { min: 0, max: 50, step: 1 },
            customInstructions: { maxLength: 2000 },
          },
        }),
      );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const skills = await api.listHermesSkills();
    const updated = await api.updateHermesSkillSettings({
      skillId: "translate_text",
      patch: {
        enabled: false,
        maxContextChars: 12000,
        memoryLimit: 2,
        allowBodyRead: false,
        requireConfirmation: true,
        customInstructions: "Use formal language.",
      },
    });

    expect(skills[0].settings.customInstructions).toBe(
      "Prefer concise translations.",
    );
    expect(updated.settings.enabled).toBe(false);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/hermes/skills",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/hermes/skills/translate_text/settings",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          enabled: false,
          maxContextChars: 12000,
          memoryLimit: 2,
          allowBodyRead: false,
          requireConfirmation: true,
          customInstructions: "Use formal language.",
        }),
      }),
    );
  });

  it("loads Hermes resource profile for self-hosted settings", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        skills: {
          total: 14,
          enabled: 13,
          bodyReadEnabled: 12,
          memoryWriteEnabled: 5,
          confirmationRequired: 4,
          maxContextCharsPerRun: 24000,
          maxMemoryItemsPerRun: 6,
          enabledContextBudgetChars: 312000,
          enabledMemoryBudgetItems: 78,
        },
        retention: {
          retentionDays: 30,
          cleanupIntervalMs: 3600000,
          cleanupLimit: 500,
          managedTables: ["hermes_skill_runs"],
        },
        deployment: {
          profile: "medium",
          recommendedMinimum: {
            cpuCores: 2,
            memoryGb: 6,
            diskGb: 30,
          },
          localModelRecommendedMinimum: {
            cpuCores: 6,
            memoryGb: 24,
            diskGb: 80,
          },
        },
        guardrails: ["Prompt context is capped per skill."],
      }),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const profile = await api.getHermesResourceProfile();

    expect(profile.skills.enabled).toBe(13);
    expect(profile.retention.retentionDays).toBe(30);
    expect(profile.deployment.profile).toBe("medium");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/hermes/resource-profile",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("preserves Hermes provider request protocol metadata for settings wiring", async () => {
    const catalogResponse: HermesProviderCatalogResponse = {
      providers: [
        {
          key: "openai-responses",
          label: "OpenAI Responses",
          category: "cloud",
          authType: "api_key",
          requestProtocol: "openai_responses",
          endpointEditable: true,
          aliases: ["responses"],
          modelExamples: ["gpt-5.2"],
          capabilities: ["chat", "email_skills", "streaming_ready"],
          defaultEndpoint: "https://api.openai.com/v1/responses",
        },
      ],
    };
    const fetchMock = vi.fn(async () =>
      jsonResponse(catalogResponse),
    );
    const api = createEmailHubApi({
      baseUrl: "http://localhost:8080",
      fetchImpl: fetchMock as any,
    });

    const response = await api.getHermesProviders();

    expect(response.providers[0]).toMatchObject({
      key: "openai-responses",
      requestProtocol: "openai_responses",
    });
  });

  it("manages Hermes memories through backend routes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: "memory_1",
              accountId: "account 1",
              layer: "writing_style_profile",
              scope: "global",
              content: { preference: "short replies" },
              confidence: 0.75,
              createdAt: "2026-06-14T08:00:00.000Z",
              updatedAt: "2026-06-14T09:00:00.000Z",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: "memory_1",
          accountId: "account 1",
          layer: "writing_style_profile",
          scope: "global",
          content: { preference: "crisp replies" },
          confidence: 0.9,
          createdAt: "2026-06-14T08:00:00.000Z",
          updatedAt: "2026-06-14T10:00:00.000Z",
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const page = await api.listHermesMemories({
      accountId: " account 1 ",
      layer: " writing_style_profile ",
      scope: " global ",
      limit: 25,
    });
    const updated = await api.updateHermesMemory({
      id: "memory_1",
      accountId: " account 1 ",
      content: { preference: "crisp replies" },
      confidence: 0.9,
    });
    await api.deleteHermesMemory({ id: "memory_1", accountId: " account 1 " });

    expect(page.items[0]).toMatchObject({
      id: "memory_1",
      layer: "writing_style_profile",
      confidence: 0.75,
    });
    expect(updated.content).toEqual({ preference: "crisp replies" });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/hermes/memories?accountId=account+1&layer=writing_style_profile&scope=global&limit=25",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/hermes/memories/memory_1?accountId=account+1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          content: { preference: "crisp replies" },
          confidence: 0.9,
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/hermes/memories/memory_1?accountId=account+1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("drafts and simulates Hermes rules through backend routes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          candidates: [
            {
              id: "candidate 1",
              accountId: "account 1",
              title: "启用验证码智能分组",
              ruleType: "content_label",
              condition: { anyKeywords: ["验证码", "otp"] },
              action: { type: "apply_label", labelName: "验证码" },
              confidence: 0.9,
              status: "shadow",
              evidenceMessageIds: [],
              createdAt: "2026-06-15T09:00:00.000Z",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: "run_1",
          accountId: "account 1",
          candidateId: "candidate 1",
          mode: "shadow",
          matchedCount: 4,
          sampleMessageIds: ["message_1"],
          actionPreview: { type: "apply_label", labelName: "验证码" },
          createdAt: "2026-06-15T09:01:00.000Z",
        }),
      );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const draft = await api.draftHermesRule({
      accountId: "account 1",
      command: "帮我创建验证码规则",
    });
    const simulation = await api.simulateHermesRule({
      accountId: "account 1",
      candidateId: "candidate 1",
      sampleLimit: 25,
    });

    expect(draft.candidates[0].id).toBe("candidate 1");
    expect(simulation.matchedCount).toBe(4);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/hermes/rules/draft",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          accountId: "account 1",
          command: "帮我创建验证码规则",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/hermes/rules/candidate%201/simulate",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          accountId: "account 1",
          sampleLimit: 25,
        }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("suggests Hermes rules from recent behavior through backend routes", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        candidates: [
          {
            id: "candidate 1",
            accountId: "account 1",
            title: "启用客户优先级",
            ruleType: "sender_priority",
            condition: { senderEmail: "client@example.com" },
            action: { type: "classify_sender", bucket: "P2 Important" },
            confidence: 0.84,
            status: "shadow",
            evidenceMessageIds: ["message_1", "message_2"],
            createdAt: "2026-06-15T09:00:00.000Z",
          },
        ],
      }),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const result = await api.suggestHermesRules({
      accountId: "account 1",
      behaviorWindowDays: 30,
      minEvidenceCount: 2,
    });

    expect(result.candidates[0]).toMatchObject({
      id: "candidate 1",
      ruleType: "sender_priority",
      status: "shadow",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/hermes/rules/suggest",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          accountId: "account 1",
          behaviorWindowDays: 30,
          minEvidenceCount: 2,
        }),
      }),
    );
  });

  it("lists Hermes rule candidates through backend routes", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        items: [
          {
            id: "candidate 1",
            accountId: "account 1",
            title: "启用验证码智能分组",
            ruleType: "content_label",
            condition: { anyKeywords: ["验证码", "otp"] },
            action: { type: "apply_label", labelName: "验证码" },
            confidence: 0.9,
            status: "shadow",
            evidenceMessageIds: [],
            createdAt: "2026-06-15T09:00:00.000Z",
          },
        ],
      }),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const page = await api.listHermesRuleCandidates({
      accountId: "account 1",
      status: "shadow",
      limit: 20,
    });

    expect(page.items[0]).toMatchObject({
      id: "candidate 1",
      status: "shadow",
      ruleType: "content_label",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/hermes/rule-candidates?accountId=account+1&status=shadow&limit=20",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("updates Hermes rule candidates through backend routes", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        id: "candidate 1",
        accountId: "account 1",
        title: "创建票据智能分组",
        ruleType: "content_label",
        condition: { anyKeywords: ["receipt", "invoice"] },
        action: {
          type: "apply_label",
          labelName: "票据",
          applyToHistory: true,
          providerWriteback: false,
          requiresConfirmation: true,
        },
        confidence: 0.9,
        status: "shadow",
        evidenceMessageIds: [],
        createdAt: "2026-06-15T09:00:00.000Z",
      }),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const candidate = await api.updateHermesRuleCandidate({
      accountId: "account 1",
      candidateId: "candidate 1",
      labelName: "票据",
      keywords: ["receipt", "invoice"],
      applyToHistory: true,
    });

    expect(candidate).toMatchObject({
      id: "candidate 1",
      title: "创建票据智能分组",
      status: "shadow",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/hermes/rule-candidates/candidate%201",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          accountId: "account 1",
          labelName: "票据",
          keywords: ["receipt", "invoice"],
          applyToHistory: true,
        }),
      }),
    );
  });

  it("dismisses Hermes rule candidates through backend routes", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        id: "candidate 1",
        accountId: "account 1",
        title: "启用验证码智能分组",
        ruleType: "content_label",
        condition: { anyKeywords: ["验证码", "otp"] },
        action: { type: "apply_label", labelName: "验证码" },
        confidence: 0.9,
        status: "dismissed",
        evidenceMessageIds: [],
        createdAt: "2026-06-15T09:00:00.000Z",
      }),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const candidate = await api.dismissHermesRuleCandidate({
      accountId: "account 1",
      candidateId: "candidate 1",
    });

    expect(candidate).toMatchObject({
      id: "candidate 1",
      status: "dismissed",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/hermes/rule-candidates/candidate%201/dismiss",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          accountId: "account 1",
        }),
      }),
    );
  });

  it("updates approved Hermes rules through backend routes", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        id: "rule codes",
        accountId: "account 1",
        candidateId: "candidate codes",
        title: "启用验证码智能分组",
        ruleType: "content_label",
        condition: { anyKeywords: ["验证码", "otp"] },
        action: { type: "apply_label", labelName: "验证码" },
        confidence: 0.9,
        enabled: false,
        sortOrder: 2000,
        createdAt: "2026-06-15T09:02:00.000Z",
        approvedAt: "2026-06-15T09:02:00.000Z",
      }),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const rule = await api.updateHermesRule({
      accountId: "account 1",
      ruleId: "rule codes",
      enabled: false,
      sortOrder: 2000,
    });

    expect(rule).toMatchObject({
      id: "rule codes",
      enabled: false,
      sortOrder: 2000,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/hermes/rules/rule%20codes",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          accountId: "account 1",
          enabled: false,
          sortOrder: 2000,
        }),
      }),
    );
  });

  it("runs approved Hermes rules through backend routes", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        id: "run active 1",
        accountId: "account 1",
        ruleId: "rule codes",
        mode: "active",
        matchedCount: 7,
        appliedCount: 3,
        sampleMessageIds: ["message_1", "message_2"],
        actionPreview: {
          type: "apply_label",
          labelId: "label_codes",
        },
        createdAt: "2026-06-15T09:04:00.000Z",
      }),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const execution = await api.runHermesRule({
      accountId: "account 1",
      ruleId: "rule codes",
      limit: 1000,
    });

    expect(execution).toMatchObject({
      id: "run active 1",
      ruleId: "rule codes",
      mode: "active",
      matchedCount: 7,
      appliedCount: 3,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/hermes/rules/rule%20codes/run",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          accountId: "account 1",
          limit: 1000,
        }),
      }),
    );
  });

  it("lists Hermes rule executions through backend routes", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        items: [
          {
            id: "run active 1",
            accountId: "account 1",
            ruleId: "rule codes",
            mode: "active",
            matchedCount: 7,
            appliedCount: 3,
            sampleMessageIds: ["message_1", "message_2"],
            actionPreview: {
              type: "apply_label",
              labelId: "label_codes",
            },
            createdAt: "2026-06-15T09:04:00.000Z",
          },
        ],
      }),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const page = await api.listHermesRuleExecutions({
      accountId: "account 1",
      ruleId: "rule codes",
      limit: 20,
    });

    expect(page.items[0]).toMatchObject({
      id: "run active 1",
      ruleId: "rule codes",
      mode: "active",
      matchedCount: 7,
      appliedCount: 3,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/hermes/rule-runs?accountId=account+1&ruleId=rule+codes&limit=20",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("lists Hermes audit events with scoped filters", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        items: [
          {
            id: "audit_1",
            eventType: "hermes.skill.translate_text",
            skillRunId: "run_translate_1",
            skillId: "translate_text",
            skillTitle: "邮件翻译",
            readMessageIds: ["message_1"],
            memoryIds: ["memory_translation"],
            action: {
              skillId: "translate_text",
              targetLanguage: "zh-CN",
              memoryScope: "global",
            },
            createdAt: "2026-06-15T09:30:00.000Z",
          },
        ],
      }),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const page = await api.listHermesAuditLog({
      accountId: " account_1 ",
      skillId: " translate_text ",
      messageId: " message_1 ",
      memoryId: " memory_translation ",
      limit: 150,
    });

    expect(page.items[0]).toMatchObject({
      id: "audit_1",
      skillId: "translate_text",
      readMessageIds: ["message_1"],
      memoryIds: ["memory_translation"],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/hermes/audit-log?accountId=account_1&skillId=translate_text&messageId=message_1&memoryId=memory_translation&limit=150",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("posts Spark done and undo actions through the backend action route", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      jsonResponse({
        accountId: "account_1",
        messageId: "message_1",
        action: JSON.parse(String(init?.body)).action,
        state: {
          unread: false,
          starred: false,
          archived: true,
          deleted: false,
          mailboxIds: [],
          labelIds: [],
          doneAt: "2026-06-13T10:00:00.000Z",
          undoToken: "undo_1",
          undoExpiresAt: "2026-06-13T10:00:05.000Z",
        },
        command: {
          id: "cmd_1",
          commandType: "archive",
          accountId: "account_1",
          messageId: "message_1",
          idempotencyKey: "mail-action:account_1:message_1:done",
          status: "queued",
        },
      }),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    await api.applyMailAction({
      accountId: "account_1",
      messageId: "message_1",
      action: "done",
    });
    await api.applyMailAction({
      accountId: "account_1",
      messageId: "message_1",
      action: "undo_done",
      undoToken: "undo_1",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/accounts/account_1/messages/message_1/actions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ action: "done" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/accounts/account_1/messages/message_1/actions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ action: "undo_done", undoToken: "undo_1" }),
      }),
    );
  });

  it("posts Smart Inbox card bulk done through the backend bulk action route", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          accountId: "account_1",
          bucket: "P2",
          action: "done",
          requestedCount: 2,
          attemptedCount: 2,
          succeededCount: 2,
          failedCount: 0,
          succeeded: [
            { messageId: "message_1", undoToken: "undo_1", commandId: "cmd_1" },
            { messageId: "message_2", undoToken: "undo_2", commandId: "cmd_2" },
          ],
          failed: [],
        },
        202,
      ),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const result = await api.applySmartInboxCardBulkAction({
      accountId: "account_1",
      bucket: "P2",
      action: "done",
      messageIds: ["message_1", "message_2"],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/accounts/account_1/smart-inbox/cards/P2/actions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          action: "done",
          messageIds: ["message_1", "message_2"],
        }),
      }),
    );
    expect(result.succeededCount).toBe(2);
  });

  it("records Smart Inbox sender corrections through the feedback route", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        feedbackEventId: "feedback_1",
        accountId: "account_1",
        messageId: "message_1",
        classification: {
          bucket: "P6 Feed",
          priorityScore: 15,
          reasons: ["User moved sender to Newsletters"],
        },
      }),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    await api.recordSmartInboxFeedback({
      accountId: "account_1",
      messageId: "message_1",
      action: "move_to_newsletters",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/accounts/account_1/messages/message_1/smart-inbox/feedback",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ action: "move_to_newsletters" }),
      }),
    );
  });

  it("starts OAuth onboarding and keeps provider payloads behind the API client", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          provider: "gmail",
          authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
          state: "state_1",
          task: {
            id: "task_1",
            email: "pending@gmail.oauth",
            provider: "gmail",
            authMethod: "oauth",
            status: "pending",
          },
        },
        202,
      ),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const result = await api.startOAuthAccount({
      provider: "gmail",
      redirectUri: "http://127.0.0.1:5173/oauth/callback",
      loginHint: "me@gmail.com",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/accounts/oauth/gmail/start",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          redirectUri: "http://127.0.0.1:5173/oauth/callback",
          loginHint: "me@gmail.com",
        }),
      }),
    );
    expect(result.authorizationUrl).toContain("accounts.google.com");
  });

  it("completes OAuth callbacks through the API client", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          task: {
            id: "task_1",
            email: "me@gmail.com",
            provider: "gmail",
            authMethod: "oauth",
            status: "completed",
          },
          account: {
            id: "account_gmail",
            email: "me@gmail.com",
            provider: "gmail",
            authMethod: "oauth",
            syncState: "syncing",
            engineProvider: "native",
          },
        },
        202,
      ),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const result = await api.completeOAuthCallback({
      provider: "gmail",
      state: "state_1",
      code: "code 1",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/accounts/oauth/gmail/callback?state=state_1&code=code+1",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result.account?.email).toBe("me@gmail.com");
  });

  it("posts iCloud app-password onboarding through the preset IMAP route", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          task: {
            id: "task_icloud",
            email: "me@icloud.com",
            provider: "icloud",
            authMethod: "password",
            status: "completed",
          },
        },
        202,
      ),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    await api.onboardImapSmtpAccount({
      email: "me@icloud.com",
      provider: "icloud",
      displayName: "iCloud Mail",
      username: "me@icloud.com",
      secret: "apple-app-specific-password",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/accounts/imap-smtp",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          email: "me@icloud.com",
          provider: "icloud",
          displayName: "iCloud Mail",
          username: "me@icloud.com",
          secret: "apple-app-specific-password",
        }),
      }),
    );
  });

  it("tests app-password mailbox credentials before onboarding", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        provider: "qq",
        ok: false,
        checks: {
          imap: { ok: false, code: "EAUTH", error: "Invalid login" },
          smtp: { ok: true },
        },
        diagnostics: [
          {
            code: "qq_authorization_code_required",
            provider: "qq",
            severity: "action_required",
            affected: "account",
            message:
              "Use the authorization code generated in QQ Mail settings, not your normal account password.",
            recoveryAction: "enable_qq_mail_authorization_code",
          },
        ],
      }),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const result = await api.testImapSmtpConnection({
      email: "support@qq.com",
      provider: "qq",
      secret: "qq-auth-code",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/accounts/imap-smtp/test",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          email: "support@qq.com",
          provider: "qq",
          secret: "qq-auth-code",
        }),
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.checks.imap.code).toBe("EAUTH");
    expect(result.diagnostics?.[0]).toMatchObject({
      code: "qq_authorization_code_required",
      recoveryAction: "enable_qq_mail_authorization_code",
    });
  });

  it("loads account onboarding diagnostics from durable operational events", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        items: [
          {
            id: "op_1",
            occurredAt: "2026-06-14T08:00:00.000Z",
            service: "email-hub-api",
            level: "warn",
            event: "account_onboarding_connection_test_failed",
            lane: "account_onboarding",
            message: "IMAP/SMTP connection test failed for qq",
            context: { provider: "qq", email: "support@qq.com" },
          },
        ],
      }),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const page = await api.listOperationalEvents({
      service: "email-hub-api",
      lane: "account_onboarding",
      limit: 3,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/diagnostics/events?service=email-hub-api&lane=account_onboarding&limit=3",
      expect.objectContaining({ method: "GET" }),
    );
    expect(page.items[0].event).toBe("account_onboarding_connection_test_failed");
  });

  it("loads provider groups and quick categories for the left navigation", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        folders: [{ id: "inbox", label: "收件箱", count: 36 }],
        providerGroups: [
          { id: "gmail", label: "Gmail", count: 2 },
          { id: "outlook", label: "Outlook", count: 1 },
        ],
        quickCategories: [
          { id: "codes", label: "验证码", count: 18, tone: "blue" },
          { id: "receipts", label: "账单/收据", count: 24, tone: "green" },
        ],
      }),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const summary = await api.getMailNavigationSummary();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/mail-navigation/summary",
      expect.objectContaining({ method: "GET" }),
    );
    expect(summary.providerGroups[0]).toEqual({ id: "gmail", label: "Gmail", count: 2 });
    expect(summary.folders[0]).toEqual({ id: "inbox", label: "收件箱", count: 36 });
    expect(summary.quickCategories[0]).toEqual({
      id: "codes",
      label: "验证码",
      count: 18,
      tone: "blue",
    });
  });

  it("posts sync center control actions through stable API client methods", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/resync")) {
        return jsonResponse(
          {
            accountId: "acc_1",
            action: "manual_sync_queued",
            job: {
              id: "job_sync",
              jobType: "sync_account",
              accountId: "acc_1",
              idempotencyKey: "job:manual-sync:acc_1:job_sync",
              status: "queued",
              createdAt: "2026-06-13T08:00:00.000Z",
            },
          },
          202,
        );
      }

      if (url.endsWith("/pause")) {
        return jsonResponse(
          {
            accountId: "acc_1",
            action: "sync_paused",
            account: { accountId: "acc_1", syncState: "paused" },
          },
          202,
        );
      }

      if (url.endsWith("/resume")) {
        return jsonResponse(
          {
            accountId: "acc_1",
            action: "sync_resumed",
            account: { accountId: "acc_1", syncState: "syncing" },
          },
          202,
        );
      }

      return jsonResponse(
        {
          accountId: "acc_1",
          action: "failed_sync_requeued",
          retriedJobCount: 2,
        },
        202,
      );
    });
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const resync = await api.requestSyncCenterResync({ accountId: "acc_1" });
    const pause = await api.pauseSyncCenterAccount({ accountId: "acc_1" });
    const resume = await api.resumeSyncCenterAccount({ accountId: "acc_1" });
    const retry = await api.retryFailedSyncCenterJobs({ accountId: "acc_1" });

    expect(resync.job.status).toBe("queued");
    expect(pause.account.syncState).toBe("paused");
    expect(resume.account.syncState).toBe("syncing");
    expect(retry.retriedJobCount).toBe(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/sync-center/accounts/acc_1/resync",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/sync-center/accounts/acc_1/pause",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/sync-center/accounts/acc_1/resume",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/sync-center/accounts/acc_1/retry-failed",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("loads email connection account diagnostics with filter parameters", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        items: [
          {
            id: "op_sync_1",
            occurredAt: "2026-06-14T08:00:00.000Z",
            service: "email-hub-api",
            level: "info",
            event: "emailengine_webhook_ingested",
            accountId: "acc_1",
            lane: "sync",
            jobId: "job_1",
            message: "EmailEngine webhook message_new ingested for acc_1",
            context: { syncJobType: "sync_account" },
          },
        ],
      }),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const page = await api.listSyncCenterAccountDiagnostics({
      accountId: "acc_1",
      level: "info",
      jobId: "job_1",
      limit: 200,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sync-center/accounts/acc_1/diagnostics?level=info&jobId=job_1&limit=200",
      expect.objectContaining({ method: "GET" }),
    );
    expect(page.items[0]).toMatchObject({
      event: "emailengine_webhook_ingested",
      accountId: "acc_1",
      jobId: "job_1",
    });
  });

  it("lists and completes email connection reauthorization tasks", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/sync-center/reauthorizations") {
        return jsonResponse({
          items: [
            {
              taskId: "task_reauth_1",
              email: "reauth@example.com",
              provider: "gmail",
              authMethod: "oauth",
              status: "pending",
              source: "native_send",
              reauthRequired: true,
              createdAt: "2026-06-14T08:00:00.000Z",
              updatedAt: "2026-06-14T08:00:00.000Z",
            },
          ],
        });
      }

      if (url === "/api/sync-center/reauthorizations/oauth/callback") {
        return jsonResponse(
          {
            task: {
              id: "task_reauth_1",
              email: "reauth@example.com",
              provider: "gmail",
              authMethod: "oauth",
              status: "completed",
            },
            account: {
              id: "acc_reauth_1",
              email: "reauth@example.com",
              provider: "gmail",
              authMethod: "oauth",
              syncState: "syncing",
              engineProvider: "emailengine",
            },
          },
          202,
        );
      }

      return jsonResponse(
        {
          provider: "gmail",
          authorizationUrl: "https://accounts.example/auth",
          state: "state_1",
          task: {
            id: "task_reauth_1",
            email: "reauth@example.com",
            provider: "gmail",
            authMethod: "oauth",
            status: "pending",
          },
        },
        202,
      );
    });
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const page = await api.listSyncCenterReauthorizations();
    await api.startSyncCenterOAuthReauthorization({
      taskId: "task_reauth_1",
      redirectUri: "https://app.example/oauth/callback",
    });
    await api.completeSyncCenterOAuthReauthorizationCallback({
      state: "state_1",
      code: "oauth-code-secret",
    });
    await api.completeSyncCenterImapSmtpReauthorization({
      taskId: "task_password_1",
      username: "support@qq.com",
      secret: "qq-auth-code",
    });
    await api.completeSyncCenterImapSmtpReauthorization({
      taskId: "task_custom_1",
      username: "custom@example.com",
      secret: "domain-app-password",
      imap: {
        host: "imap.example.com",
        port: 993,
        secure: true,
        username: "custom@example.com",
        secret: "domain-app-password",
      },
      smtp: {
        host: "smtp.example.com",
        port: 587,
        secure: false,
        username: "custom@example.com",
        secret: "domain-app-password",
      },
    });

    expect(page.items[0]).toMatchObject({
      taskId: "task_reauth_1",
      source: "native_send",
      reauthRequired: true,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/sync-center/reauthorizations",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/sync-center/reauthorizations/task_reauth_1/oauth/start",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          redirectUri: "https://app.example/oauth/callback",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/sync-center/reauthorizations/oauth/callback",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          state: "state_1",
          code: "oauth-code-secret",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/sync-center/reauthorizations/task_password_1/imap-smtp",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          username: "support@qq.com",
          secret: "qq-auth-code",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      "/api/sync-center/reauthorizations/task_custom_1/imap-smtp",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          username: "custom@example.com",
          secret: "domain-app-password",
          imap: {
            host: "imap.example.com",
            port: 993,
            secure: true,
            username: "custom@example.com",
            secret: "domain-app-password",
          },
          smtp: {
            host: "smtp.example.com",
            port: 587,
            secure: false,
            username: "custom@example.com",
            secret: "domain-app-password",
          },
        }),
      }),
    );
  });

  it("lists and completes follow-up reminders for the Tasks view", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/follow-ups?accountId=account_1&status=open&limit=25") {
        return jsonResponse({
          accountId: "account_1",
          status: "open",
          items: [
            {
              id: "fu_1",
              accountId: "account_1",
              messageId: "message_1",
              kind: "waiting_on_them",
              status: "open",
              dueAt: "2026-06-14T09:00:00.000Z",
              title: "Check whether Lina replied",
              source: "hermes_followup",
              createdAt: "2026-06-13T09:00:00.000Z",
              updatedAt: "2026-06-13T09:00:00.000Z",
            },
          ],
        });
      }

      return jsonResponse({
        id: "fu_1",
        accountId: "account_1",
        messageId: "message_1",
        kind: "waiting_on_them",
        status: JSON.parse(String(init?.body)).status,
        dueAt: "2026-06-14T09:00:00.000Z",
        title: "Check whether Lina replied",
        source: "hermes_followup",
        createdAt: "2026-06-13T09:00:00.000Z",
        updatedAt: "2026-06-13T10:00:00.000Z",
      });
    });
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const page = await api.listFollowUps({
      accountId: "account_1",
      status: "open",
      limit: 25,
    });
    await api.updateFollowUp({ id: "fu_1", status: "done" });

    expect(page.items[0].title).toBe("Check whether Lina replied");
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/follow-ups/fu_1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ status: "done" }),
      }),
    );
  });

  it("runs Hermes follow-up tracking and confirms the suggestion through backend routes", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/hermes/skills/followup_tracker/run") {
        return jsonResponse(
          {
            skillRunId: "run_followup_1",
            skillId: "followup_tracker",
            status: "waiting_on_them",
            followupNeeded: true,
            owner: "them",
            confidence: 0.86,
            dueAt: "2026-06-14T09:00:00.000Z",
            nextAction: "Check whether Lina replied",
            reasons: ["we asked for confirmation and no reply yet"],
          },
          202,
        );
      }

      return jsonResponse(
        {
          id: "fu_1",
          accountId: "account_1",
          messageId: "message_1",
          kind: "waiting_on_them",
          status: "open",
          dueAt: "2026-06-14T09:00:00.000Z",
          title: "Check whether Lina replied",
          source: "hermes_followup",
          hermesSkillRunId: "run_followup_1",
          createdAt: "2026-06-13T09:00:00.000Z",
          updatedAt: "2026-06-13T09:00:00.000Z",
        },
        201,
      );
    });
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const suggestion = await api.trackFollowup({
      subject: "Launch schedule confirmation",
      threadText: "Please confirm the launch schedule.",
      userEmail: "me@example.com",
      participants: ["me@example.com", "lina@example.com"],
      now: "2026-06-13T09:00:00.000Z",
      readMessageIds: ["message_1"],
    });
    if (
      suggestion.status !== "needs_reply" &&
      suggestion.status !== "waiting_on_them"
    ) {
      throw new Error("expected actionable follow-up suggestion");
    }
    await api.confirmHermesFollowUp({
      accountId: "account_1",
      messageId: "message_1",
      skillRunId: suggestion.skillRunId,
      status: suggestion.status,
      dueAt: suggestion.dueAt!,
      nextAction: suggestion.nextAction,
      reasons: suggestion.reasons,
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/hermes/skills/followup_tracker/run",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          subject: "Launch schedule confirmation",
          threadText: "Please confirm the launch schedule.",
          userEmail: "me@example.com",
          participants: ["me@example.com", "lina@example.com"],
          now: "2026-06-13T09:00:00.000Z",
          readMessageIds: ["message_1"],
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/hermes/follow-ups/confirm",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          accountId: "account_1",
          messageId: "message_1",
          skillRunId: "run_followup_1",
          status: "waiting_on_them",
          dueAt: "2026-06-14T09:00:00.000Z",
          nextAction: "Check whether Lina replied",
          reasons: ["we asked for confirmation and no reply yet"],
        }),
      }),
    );
  });

  it("runs Hermes follow-up tracking through the message-scoped backend route", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          skillRunId: "run_message_followup_1",
          skillId: "followup_tracker",
          accountId: "account_1",
          messageId: "message_1",
          status: "waiting_on_them",
          followupNeeded: true,
          owner: "them",
          confidence: 0.86,
          dueAt: "2026-06-14T09:00:00.000Z",
          nextAction: "Check whether Lina replied",
          reasons: ["we asked for confirmation and no reply yet"],
        },
        202,
      ),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const result = await api.trackMessageFollowup({
      accountId: "account_1",
      messageId: "message_1",
      language: "zh-CN",
      memoryScope: "sender:lina@example.com",
      memoryLayers: ["contact_memory", "procedural_memory"],
    });

    expect(result).toMatchObject({
      skillRunId: "run_message_followup_1",
      accountId: "account_1",
      messageId: "message_1",
      status: "waiting_on_them",
      followupNeeded: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/accounts/account_1/messages/message_1/followup-track",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          language: "zh-CN",
          memoryScope: "sender:lina@example.com",
          memoryLayers: ["contact_memory", "procedural_memory"],
        }),
      }),
    );
    const body = (fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body;
    expect(JSON.parse(body)).not.toHaveProperty("threadText");
    expect(JSON.parse(body)).not.toHaveProperty("participants");
  });

  it("runs Hermes reply draft through the backend skills route", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          skillRunId: "run_reply_1",
          skillId: "reply_draft",
          draftText: "Hi Lina,\n\nI can confirm the launch plan.",
        },
        202,
      ),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const result = await api.draftReply({
      subject: "Launch schedule confirmation",
      threadText: "Please confirm the launch schedule.",
      instruction: "Confirm politely.",
      readMessageIds: ["message_1"],
    });

    expect(result).toEqual({
      skillRunId: "run_reply_1",
      skillId: "reply_draft",
      draftText: "Hi Lina,\n\nI can confirm the launch plan.",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/hermes/skills/reply_draft/run",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          subject: "Launch schedule confirmation",
          threadText: "Please confirm the launch schedule.",
          instruction: "Confirm politely.",
          readMessageIds: ["message_1"],
        }),
      }),
    );
  });

  it("runs Hermes reply draft through the message-scoped backend route", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          skillRunId: "run_message_reply_1",
          skillId: "reply_draft",
          accountId: "account_1",
          messageId: "message_1",
          draftText: "Hi Lina,\n\nI can confirm the launch plan.",
        },
        202,
      ),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const result = await api.draftMessageReply({
      accountId: "account_1",
      messageId: "message_1",
      instruction: "Confirm politely.",
      memoryScope: "sender:client@example.com",
      memoryLayers: ["contact_memory", "writing_style_profile"],
    });

    expect(result).toEqual({
      skillRunId: "run_message_reply_1",
      skillId: "reply_draft",
      accountId: "account_1",
      messageId: "message_1",
      draftText: "Hi Lina,\n\nI can confirm the launch plan.",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/accounts/account_1/messages/message_1/reply-draft",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          instruction: "Confirm politely.",
          memoryScope: "sender:client@example.com",
          memoryLayers: ["contact_memory", "writing_style_profile"],
        }),
      }),
    );
    const body = (fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body;
    expect(JSON.parse(body)).not.toHaveProperty("threadText");
  });

  it("runs Hermes email search QA through the backend skills route", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          skillRunId: "run_search_1",
          skillId: "email_search_qa",
          answerText: "The signed contract is in Lina's latest message.",
          searchQuery: "signed contract",
          searchPlan: {
            searchQuery: "signed contract",
            quickFilters: [],
            qScopes: ["sender", "recipients", "subject", "body"],
            filters: [],
            listMessagesInput: {
              q: "signed contract",
              qScopes: ["sender", "recipients", "subject", "body"],
            },
            explanation: [
              "使用问题中的关键词搜索发件人、收件人、主题和正文。",
            ],
          },
          matches: [
            {
              id: "message_1",
              accountId: "account_1",
              subject: "Signed contract",
              from: { email: "lina@example.com", name: "Lina" },
              receivedAt: "2026-06-13T10:00:00.000Z",
              snippet: "Please review the signed contract.",
              classification: {
                bucket: "P1 Urgent",
                priorityScore: 91,
                reasons: ["Matched search"],
              },
            },
          ],
          citations: [
            {
              resultIndex: 1,
              messageId: "message_1",
              accountId: "account_1",
              subject: "Signed contract",
              from: { email: "lina@example.com", name: "Lina" },
              receivedAt: "2026-06-13T10:00:00.000Z",
              snippet: "Please review the signed contract.",
              bucket: "P1 Urgent",
              reasons: ["Matched search"],
            },
          ],
        },
        202,
      ),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const result = await api.searchMailWithHermes({
      accountId: "account_1",
      question: "Where is the signed contract?",
      searchQuery: "signed contract",
      language: "en",
      limit: 5,
      memoryScope: "global",
    });

    expect(result.answerText).toBe("The signed contract is in Lina's latest message.");
    expect(result.citations[0].messageId).toBe("message_1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/hermes/skills/email_search_qa/run",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          accountId: "account_1",
          question: "Where is the signed contract?",
          searchQuery: "signed contract",
          language: "en",
          limit: 5,
          memoryScope: "global",
        }),
      }),
    );
  });

  it("runs Hermes organize skills through backend preview skill routes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            skillRunId: "run_priority_1",
            skillId: "priority_triage",
            priority: "high",
            bucket: "P1 Urgent",
            score: 94,
            reasons: ["deadline today"],
            explanation: "Needs a reply today.",
          },
          202,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            skillRunId: "run_labels_1",
            skillId: "label_suggest",
            labels: [{ name: "客户", confidence: 0.92, reason: "client thread" }],
            actions: [
              { type: "apply_label", label: "客户", reason: "high confidence" },
            ],
          },
          202,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            skillRunId: "run_newsletter_1",
            skillId: "newsletter_cleanup",
            isNewsletter: false,
            confidence: 0.88,
            senderCategory: "personal",
            reasons: ["direct conversation"],
            actions: [{ type: "keep_in_inbox", reason: "needs reply" }],
          },
          202,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            skillRunId: "run_actions_1",
            skillId: "action_item_extract",
            items: [
              {
                title: "Confirm launch schedule",
                owner: "me",
                dueText: "today",
                priority: "high",
                status: "open",
              },
            ],
          },
          202,
        ),
      );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });
    const common = {
      subject: "Launch schedule",
      threadText: "Please confirm the launch schedule today.",
      language: "zh-CN",
      readMessageIds: ["message_1"],
      memoryScope: "sender:lina@example.com",
      memoryLayers: ["contact_memory", "procedural_memory"],
    };

    const priority = await api.triagePriorityWithHermes({
      ...common,
      senderEmail: "lina@example.com",
      currentBucket: "P2 Important",
      currentScore: 82,
      currentReasons: ["Direct to you"],
    });
    const labels = await api.suggestLabelsWithHermes({
      ...common,
      senderEmail: "lina@example.com",
      currentLabels: ["市场"],
      availableLabels: ["客户", "市场"],
    });
    const newsletter = await api.cleanupNewsletterWithHermes({
      ...common,
      senderEmail: "lina@example.com",
      currentBucket: "P2 Important",
    });
    const actionItems = await api.extractActionItemsWithHermes({
      ...common,
      now: "2026-06-16T09:00:00.000Z",
    });

    expect(priority.bucket).toBe("P1 Urgent");
    expect(labels.labels[0].name).toBe("客户");
    expect(newsletter.senderCategory).toBe("personal");
    expect(actionItems.items[0].title).toBe("Confirm launch schedule");
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/hermes/skills/priority_triage/run",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          ...common,
          senderEmail: "lina@example.com",
          currentBucket: "P2 Important",
          currentScore: 82,
          currentReasons: ["Direct to you"],
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/hermes/skills/label_suggest/run",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          ...common,
          senderEmail: "lina@example.com",
          currentLabels: ["市场"],
          availableLabels: ["客户", "市场"],
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/hermes/skills/newsletter_cleanup/run",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          ...common,
          senderEmail: "lina@example.com",
          currentBucket: "P2 Important",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/hermes/skills/action_item_extract/run",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          ...common,
          now: "2026-06-16T09:00:00.000Z",
        }),
      }),
    );
  });

  it("runs Hermes message organization through the message-scoped route", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          accountId: "account_1",
          messageId: "message_1",
          priority: {
            skillRunId: "run_priority_1",
            skillId: "priority_triage",
            priority: "high",
            bucket: "P1 Urgent",
            score: 94,
            reasons: ["deadline today"],
          },
          labels: {
            skillRunId: "run_labels_1",
            skillId: "label_suggest",
            labels: [{ name: "客户", confidence: 0.92 }],
            actions: [{ type: "apply_label", label: "客户" }],
          },
          newsletter: {
            skillRunId: "run_newsletter_1",
            skillId: "newsletter_cleanup",
            isNewsletter: false,
            confidence: 0.88,
            senderCategory: "personal",
            reasons: ["direct conversation"],
            actions: [{ type: "keep_in_inbox" }],
          },
          actionItems: {
            skillRunId: "run_actions_1",
            skillId: "action_item_extract",
            items: [{ title: "Confirm launch schedule" }],
          },
        },
        202,
      ),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const result = await api.organizeMessage({
      accountId: "account_1",
      messageId: "message_1",
      language: "zh-CN",
      memoryScope: "sender:lina@example.com",
      memoryLayers: ["contact_memory", "procedural_memory"],
    });

    expect(result.priority.bucket).toBe("P1 Urgent");
    expect(result.labels.labels[0].name).toBe("客户");
    expect(result.newsletter.senderCategory).toBe("personal");
    expect(result.actionItems.items[0].title).toBe("Confirm launch schedule");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/accounts/account_1/messages/message_1/organize",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          language: "zh-CN",
          memoryScope: "sender:lina@example.com",
          memoryLayers: ["contact_memory", "procedural_memory"],
        }),
      }),
    );
    const body = (fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body;
    expect(JSON.parse(body)).not.toHaveProperty("threadText");
    expect(JSON.parse(body)).not.toHaveProperty("availableLabels");
  });

  it("runs Hermes translation and thread summary through backend skill routes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            skillRunId: "run_translate_1",
            skillId: "translate_text",
            sourceLanguage: "English",
            targetLanguage: "Chinese",
            translatedText: "你好，请确认发布时间。",
          },
          202,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            skillRunId: "run_summary_1",
            skillId: "thread_summarize",
            mode: "action_points",
            summaryText: "Action: confirm the launch schedule today.",
          },
          202,
        ),
      );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const translation = await api.translateText({
      accountId: "account_1",
      text: "Please confirm the launch schedule.",
      targetLanguage: "Chinese",
      tone: "preserve original meaning",
      readMessageIds: ["message_1"],
      memoryScope: "global",
    });
    const summary = await api.summarizeThread({
      subject: "Launch schedule",
      threadText: "Please confirm the launch schedule.",
      mode: "action_points",
      focus: "reply needs",
      language: "English",
      readMessageIds: ["message_1"],
      memoryScope: "global",
    });

    expect(translation.translatedText).toBe("你好，请确认发布时间。");
    expect(summary.summaryText).toBe("Action: confirm the launch schedule today.");
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/hermes/skills/translate_text/run?accountId=account_1",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          accountId: "account_1",
          text: "Please confirm the launch schedule.",
          targetLanguage: "Chinese",
          tone: "preserve original meaning",
          readMessageIds: ["message_1"],
          memoryScope: "global",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/hermes/skills/thread_summarize/run",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          subject: "Launch schedule",
          threadText: "Please confirm the launch schedule.",
          mode: "action_points",
          focus: "reply needs",
          language: "English",
          readMessageIds: ["message_1"],
          memoryScope: "global",
        }),
      }),
    );
  });

  it("runs message-scoped Hermes translation through the account message route", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        {
          skillRunId: "run_translate_1",
          skillId: "translate_text",
          accountId: "account_1",
          messageId: "message_1",
          sourceLanguage: "auto",
          targetLanguage: "Chinese",
          translatedText: "你好，请确认发布时间。",
          cached: false,
        },
        202,
      ),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const translation = await api.translateMessage({
      accountId: "account_1",
      messageId: "message_1",
      targetLanguage: "Chinese",
      sourceLanguage: "English",
      tone: "preserve original meaning",
      memoryIds: ["memory_translation"],
      memoryScope: "sender:client@example.com",
      memoryLayers: ["contact_memory", "procedural_memory"],
      forceRefresh: true,
    });

    expect(translation).toMatchObject({
      accountId: "account_1",
      messageId: "message_1",
      translatedText: "你好，请确认发布时间。",
      cached: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/accounts/account_1/messages/message_1/translate",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          targetLanguage: "Chinese",
          sourceLanguage: "English",
          tone: "preserve original meaning",
          memoryIds: ["memory_translation"],
          memoryScope: "sender:client@example.com",
          memoryLayers: ["contact_memory", "procedural_memory"],
          forceRefresh: true,
        }),
      }),
    );
  });

  it("confirms Hermes translation preferences with account scope", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        {
          memory: {
            id: "memory_translation_1",
            accountId: "account_1",
            layer: "procedural_memory",
            scope: "sender:client@example.com",
            content: { source: "translation_preference" },
            confidence: 0.92,
            createdAt: "2026-06-14T08:00:00.000Z",
            updatedAt: "2026-06-14T08:00:00.000Z",
          },
        },
        201,
      ),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const result = await api.confirmTranslationPreference({
      accountId: "account_1",
      mode: "always",
      sourceLanguage: "Chinese",
      targetLanguage: "English",
      memoryScope: "sender:client@example.com",
      reason: "Reader translation preference for client@example.com",
    });

    expect(result.memory).toMatchObject({
      id: "memory_translation_1",
      accountId: "account_1",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/hermes/translation-preferences",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          accountId: "account_1",
          mode: "always",
          sourceLanguage: "Chinese",
          targetLanguage: "English",
          memoryScope: "sender:client@example.com",
          reason: "Reader translation preference for client@example.com",
        }),
      }),
    );
  });

  it("runs message-scoped Hermes summaries through the account message route", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        {
          skillRunId: "run_summary_1",
          skillId: "thread_summarize",
          accountId: "account_1",
          messageId: "message_1",
          mode: "action_points",
          summaryText: "Action: confirm the schedule today.",
          cached: false,
        },
        202,
      ),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const summary = await api.summarizeMessage({
      accountId: "account_1",
      messageId: "message_1",
      mode: "action_points",
      focus: "decisions and reply needs",
      language: "zh-CN",
      memoryScope: "global",
    });

    expect(summary).toMatchObject({
      accountId: "account_1",
      messageId: "message_1",
      mode: "action_points",
      summaryText: "Action: confirm the schedule today.",
      cached: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/accounts/account_1/messages/message_1/summary",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          mode: "action_points",
          focus: "decisions and reply needs",
          language: "zh-CN",
          memoryScope: "global",
        }),
      }),
    );
  });

  it("loads Hermes workspace context for mailbox-aware operations", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        generatedAt: "2026-06-16T01:00:00.000Z",
        accountScope: {
          requestedAccountId: "account_1",
          availableAccountIds: ["account_1"],
        },
        accounts: [
          {
            accountId: "account_1",
            email: "lina@example.com",
            provider: "gmail",
            authMethod: "oauth",
            syncState: "syncing",
            engineProvider: "emailengine",
            reauthRequired: false,
            nextAction: "none",
            accountUpdatedAt: "2026-06-16T00:00:00.000Z",
          },
        ],
        navigation: {
          providerGroups: [{ id: "gmail", label: "Gmail", count: 1 }],
          quickCategories: [{ id: "codes", label: "验证码", tone: "blue", count: 3 }],
        },
        labels: [],
        rules: [],
        pendingRuleCandidates: [],
        skills: [
          {
            id: "translate_text",
            title: "翻译邮件",
            mode: "read",
            description: "翻译邮件正文",
          },
        ],
        mailEngine: {
          provider: "emailengine",
          ok: false,
          missing: ["EMAILENGINE_ACCESS_TOKEN"],
          warnings: [],
          readiness: {
            status: "degraded",
            summary: "EmailEngine 配置未完全就绪。",
          },
          capabilities: {
            imapSmtpOnboarding: false,
            attachmentDownload: false,
            send: false,
          },
        },
        operationBoundaries: [
          {
            id: "create_mailbox_rule",
            title: "创建邮箱规则和左侧分组",
            mode: "confirmation_required",
            description: "先模拟，再确认启用。",
          },
        ],
        unavailableModules: [],
      }),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const result = await api.getHermesWorkspaceContext({
      accountId: "account_1",
      ruleLimit: 5,
      labelLimit: 8,
    });

    expect(result.accountScope.requestedAccountId).toBe("account_1");
    expect(result.operationBoundaries[0]).toMatchObject({
      id: "create_mailbox_rule",
      mode: "confirmation_required",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/hermes/workspace/context?accountId=account_1&ruleLimit=5&labelLimit=8",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("creates and confirms Hermes action plans through backend routes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          id: "plan_1",
          auditEventId: "audit_plan_1",
          accountId: "account_1",
          command: "帮我创建一个验证码分组规则",
          intent: "create_mailbox_rule",
          status: "requires_confirmation",
          createdAt: "2026-06-16T08:00:00.000Z",
          candidate: {
            id: "candidate_codes",
            accountId: "account_1",
            title: "启用验证码智能分组",
            ruleType: "content_label",
            condition: { anyKeywords: ["验证码", "otp"] },
            action: { type: "apply_label", labelName: "验证码" },
            confidence: 0.9,
            status: "shadow",
            evidenceMessageIds: [],
            createdAt: "2026-06-16T08:00:00.000Z",
          },
          simulation: {
            id: "simulation_1",
            accountId: "account_1",
            candidateId: "candidate_codes",
            mode: "shadow",
            matchedCount: 3,
            sampleMessageIds: ["message_1"],
            actionPreview: { type: "apply_label", labelName: "验证码" },
            createdAt: "2026-06-16T08:00:01.000Z",
          },
          workspace: {
            accountCount: 1,
            labelCount: 2,
            ruleCount: 0,
            pendingRuleCandidateCount: 0,
            unavailableModules: [],
          },
          safety: {
            requiresUserConfirmation: true,
            providerWriteback: false,
            appliesToHistory: false,
            destructive: false,
          },
          steps: [],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: "confirmation_1",
          auditEventId: "audit_confirm_1",
          planId: "plan_1",
          accountId: "account_1",
          candidateId: "candidate_codes",
          status: "completed",
          confirmedAt: "2026-06-16T08:01:00.000Z",
          rule: {
            id: "rule_codes",
            accountId: "account_1",
            candidateId: "candidate_codes",
            title: "启用验证码智能分组",
            ruleType: "content_label",
            condition: { anyKeywords: ["验证码", "otp"] },
            action: { type: "apply_label", labelId: "label_codes" },
            confidence: 0.9,
            enabled: true,
            createdAt: "2026-06-16T08:01:00.000Z",
          },
          safety: {
            requiresUserConfirmation: false,
            providerWriteback: false,
            appliesToHistory: true,
            destructive: false,
          },
          historyBackfill: {
            accountId: "account_1",
            ruleId: "rule_codes",
            matchedCount: 3,
            appliedCount: 2,
            sampleMessageIds: ["message_1"],
          },
          steps: [],
        }),
      );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const plan = await api.createHermesActionPlan({
      accountId: "account_1",
      command: "帮我创建一个验证码分组规则",
      candidateId: "candidate_codes",
      sampleLimit: 12,
    });
    const confirmation = await api.confirmHermesActionPlan({
      planId: plan.id,
      accountId: "account_1",
      candidateId: plan.candidate.id,
    });

    expect(plan.auditEventId).toBe("audit_plan_1");
    expect(confirmation.rule.id).toBe("rule_codes");
    expect(confirmation.historyBackfill).toMatchObject({
      matchedCount: 3,
      appliedCount: 2,
      sampleMessageIds: ["message_1"],
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/hermes/action-plans",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          accountId: "account_1",
          command: "帮我创建一个验证码分组规则",
          candidateId: "candidate_codes",
          sampleLimit: 12,
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/hermes/action-plans/plan_1/confirm",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          accountId: "account_1",
          candidateId: "candidate_codes",
        }),
      }),
    );
  });

  it("runs Hermes quick reply through the backend skills route", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          skillRunId: "run_quick_1",
          skillId: "quick_reply",
          scenario: "thanks",
          draftText: "Thanks, I will take a look.",
          editable: true,
          sendsDirectly: false,
        },
        202,
      ),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const result = await api.quickReply({
      subject: "Launch schedule confirmation",
      threadText: "Please confirm the launch schedule.",
      scenario: "thanks",
      instruction: "Thank them briefly.",
      readMessageIds: ["message_1"],
    });

    expect(result).toEqual({
      skillRunId: "run_quick_1",
      skillId: "quick_reply",
      scenario: "thanks",
      draftText: "Thanks, I will take a look.",
      editable: true,
      sendsDirectly: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/hermes/skills/quick_reply/run",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          subject: "Launch schedule confirmation",
          threadText: "Please confirm the launch schedule.",
          scenario: "thanks",
          instruction: "Thank them briefly.",
          readMessageIds: ["message_1"],
        }),
      }),
    );
  });

  it("runs Hermes quick reply through the message-scoped backend route", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          skillRunId: "run_message_quick_1",
          skillId: "quick_reply",
          accountId: "account_1",
          messageId: "message_1",
          scenario: "thanks",
          draftText: "Thanks, I will take a look.",
          editable: true,
          sendsDirectly: false,
        },
        202,
      ),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const result = await api.quickMessageReply({
      accountId: "account_1",
      messageId: "message_1",
      scenario: "thanks",
      instruction: "Thank them briefly.",
      tone: "warm professional",
    });

    expect(result).toEqual({
      skillRunId: "run_message_quick_1",
      skillId: "quick_reply",
      accountId: "account_1",
      messageId: "message_1",
      scenario: "thanks",
      draftText: "Thanks, I will take a look.",
      editable: true,
      sendsDirectly: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/accounts/account_1/messages/message_1/quick-reply",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          scenario: "thanks",
          instruction: "Thank them briefly.",
          tone: "warm professional",
        }),
      }),
    );
    const body = (fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body;
    expect(JSON.parse(body)).not.toHaveProperty("threadText");
  });

  it("runs Hermes rewrite and polish through the backend skills route", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          skillRunId: "run_rewrite_1",
          skillId: "rewrite_polish",
          action: "polish",
          rewrittenText: "Hi Lina,\n\nPlease review the launch plan today.",
          editable: true,
          sendsDirectly: false,
        },
        202,
      ),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const result = await api.rewritePolishDraft({
      accountId: "account_1",
      text: "please review launch plan",
      action: "polish",
      instruction: "Make it professional.",
      tone: "clear professional",
    });

    expect(result).toEqual({
      skillRunId: "run_rewrite_1",
      skillId: "rewrite_polish",
      action: "polish",
      rewrittenText: "Hi Lina,\n\nPlease review the launch plan today.",
      editable: true,
      sendsDirectly: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/hermes/skills/rewrite_polish/run?accountId=account_1",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          accountId: "account_1",
          text: "please review launch plan",
          action: "polish",
          instruction: "Make it professional.",
          tone: "clear professional",
        }),
      }),
    );
  });
});
