import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  EmailHubApi,
  HermesResourceProfileDto,
  HermesSkillDto,
} from "../../lib/emailHubApi";
import { HermesSkillSettingsPanel } from "./HermesSkillSettingsPanel";

describe("HermesSkillSettingsPanel", () => {
  it("filters skills by mode and unsaved edits", () => {
    render(<HermesSkillSettingsPanel />);

    expect(screen.getByText("翻译邮件")).toBeTruthy();
    expect(screen.getByText("生成回复草稿")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Show Hermes skill mode draft" }),
    );
    expect(screen.getByText("生成回复草稿")).toBeTruthy();
    expect(screen.queryByText("翻译邮件")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Show Hermes skill mode all" }),
    );
    const translateCard = screen
      .getByText("翻译邮件")
      .closest("article") as HTMLElement;
    fireEvent.click(
      within(translateCard).getByLabelText("Enable Hermes skill 翻译邮件"),
    );
    expect(within(translateCard).getByText(/未保存/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText("仅看未保存"));
    expect(screen.getByText("翻译邮件")).toBeTruthy();
    expect(screen.queryByText("线程总结")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Reset Hermes skill settings 翻译邮件",
      }),
    );
    expect(screen.getByText("没有匹配的 Hermes 能力。")).toBeTruthy();
  });

  it("filters skills by title, id, and description search", () => {
    render(<HermesSkillSettingsPanel />);

    const searchInput = screen.getByLabelText(
      "Search Hermes skills",
    ) as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: "回复" } });
    expect(screen.getByText("生成回复草稿")).toBeTruthy();
    expect(screen.queryByText("翻译邮件")).toBeNull();

    fireEvent.change(searchInput, { target: { value: "rule_suggest" } });
    expect(screen.getByText("规则建议")).toBeTruthy();
    expect(screen.queryByText("生成回复草稿")).toBeNull();

    fireEvent.change(searchInput, { target: { value: "自然语言" } });
    expect(screen.getByText("自然语言查邮件")).toBeTruthy();
    expect(screen.queryByText("规则建议")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Show Hermes skill mode draft" }),
    );
    expect(screen.getByText("没有匹配的 Hermes 能力。")).toBeTruthy();
  });

  it("reveals and marks a focused skill from another filter", async () => {
    const { rerender } = render(<HermesSkillSettingsPanel />);

    fireEvent.click(
      screen.getByRole("button", { name: "Show Hermes skill mode draft" }),
    );
    fireEvent.change(screen.getByLabelText("Search Hermes skills"), {
      target: { value: "回复" },
    });
    fireEvent.click(screen.getByLabelText("仅看未保存"));
    expect(screen.queryByText("翻译邮件")).toBeNull();

    rerender(
      <HermesSkillSettingsPanel
        focusedSkillId="translate_text"
        focusRequestId={1}
      />,
    );

    const focusedCard = await screen.findByLabelText(
      "Focused Hermes skill 翻译邮件",
    );
    expect(
      within(focusedCard).getByLabelText("Enable Hermes skill 翻译邮件"),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Show Hermes skill mode read" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      (screen.getByLabelText("Search Hermes skills") as HTMLInputElement).value,
    ).toBe("");
  });

  it("focuses the requested skill permission toggle", async () => {
    const { rerender } = render(
      <HermesSkillSettingsPanel
        focusedSkillId="translate_text"
        focusedPermission="body_read"
        focusRequestId={1}
      />,
    );

    const bodyReadToggle = await screen.findByLabelText(
      "Allow Hermes body reads 翻译邮件",
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(bodyReadToggle);
    });

    rerender(
      <HermesSkillSettingsPanel
        focusedSkillId="translate_text"
        focusedPermission="memory_write"
        focusRequestId={2}
      />,
    );

    const memoryWriteToggle = await screen.findByLabelText(
      "Allow Hermes memory writes 翻译邮件",
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(memoryWriteToggle);
    });
  });

  it("saves all changed backend skill settings and refreshes the resource profile", async () => {
    const api = createSkillApiFixture();

    render(<HermesSkillSettingsPanel api={api} />);

    const panel = await screen.findByLabelText("Hermes skill settings");
    expect(await within(panel).findByText("能力选项已同步。")).toBeTruthy();
    expect(within(panel).getByText("启用技能").nextSibling?.textContent).toBe(
      "2/2",
    );

    const translateCard = within(panel)
      .getByText("翻译邮件")
      .closest("article") as HTMLElement;
    const replyCard = within(panel)
      .getByText("生成回复草稿")
      .closest("article") as HTMLElement;

    fireEvent.click(
      within(translateCard).getByLabelText("Enable Hermes skill 翻译邮件"),
    );
    fireEvent.change(
      within(replyCard).getByLabelText("Hermes skill memory limit 生成回复草稿"),
      { target: { value: "0" } },
    );

    fireEvent.click(
      within(panel).getByRole("button", {
        name: "Save all changed Hermes skill settings",
      }),
    );

    await waitFor(() => {
      expect(api.updateHermesSkillSettings).toHaveBeenCalledWith({
        skillId: "translate_text",
        patch: expect.objectContaining({ enabled: false }),
      });
      expect(api.updateHermesSkillSettings).toHaveBeenCalledWith({
        skillId: "reply_draft",
        patch: expect.objectContaining({ memoryLimit: 0 }),
      });
    });
    expect(api.getHermesResourceProfile).toHaveBeenCalledTimes(2);
    expect(
      await within(panel).findByText("已保存 2 个能力选项，资源画像已刷新。"),
    ).toBeTruthy();

    const savedTranslateCard = within(panel)
      .getByText("翻译邮件")
      .closest("article") as HTMLElement;
    expect(within(savedTranslateCard).getByText(/已同步/)).toBeTruthy();
  });

  it("snaps budget inputs to backend bounds before saving", async () => {
    const api = createSkillApiFixture();

    render(<HermesSkillSettingsPanel api={api} />);

    const panel = await screen.findByLabelText("Hermes skill settings");
    const translateCard = within(panel)
      .getByText("翻译邮件")
      .closest("article") as HTMLElement;
    const contextInput = within(translateCard).getByLabelText(
      "Hermes skill max context 翻译邮件",
    ) as HTMLInputElement;
    const memoryInput = within(translateCard).getByLabelText(
      "Hermes skill memory limit 翻译邮件",
    ) as HTMLInputElement;

    fireEvent.change(contextInput, { target: { value: "12500" } });
    fireEvent.change(memoryInput, { target: { value: "99" } });

    expect(contextInput.value).toBe("12000");
    expect(memoryInput.value).toBe("50");

    fireEvent.click(
      within(translateCard).getByRole("button", {
        name: "Save Hermes skill settings 翻译邮件",
      }),
    );

    await waitFor(() => {
      expect(api.updateHermesSkillSettings).toHaveBeenCalledWith({
        skillId: "translate_text",
        patch: expect.objectContaining({
          maxContextChars: 12000,
          memoryLimit: 50,
        }),
      });
    });
  });

  it("saves memory-write permission changes for a single skill", async () => {
    const api = createSkillApiFixture();

    render(<HermesSkillSettingsPanel api={api} />);

    const panel = await screen.findByLabelText("Hermes skill settings");
    const translateCard = within(panel)
      .getByText("翻译邮件")
      .closest("article") as HTMLElement;

    fireEvent.click(
      within(translateCard).getByLabelText(
        "Allow Hermes memory writes 翻译邮件",
      ),
    );
    fireEvent.click(
      within(translateCard).getByRole("button", {
        name: "Save Hermes skill settings 翻译邮件",
      }),
    );

    await waitFor(() => {
      expect(api.updateHermesSkillSettings).toHaveBeenCalledWith({
        skillId: "translate_text",
        patch: expect.objectContaining({ allowMemoryWrite: true }),
      });
    });
  });

  it("keeps failed skills unsaved when a bulk save partially fails", async () => {
    const api = createSkillApiFixture();
    vi.mocked(api.updateHermesSkillSettings).mockImplementation(async (input) => {
      if (input.skillId === "reply_draft") {
        throw new Error("save failed");
      }
      return skillFixture({
        id: "translate_text",
        title: "翻译邮件",
        mode: "read",
        description: "翻译邮件正文",
        settings: {
          ...skillSettingsFixture(),
          ...input.patch,
        },
      });
    });

    render(<HermesSkillSettingsPanel api={api} />);

    const panel = await screen.findByLabelText("Hermes skill settings");
    const translateCard = within(panel)
      .getByText("翻译邮件")
      .closest("article") as HTMLElement;
    const replyCard = within(panel)
      .getByText("生成回复草稿")
      .closest("article") as HTMLElement;

    fireEvent.click(
      within(translateCard).getByLabelText("Enable Hermes skill 翻译邮件"),
    );
    fireEvent.change(
      within(replyCard).getByLabelText("Hermes skill memory limit 生成回复草稿"),
      { target: { value: "0" } },
    );
    fireEvent.click(
      within(panel).getByRole("button", {
        name: "Save all changed Hermes skill settings",
      }),
    );

    expect(
      await within(panel).findByText(
        "已保存 1 个能力选项，1 个保存失败，资源画像已刷新。",
      ),
    ).toBeTruthy();
    expect(within(translateCard).getByText(/已同步/)).toBeTruthy();
    expect(within(replyCard).getByText(/未保存/)).toBeTruthy();
  });

  it("keeps a single failed skill save unsaved", async () => {
    const api = createSkillApiFixture();
    vi.mocked(api.updateHermesSkillSettings).mockRejectedValueOnce(
      new Error("save failed"),
    );

    render(<HermesSkillSettingsPanel api={api} />);

    const panel = await screen.findByLabelText("Hermes skill settings");
    const translateCard = within(panel)
      .getByText("翻译邮件")
      .closest("article") as HTMLElement;

    fireEvent.click(
      within(translateCard).getByLabelText("Enable Hermes skill 翻译邮件"),
    );
    fireEvent.click(
      within(translateCard).getByRole("button", {
        name: "Save Hermes skill settings 翻译邮件",
      }),
    );

    expect(await within(panel).findByText("保存失败：翻译邮件。")).toBeTruthy();
    expect(within(translateCard).getByText(/未保存/)).toBeTruthy();
    expect(
      (
        within(translateCard).getByRole("button", {
          name: "Save Hermes skill settings 翻译邮件",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("locks skill inputs while a backend save is in flight", async () => {
    const api = createSkillApiFixture();
    const pendingUpdate = deferred<HermesSkillDto>();
    vi.mocked(api.updateHermesSkillSettings).mockImplementation(
      async () => pendingUpdate.promise,
    );

    render(<HermesSkillSettingsPanel api={api} />);

    const panel = await screen.findByLabelText("Hermes skill settings");
    const translateCard = within(panel)
      .getByText("翻译邮件")
      .closest("article") as HTMLElement;
    fireEvent.click(
      within(translateCard).getByLabelText("Enable Hermes skill 翻译邮件"),
    );
    fireEvent.click(
      within(translateCard).getByRole("button", {
        name: "Save Hermes skill settings 翻译邮件",
      }),
    );

    await waitFor(() => {
      expect(api.updateHermesSkillSettings).toHaveBeenCalledWith({
        skillId: "translate_text",
        patch: expect.objectContaining({ enabled: false }),
      });
    });
    expect(
      (
        within(translateCard).getByLabelText(
          "Enable Hermes skill 翻译邮件",
        ) as HTMLInputElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        within(translateCard).getByLabelText(
          "Hermes skill max context 翻译邮件",
        ) as HTMLInputElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        within(translateCard).getByLabelText(
          "Hermes skill custom instructions 翻译邮件",
        ) as HTMLTextAreaElement
      ).disabled,
    ).toBe(true);

    pendingUpdate.resolve(
      skillFixture({
        id: "translate_text",
        title: "翻译邮件",
        mode: "read",
        description: "翻译邮件正文",
        settings: {
          ...skillSettingsFixture(),
          enabled: false,
        },
      }),
    );

    await waitFor(() => {
      expect(
        (
          within(translateCard).getByLabelText(
            "Enable Hermes skill 翻译邮件",
          ) as HTMLInputElement
        ).disabled,
      ).toBe(false);
    });
  });
});

function createSkillApiFixture(): EmailHubApi {
  const skills = [
    skillFixture({
      id: "translate_text",
      title: "翻译邮件",
      mode: "read",
      description: "翻译邮件正文",
    }),
    skillFixture({
      id: "reply_draft",
      title: "生成回复草稿",
      mode: "draft",
      description: "根据上下文生成可编辑回复",
      settings: {
        ...skillSettingsFixture(),
        requireConfirmation: true,
      },
    }),
  ];
  const api = {
    listHermesSkills: vi.fn(async () => skills),
    getHermesResourceProfile: vi.fn(async () => resourceProfileFixture()),
    updateHermesSkillSettings: vi.fn(async (input) => {
      const skill = skills.find((item) => item.id === input.skillId);
      if (!skill) {
        throw new Error(`Unknown skill ${input.skillId}`);
      }
      return {
        ...skill,
        settings: {
          ...skill.settings,
          ...input.patch,
        },
      };
    }),
  };
  return api as typeof api & EmailHubApi;
}

function skillFixture(overrides: Partial<HermesSkillDto> = {}): HermesSkillDto {
  return {
    id: "thread_summarize",
    title: "线程总结",
    mode: "read",
    description: "总结线程状态、争议点和下一步",
    settings: skillSettingsFixture(),
    settingBounds: {
      maxContextChars: { min: 1000, max: 200000, step: 1000 },
      memoryLimit: { min: 0, max: 50, step: 1 },
      customInstructions: { maxLength: 2000 },
    },
    ...overrides,
  };
}

function skillSettingsFixture(): HermesSkillDto["settings"] {
  return {
    enabled: true,
    maxContextChars: 24000,
    memoryLimit: 6,
    allowBodyRead: true,
    allowMemoryWrite: false,
    requireConfirmation: false,
    customInstructions: "",
  };
}

function resourceProfileFixture(): HermesResourceProfileDto {
  return {
    skills: {
      total: 2,
      enabled: 2,
      bodyReadEnabled: 2,
      memoryWriteEnabled: 0,
      confirmationRequired: 1,
      maxContextCharsPerRun: 24000,
      maxMemoryItemsPerRun: 6,
      enabledContextBudgetChars: 48000,
      enabledMemoryBudgetItems: 12,
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
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
