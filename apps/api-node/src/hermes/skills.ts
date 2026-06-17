export interface HermesSkill {
  id: string;
  title: string;
  mode: "read" | "draft" | "classify" | "learn";
  description: string;
  settings: HermesSkillSettings;
  settingBounds: HermesSkillSettingBounds;
}

export interface HermesSkillSettings {
  enabled: boolean;
  maxContextChars: number;
  memoryLimit: number;
  allowBodyRead: boolean;
  allowMemoryWrite: boolean;
  requireConfirmation: boolean;
}

export interface HermesSkillSettingBounds {
  maxContextChars: {
    min: number;
    max: number;
    step: number;
  };
  memoryLimit: {
    min: number;
    max: number;
    step: number;
  };
}

export type HermesSkillSettingsPatch = Partial<HermesSkillSettings>;

const SETTING_BOUNDS: HermesSkillSettingBounds = {
  maxContextChars: {
    min: 1_000,
    max: 200_000,
    step: 1_000,
  },
  memoryLimit: {
    min: 0,
    max: 50,
    step: 1,
  },
};

const DEFAULT_SETTINGS: HermesSkillSettings = {
  enabled: true,
  maxContextChars: 24_000,
  memoryLimit: 6,
  allowBodyRead: true,
  allowMemoryWrite: false,
  requireConfirmation: false,
};

const SKILL_DEFINITIONS: Array<
  Omit<HermesSkill, "settings" | "settingBounds"> & {
    settings?: Partial<HermesSkillSettings>;
  }
> = [
  definition("thread_summarize", "线程总结", "read", "总结线程状态、争议点和下一步"),
  definition("reply_draft", "生成回复草稿", "draft", "根据上下文生成可编辑回复", {
    allowMemoryWrite: true,
    requireConfirmation: true,
  }),
  definition("rewrite_polish", "改写润色", "draft", "缩短、扩写或调整语气", {
    allowMemoryWrite: true,
    requireConfirmation: true,
  }),
  definition("quick_reply", "快速短回复", "draft", "生成确认、拒绝、推进等短回复", {
    allowMemoryWrite: true,
    requireConfirmation: true,
  }),
  definition("email_search_qa", "自然语言查邮件", "read", "把问题转成搜索并总结结果"),
  definition("action_item_extract", "提取待办", "read", "识别负责人、期限和承诺"),
  definition("priority_triage", "优先级判断", "classify", "给出优先级和理由"),
  definition("label_suggest", "建议标签", "classify", "建议标签、归档、稍后"),
  definition("newsletter_cleanup", "订阅清理", "classify", "识别订阅和营销邮件"),
  definition("followup_tracker", "跟进追踪", "read", "识别待回复和等待对方回复"),
  definition(
    "translate_text",
    "翻译邮件",
    "read",
    "翻译邮件正文、选中文本或草稿，保留格式和语气",
    {
      allowMemoryWrite: true,
    },
  ),
  definition("action_plan", "执行计划", "learn", "把自然语言邮箱操作转成可确认计划", {
    allowMemoryWrite: true,
    requireConfirmation: true,
  }),
  definition("rule_suggest", "规则建议", "learn", "从重复行为生成候选规则", {
    requireConfirmation: true,
  }),
  definition("memory_review", "记忆管理", "learn", "查看、修改、删除偏好", {
    allowBodyRead: false,
    allowMemoryWrite: true,
    requireConfirmation: true,
  }),
];

export function getHermesSkills(
  settingsBySkillId: Record<string, Partial<HermesSkillSettings>> = {},
): HermesSkill[] {
  return SKILL_DEFINITIONS.map((item) => skill(item, settingsBySkillId[item.id]));
}

export function getHermesSkill(
  skillId: string,
  settingsBySkillId: Record<string, Partial<HermesSkillSettings>> = {},
): HermesSkill | undefined {
  const definition = SKILL_DEFINITIONS.find((item) => item.id === skillId);
  return definition ? skill(definition, settingsBySkillId[skillId]) : undefined;
}

export function isKnownHermesSkill(skillId: string): boolean {
  return SKILL_DEFINITIONS.some((item) => item.id === skillId);
}

export function normalizeHermesSkillSettings(
  skillId: string,
  patch: HermesSkillSettingsPatch = {},
  current: Partial<HermesSkillSettings> = {},
): HermesSkillSettings {
  const definition = SKILL_DEFINITIONS.find((item) => item.id === skillId);
  if (!definition) {
    throw new Error("unknown Hermes skill");
  }

  const base = {
    ...DEFAULT_SETTINGS,
    ...definition.settings,
    ...current,
    ...patch,
  };

  return {
    enabled: normalizeBoolean(base.enabled, "enabled"),
    maxContextChars: normalizeInteger(
      base.maxContextChars,
      SETTING_BOUNDS.maxContextChars.min,
      SETTING_BOUNDS.maxContextChars.max,
      "maxContextChars",
    ),
    memoryLimit: normalizeInteger(
      base.memoryLimit,
      SETTING_BOUNDS.memoryLimit.min,
      SETTING_BOUNDS.memoryLimit.max,
      "memoryLimit",
    ),
    allowBodyRead: normalizeBoolean(base.allowBodyRead, "allowBodyRead"),
    allowMemoryWrite: normalizeBoolean(
      base.allowMemoryWrite,
      "allowMemoryWrite",
    ),
    requireConfirmation: normalizeBoolean(
      base.requireConfirmation,
      "requireConfirmation",
    ),
  };
}

function definition(
  id: string,
  title: string,
  mode: HermesSkill["mode"],
  description: string,
  settings?: Partial<HermesSkillSettings>,
) {
  return {
    id,
    title,
    mode,
    description,
    ...(settings ? { settings } : {}),
  };
}

function skill(
  definition: Omit<HermesSkill, "settings" | "settingBounds"> & {
    settings?: Partial<HermesSkillSettings>;
  },
  settings?: Partial<HermesSkillSettings>,
): HermesSkill {
  return {
    id: definition.id,
    title: definition.title,
    mode: definition.mode,
    description: definition.description,
    settings: normalizeHermesSkillSettings(definition.id, settings),
    settingBounds: SETTING_BOUNDS,
  };
}

function normalizeBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be a boolean`);
  }

  return value;
}

function normalizeInteger(
  value: unknown,
  min: number,
  max: number,
  field: string,
): number {
  if (!Number.isInteger(value)) {
    throw new Error(`${field} is out of range`);
  }

  const numberValue = value as number;
  if (numberValue < min || numberValue > max) {
    throw new Error(`${field} is out of range`);
  }

  return numberValue;
}
