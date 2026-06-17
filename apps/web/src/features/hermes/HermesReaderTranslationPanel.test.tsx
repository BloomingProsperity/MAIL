import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HermesMessageTranslationResult } from "../../lib/emailHubApi";
import {
  HermesReaderTranslationControls,
  HermesReaderTranslationResult,
} from "./HermesReaderTranslationPanel";
import {
  hermesTranslationLanguageLabel,
} from "./hermesTranslation";

afterEach(() => {
  cleanup();
});

describe("Hermes reader translation panel", () => {
  it("routes language changes and translation requests", () => {
    const onSourceLanguageChange = vi.fn();
    const onTargetLanguageChange = vi.fn();
    const onTranslate = vi.fn();

    render(
      <HermesReaderTranslationControls
        sourceLanguage="auto"
        targetLanguage="Chinese"
        busy={false}
        onSourceLanguageChange={onSourceLanguageChange}
        onTargetLanguageChange={onTargetLanguageChange}
        onTranslate={onTranslate}
      />,
    );

    fireEvent.change(
      screen.getByRole("combobox", {
        name: "Hermes translation source language",
      }),
      { target: { value: "English" } },
    );
    fireEvent.change(
      screen.getByRole("combobox", {
        name: "Hermes translation target language",
      }),
      { target: { value: "French" } },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Ask Hermes to translate selected message",
      }),
    );

    expect(onSourceLanguageChange).toHaveBeenCalledWith("English");
    expect(onTargetLanguageChange).toHaveBeenCalledWith("French");
    expect(onTranslate).toHaveBeenCalledTimes(1);
  });

  it("disables translation controls while Hermes is busy", () => {
    render(
      <HermesReaderTranslationControls
        sourceLanguage="auto"
        targetLanguage="Chinese"
        busy
        onSourceLanguageChange={vi.fn()}
        onTargetLanguageChange={vi.fn()}
        onTranslate={vi.fn()}
      />,
    );

    expect(
      (
        screen.getByRole("combobox", {
          name: "Hermes translation source language",
        }) as HTMLSelectElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("combobox", {
          name: "Hermes translation target language",
        }) as HTMLSelectElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Ask Hermes to translate selected message",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("renders translation metadata and remembers preferences", () => {
    const onRememberPreference = vi.fn();
    const onRefresh = vi.fn();

    render(
      <HermesReaderTranslationResult
        translation={translationFixture()}
        preferenceBusy={false}
        refreshBusy={false}
        onRememberPreference={onRememberPreference}
        onRefresh={onRefresh}
      />,
    );

    const result = screen.getByLabelText("Hermes 邮件翻译");
    expect(within(result).getByText("Hermes 翻译 · English")).toBeTruthy();
    expect(
      within(result).getByText(
        /缓存命中 · 运行 run_translate_1 · 审计 audit_translate_1/,
      ),
    ).toBeTruthy();
    expect(
      within(result).getByText("Hello, please confirm the launch plan."),
    ).toBeTruthy();

    fireEvent.click(
      within(result).getByRole("button", {
        name: "Refresh Hermes translation",
      }),
    );
    expect(onRefresh).toHaveBeenCalledTimes(1);

    fireEvent.click(
      within(result).getByRole("button", {
        name: "Remember Hermes translation preference",
      }),
    );
    expect(onRememberPreference).toHaveBeenCalledTimes(1);
  });

  it("only offers refresh for cached reader translations", () => {
    const { rerender } = render(
      <HermesReaderTranslationResult
        translation={translationFixture({ cached: false })}
        preferenceBusy={false}
        refreshBusy={false}
        onRememberPreference={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", {
        name: "Refresh Hermes translation",
      }),
    ).toBeNull();

    rerender(
      <HermesReaderTranslationResult
        translation={translationFixture({ cached: true })}
        preferenceBusy={false}
        refreshBusy
        onRememberPreference={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    const refreshButton = screen.getByRole("button", {
      name: "Refresh Hermes translation",
    }) as HTMLButtonElement;
    expect(refreshButton.disabled).toBe(true);
    expect(refreshButton.textContent).toBe("重新翻译中");
  });

  it("keeps unknown translation language labels visible", () => {
    expect(hermesTranslationLanguageLabel("Portuguese")).toBe("Portuguese");
  });
});

function translationFixture(
  overrides: Partial<HermesMessageTranslationResult> = {},
): HermesMessageTranslationResult {
  return {
    skillRunId: "run_translate_1",
    auditEventId: "audit_translate_1",
    skillId: "translate_text",
    accountId: "account_1",
    messageId: "message_1",
    sourceLanguage: "Chinese",
    targetLanguage: "English",
    translatedText: "Hello, please confirm the launch plan.",
    cached: true,
    ...overrides,
  };
}
