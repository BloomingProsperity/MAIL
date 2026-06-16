import {
  getHermesSkill,
  getHermesSkills,
  isKnownHermesSkill,
  normalizeHermesSkillSettings,
  type HermesSkill,
  type HermesSkillSettings,
  type HermesSkillSettingsPatch,
} from "./skills.js";

export interface HermesSkillSettingsStore {
  listSettings(): Promise<Record<string, Partial<HermesSkillSettings>>>;
  getSettings(skillId: string): Promise<Partial<HermesSkillSettings> | undefined>;
  saveSettings(input: {
    skillId: string;
    settings: HermesSkillSettings;
  }): Promise<Partial<HermesSkillSettings>>;
}

export interface HermesSkillSettingsService {
  listSkills(): Promise<HermesSkill[]>;
  getSkill(skillId: string): Promise<HermesSkill | undefined>;
  updateSkillSettings(input: {
    skillId: string;
    patch: HermesSkillSettingsPatch;
  }): Promise<HermesSkill>;
}

export class InvalidHermesSkillSettingsRequestError extends Error {
  readonly code = "invalid_hermes_skill_settings_request";

  constructor(message = "invalid Hermes skill settings request") {
    super(message);
  }
}

export class HermesSkillDisabledError extends Error {
  readonly code = "hermes_skill_disabled";
  readonly statusCode = 403;
  readonly skillId: string;

  constructor(skillId: string, message = "Hermes skill is disabled") {
    super(message);
    this.skillId = skillId;
  }
}

export function createHermesSkillSettingsService(options: {
  store: HermesSkillSettingsStore;
}): HermesSkillSettingsService {
  return {
    async listSkills() {
      return getHermesSkills(await options.store.listSettings());
    },

    async getSkill(skillId) {
      if (!isKnownHermesSkill(skillId)) {
        return undefined;
      }

      return getHermesSkill(skillId, {
        [skillId]: (await options.store.getSettings(skillId)) ?? {},
      });
    },

    async updateSkillSettings(input) {
      if (!isKnownHermesSkill(input.skillId)) {
        throw new InvalidHermesSkillSettingsRequestError("unknown Hermes skill");
      }

      const current = (await options.store.getSettings(input.skillId)) ?? {};
      const settings = normalizeHermesSkillSettings(
        input.skillId,
        input.patch,
        current,
      );
      const saved = await options.store.saveSettings({
        skillId: input.skillId,
        settings,
      });
      const skill = getHermesSkill(input.skillId, { [input.skillId]: saved });
      if (!skill) {
        throw new InvalidHermesSkillSettingsRequestError("unknown Hermes skill");
      }

      return skill;
    },
  };
}
