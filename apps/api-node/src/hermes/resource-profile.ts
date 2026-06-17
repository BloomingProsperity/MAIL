import type { HermesSkill } from "./skills.js";

export interface HermesRetentionPolicy {
  retentionDays: number;
  cleanupIntervalMs: number;
  cleanupLimit: number;
}

export interface HermesResourceProfileInput {
  skills: HermesSkill[];
  retention?: Partial<HermesRetentionPolicy>;
}

export interface HermesResourceProfile {
  skills: {
    total: number;
    enabled: number;
    bodyReadEnabled: number;
    memoryWriteEnabled: number;
    confirmationRequired: number;
    maxContextCharsPerRun: number;
    maxMemoryItemsPerRun: number;
    enabledContextBudgetChars: number;
    enabledMemoryBudgetItems: number;
  };
  retention: HermesRetentionPolicy & {
    managedTables: string[];
  };
  deployment: {
    profile: "small" | "medium" | "large";
    recommendedMinimum: {
      cpuCores: number;
      memoryGb: number;
      diskGb: number;
    };
    localModelRecommendedMinimum: {
      cpuCores: number;
      memoryGb: number;
      diskGb: number;
    };
  };
  guardrails: string[];
}

const DEFAULT_RETENTION: HermesRetentionPolicy = {
  retentionDays: 30,
  cleanupIntervalMs: 60 * 60 * 1000,
  cleanupLimit: 500,
};

const HERMES_RETENTION_TABLES = [
  "hermes_message_translations",
  "hermes_message_summaries",
  "hermes_action_plans",
  "hermes_feedback",
  "hermes_audit_events",
  "hermes_skill_runs",
];

export function createHermesResourceProfile(
  input: HermesResourceProfileInput,
): HermesResourceProfile {
  const retention = normalizeRetention(input.retention);
  const enabledSkills = input.skills.filter((skill) => skill.settings.enabled);
  const maxContextCharsPerRun = maxSkillSetting(
    enabledSkills,
    (skill) => skill.settings.maxContextChars,
  );
  const maxMemoryItemsPerRun = maxSkillSetting(
    enabledSkills,
    (skill) => skill.settings.memoryLimit,
  );
  const enabledContextBudgetChars = sumSkillSetting(
    enabledSkills,
    (skill) => skill.settings.maxContextChars,
  );
  const enabledMemoryBudgetItems = sumSkillSetting(
    enabledSkills,
    (skill) => skill.settings.memoryLimit,
  );

  return {
    skills: {
      total: input.skills.length,
      enabled: enabledSkills.length,
      bodyReadEnabled: enabledSkills.filter(
        (skill) => skill.settings.allowBodyRead,
      ).length,
      memoryWriteEnabled: enabledSkills.filter(
        (skill) => skill.settings.allowMemoryWrite,
      ).length,
      confirmationRequired: enabledSkills.filter(
        (skill) => skill.settings.requireConfirmation,
      ).length,
      maxContextCharsPerRun,
      maxMemoryItemsPerRun,
      enabledContextBudgetChars,
      enabledMemoryBudgetItems,
    },
    retention: {
      ...retention,
      managedTables: HERMES_RETENTION_TABLES,
    },
    deployment: deploymentForBudget(maxContextCharsPerRun, enabledSkills.length),
    guardrails: [
      "Prompt context is capped per skill before provider calls and audit persistence.",
      "Skill custom instructions are length capped and appended below system rules.",
      "Memory fan-out is capped per skill through memoryLimit.",
      "State-changing learning paths must pass skill permission and confirmation checks.",
      "Retention cleanup prunes expired Hermes caches, plans, feedback, audit events, and skill runs in bounded batches.",
    ],
  };
}

function normalizeRetention(
  input: Partial<HermesRetentionPolicy> | undefined,
): HermesRetentionPolicy {
  return {
    retentionDays: positiveInteger(
      input?.retentionDays,
      DEFAULT_RETENTION.retentionDays,
    ),
    cleanupIntervalMs: positiveInteger(
      input?.cleanupIntervalMs,
      DEFAULT_RETENTION.cleanupIntervalMs,
    ),
    cleanupLimit: positiveInteger(
      input?.cleanupLimit,
      DEFAULT_RETENTION.cleanupLimit,
    ),
  };
}

function deploymentForBudget(
  maxContextCharsPerRun: number,
  enabledSkillCount: number,
): HermesResourceProfile["deployment"] {
  if (maxContextCharsPerRun > 80_000 || enabledSkillCount > 20) {
    return {
      profile: "large",
      recommendedMinimum: { cpuCores: 4, memoryGb: 8, diskGb: 40 },
      localModelRecommendedMinimum: { cpuCores: 8, memoryGb: 32, diskGb: 100 },
    };
  }

  if (maxContextCharsPerRun > 32_000 || enabledSkillCount > 12) {
    return {
      profile: "medium",
      recommendedMinimum: { cpuCores: 2, memoryGb: 6, diskGb: 30 },
      localModelRecommendedMinimum: { cpuCores: 6, memoryGb: 24, diskGb: 80 },
    };
  }

  return {
    profile: "small",
    recommendedMinimum: { cpuCores: 2, memoryGb: 4, diskGb: 20 },
    localModelRecommendedMinimum: { cpuCores: 4, memoryGb: 16, diskGb: 60 },
  };
}

function maxSkillSetting(
  skills: HermesSkill[],
  select: (skill: HermesSkill) => number,
): number {
  return skills.reduce((max, skill) => Math.max(max, select(skill)), 0);
}

function sumSkillSetting(
  skills: HermesSkill[],
  select: (skill: HermesSkill) => number,
): number {
  return skills.reduce((sum, skill) => sum + select(skill), 0);
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isInteger(value) || value <= 0) {
    return fallback;
  }

  return value;
}
