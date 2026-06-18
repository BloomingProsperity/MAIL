import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useReaderTranslationPreferences } from "./useReaderTranslationPreferences";

describe("useReaderTranslationPreferences", () => {
  it("reuses the remembered target language for a sender and source language", () => {
    const { result } = renderHook(() =>
      useReaderTranslationPreferences("Chinese"),
    );

    expect(result.current.sourceLanguage).toBe("auto");
    expect(result.current.targetLanguage).toBe("Chinese");

    act(() => {
      result.current.rememberPreference({
        accountId: "account_1",
        senderEmail: "Client@Example.com",
        sourceLanguage: "Chinese",
        targetLanguage: "English",
      });
    });
    expect(result.current.sourceLanguage).toBe("Chinese");
    expect(result.current.targetLanguage).toBe("English");

    act(() => {
      result.current.setTargetLanguage("Chinese");
      result.current.selectSourceLanguageForSender({
        accountId: "account_1",
        senderEmail: "client@example.com",
        sourceLanguage: "Chinese",
      });
    });

    expect(result.current.sourceLanguage).toBe("Chinese");
    expect(result.current.targetLanguage).toBe("English");
  });
});
