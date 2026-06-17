export const HERMES_TRANSLATION_LANGUAGES = [
  { value: "Chinese", label: "中文" },
  { value: "English", label: "English" },
  { value: "Japanese", label: "日本語" },
  { value: "Korean", label: "한국어" },
  { value: "Spanish", label: "Español" },
  { value: "French", label: "Français" },
] as const;

export const HERMES_SOURCE_LANGUAGES = [
  { value: "auto", label: "自动识别" },
  ...HERMES_TRANSLATION_LANGUAGES,
] as const;

export function hermesTranslationLanguageLabel(value: string): string {
  return (
    HERMES_TRANSLATION_LANGUAGES.find((language) => language.value === value)
      ?.label ?? value
  );
}
