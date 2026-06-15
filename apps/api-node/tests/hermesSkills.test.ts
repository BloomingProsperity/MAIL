import { describe, expect, it } from "vitest";

import { getHermesSkills } from "../src/hermes/skills";

describe("Hermes skills", () => {
  it("ships translation as a first-class built-in mail skill", () => {
    const skills = getHermesSkills();

    expect(skills.map((skill) => skill.id)).toContain("translate_text");
    expect(skills.find((skill) => skill.id === "translate_text")).toEqual({
      id: "translate_text",
      title: "翻译邮件",
      mode: "read",
      description: "翻译邮件正文、选中文本或草稿，保留格式和语气",
    });
  });
});
