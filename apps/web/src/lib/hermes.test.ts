import { describe, expect, it } from "vitest";
import { getHermesSkills, getMemoryLayers } from "./hermes";

describe("Hermes registry", () => {
  it("ships the required mail skills and inspectable memory layers", () => {
    const skills = getHermesSkills().map((skill) => skill.id);

    expect(skills).toEqual([
      "thread_summarize",
      "translate_text",
      "reply_draft",
      "rewrite_polish",
      "quick_reply",
      "email_search_qa",
      "action_item_extract",
      "priority_triage",
      "label_suggest",
      "newsletter_cleanup",
      "followup_tracker",
      "action_plan",
      "rule_suggest",
      "memory_review"
    ]);
    expect(getMemoryLayers().map((layer) => layer.id)).toContain("writing_style_profile");
  });
});
