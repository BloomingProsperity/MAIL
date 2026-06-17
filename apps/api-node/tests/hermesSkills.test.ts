import { describe, expect, it } from "vitest";

import {
  getHermesSkills,
  normalizeHermesSkillSettings,
} from "../src/hermes/skills";

describe("Hermes skills", () => {
  it("ships translation as a first-class built-in mail skill", () => {
    const skills = getHermesSkills();

    expect(skills.map((skill) => skill.id)).toContain("translate_text");
    expect(skills.find((skill) => skill.id === "translate_text")).toMatchObject({
      id: "translate_text",
      title: "翻译邮件",
      mode: "read",
      description: "翻译邮件正文、选中文本或草稿，保留格式和语气",
      settings: {
        enabled: true,
        maxContextChars: 24000,
        memoryLimit: 6,
        allowBodyRead: true,
        allowMemoryWrite: true,
        requireConfirmation: false,
        customInstructions: "",
      },
    });
  });

  it("merges editable skill settings with built-in defaults", () => {
    const [skill] = getHermesSkills({
      thread_summarize: {
        enabled: false,
        maxContextChars: 12000,
        memoryLimit: 2,
      },
    });

    expect(skill.settings).toEqual({
      enabled: false,
      maxContextChars: 12000,
      memoryLimit: 2,
      allowBodyRead: true,
      allowMemoryWrite: false,
      requireConfirmation: false,
      customInstructions: "",
    });
    expect(skill.settingBounds.maxContextChars).toEqual({
      min: 1000,
      max: 200000,
      step: 1000,
    });
    expect(skill.settingBounds.customInstructions).toEqual({
      maxLength: 2000,
    });
  });

  it("rejects out-of-range editable settings", () => {
    expect(() =>
      normalizeHermesSkillSettings("translate_text", {
        maxContextChars: 999,
      }),
    ).toThrow("maxContextChars is out of range");
    expect(() =>
      normalizeHermesSkillSettings("translate_text", {
        memoryLimit: 51,
      }),
    ).toThrow("memoryLimit is out of range");
  });

  it("rejects editable context budgets that do not match the configured step", () => {
    expect(() =>
      normalizeHermesSkillSettings("translate_text", {
        maxContextChars: 12500,
      }),
    ).toThrow("maxContextChars is out of range");
  });

  it("normalizes and bounds editable custom instructions", () => {
    expect(
      normalizeHermesSkillSettings("translate_text", {
        customInstructions: "  Keep line breaks.\r\nUse formal Chinese.  ",
      }).customInstructions,
    ).toBe("Keep line breaks.\nUse formal Chinese.");
    expect(() =>
      normalizeHermesSkillSettings("translate_text", {
        customInstructions: "x".repeat(2001),
      }),
    ).toThrow("customInstructions is out of range");
  });
});
