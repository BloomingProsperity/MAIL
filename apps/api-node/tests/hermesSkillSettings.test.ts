import { describe, expect, it } from "vitest";

import {
  createHermesSkillSettingsService,
  InvalidHermesSkillSettingsRequestError,
  type HermesSkillSettingsStore,
} from "../src/hermes/skill-settings";
import type { HermesSkillSettings } from "../src/hermes/skills";

describe("Hermes skill settings service", () => {
  it("lists built-in skills with persisted editable settings", async () => {
    const service = createHermesSkillSettingsService({
      store: storeWithSettings({
        translate_text: {
          enabled: false,
          maxContextChars: 12000,
          memoryLimit: 3,
          allowBodyRead: true,
          allowMemoryWrite: false,
          requireConfirmation: false,
        },
      }),
    });

    const skills = await service.listSkills();

    expect(skills.find((skill) => skill.id === "translate_text")).toMatchObject({
      id: "translate_text",
      settings: {
        enabled: false,
        maxContextChars: 12000,
        memoryLimit: 3,
        allowBodyRead: true,
        allowMemoryWrite: false,
        requireConfirmation: false,
      },
    });
    expect(skills.find((skill) => skill.id === "reply_draft")).toMatchObject({
      settings: {
        enabled: true,
        allowMemoryWrite: true,
        requireConfirmation: true,
      },
    });
  });

  it("updates one skill settings row without losing defaults", async () => {
    const saved: unknown[] = [];
    const settingsBySkillId: Record<string, HermesSkillSettings> = {};
    const service = createHermesSkillSettingsService({
      store: storeWithSettings(settingsBySkillId, saved),
    });

    const skill = await service.updateSkillSettings({
      skillId: "reply_draft",
      patch: {
        enabled: false,
        maxContextChars: 32000,
        memoryLimit: 8,
      },
    });

    expect(saved).toEqual([
      {
        skillId: "reply_draft",
        settings: {
          enabled: false,
          maxContextChars: 32000,
          memoryLimit: 8,
          allowBodyRead: true,
          allowMemoryWrite: true,
          requireConfirmation: true,
        },
      },
    ]);
    expect(skill.settings.enabled).toBe(false);
    expect(skill.settings.requireConfirmation).toBe(true);
  });

  it("rejects unknown skills", async () => {
    const service = createHermesSkillSettingsService({
      store: storeWithSettings({}),
    });

    await expect(
      service.updateSkillSettings({
        skillId: "unknown_skill",
        patch: { enabled: false },
      }),
    ).rejects.toBeInstanceOf(InvalidHermesSkillSettingsRequestError);
  });

  it("rejects settings that do not match skill bounds", async () => {
    const saved: unknown[] = [];
    const service = createHermesSkillSettingsService({
      store: storeWithSettings({}, saved),
    });

    await expect(
      service.updateSkillSettings({
        skillId: "translate_text",
        patch: { maxContextChars: 12500 },
      }),
    ).rejects.toBeInstanceOf(InvalidHermesSkillSettingsRequestError);
    expect(saved).toEqual([]);
  });
});

function storeWithSettings(
  settingsBySkillId: Record<string, HermesSkillSettings>,
  saved: unknown[] = [],
): HermesSkillSettingsStore {
  return {
    async listSettings() {
      return settingsBySkillId;
    },
    async getSettings(skillId) {
      return settingsBySkillId[skillId];
    },
    async saveSettings(input) {
      saved.push(input);
      settingsBySkillId[input.skillId] = input.settings;
      return input.settings;
    },
  };
}
