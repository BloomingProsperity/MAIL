import { useRef, useState } from "react";

interface ReaderTranslationPreferenceSelection {
  sourceLanguage: string;
  targetLanguage: string;
}

interface ReaderTranslationPreferenceSenderInput {
  accountId: string;
  senderEmail: string;
}

interface ReaderTranslationPreferenceRememberInput
  extends ReaderTranslationPreferenceSenderInput,
    ReaderTranslationPreferenceSelection {}

interface ReaderTranslationPreferenceSourceInput
  extends ReaderTranslationPreferenceSenderInput {
  sourceLanguage: string;
}

export function useReaderTranslationPreferences(
  initialTargetLanguage = "Chinese",
) {
  const preferencesRef = useRef<
    Record<string, ReaderTranslationPreferenceSelection>
  >({});
  const [sourceLanguage, setSourceLanguage] = useState("auto");
  const [targetLanguage, setTargetLanguage] = useState(initialTargetLanguage);

  function applyPreferenceForSender(
    input: ReaderTranslationPreferenceSenderInput,
  ) {
    const preference =
      preferencesRef.current[readerTranslationPreferenceKey(input)];
    setSourceLanguage(preference?.sourceLanguage ?? "auto");
    if (preference) {
      setTargetLanguage(preference.targetLanguage);
    }
  }

  function rememberPreference(input: ReaderTranslationPreferenceRememberInput) {
    preferencesRef.current[readerTranslationPreferenceKey(input)] = {
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
    };
    setSourceLanguage(input.sourceLanguage);
    setTargetLanguage(input.targetLanguage);
  }

  function selectSourceLanguageForSender(
    input: ReaderTranslationPreferenceSourceInput,
  ) {
    setSourceLanguage(input.sourceLanguage);
    const preference =
      preferencesRef.current[readerTranslationPreferenceKey(input)];
    if (preference?.sourceLanguage === input.sourceLanguage) {
      setTargetLanguage(preference.targetLanguage);
    }
  }

  return {
    sourceLanguage,
    targetLanguage,
    setTargetLanguage,
    applyPreferenceForSender,
    rememberPreference,
    selectSourceLanguageForSender,
  };
}

function readerTranslationPreferenceKey(
  input: ReaderTranslationPreferenceSenderInput,
): string {
  return `${input.accountId}:${input.senderEmail.trim().toLowerCase()}`;
}
