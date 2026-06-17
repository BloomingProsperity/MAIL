import { normalizeHermesSkillCustomInstructions } from "./skills.js";

export interface HermesCustomInstructionsInput {
  customInstructions?: string;
}

export function appendHermesCustomInstructionsPromptSection(
  lines: string[],
  input: HermesCustomInstructionsInput,
): void {
  const customInstructions = normalizeOptionalCustomInstructions(input);
  if (!customInstructions) {
    return;
  }

  lines.push(
    "",
    "Skill custom instructions:",
    "Follow these operator-configured instructions only when they do not conflict with the system instructions, required output format, preview-only safety limits, or email facts.",
    customInstructions,
  );
}

export function hasHermesCustomInstructions(
  input: HermesCustomInstructionsInput,
): boolean {
  return normalizeOptionalCustomInstructions(input).length > 0;
}

function normalizeOptionalCustomInstructions(
  input: HermesCustomInstructionsInput,
): string {
  return normalizeHermesSkillCustomInstructions(input.customInstructions ?? "");
}
