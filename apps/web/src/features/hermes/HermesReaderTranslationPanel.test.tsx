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
        name: "让 Hermes 翻译当前邮件",
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
          name: "让 Hermes 翻译当前邮件",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("prevents no-op reader translations when source and target languages match", () => {
    const onTranslate = vi.fn();

    const { rerender } = render(
      <HermesReaderTranslationControls
        sourceLanguage="English"
        targetLanguage="English"
        busy={false}
        onSourceLanguageChange={vi.fn()}
        onTargetLanguageChange={vi.fn()}
        onTranslate={onTranslate}
      />,
    );

    const translateButton = screen.getByRole("button", {
      name: "让 Hermes 翻译当前邮件",
    }) as HTMLButtonElement;
    expect(translateButton.disabled).toBe(true);
    expect(translateButton.title).toBe("源语言和目标语言相同，无需翻译");
    fireEvent.click(translateButton);
    expect(onTranslate).not.toHaveBeenCalled();

    rerender(
      <HermesReaderTranslationControls
        sourceLanguage="auto"
        targetLanguage="English"
        busy={false}
        onSourceLanguageChange={vi.fn()}
        onTargetLanguageChange={vi.fn()}
        onTranslate={onTranslate}
      />,
    );

    expect(translateButton.disabled).toBe(false);
    fireEvent.click(translateButton);
    expect(onTranslate).toHaveBeenCalledTimes(1);
  });

  it("renders user-facing translation status and remembers preferences", () => {
    const onRememberPreference = vi.fn();
    const onRefresh = vi.fn();

    render(
      <HermesReaderTranslationResult
        translation={translationFixture()}
        preferenceBusy={false}
        refreshBusy={false}
        canRememberPreference
        onRememberPreference={onRememberPreference}
        onRefresh={onRefresh}
      />,
    );

    const result = screen.getByLabelText("Hermes 邮件翻译");
    expect(within(result).getByText("Hermes 翻译 · English")).toBeTruthy();
    expect(within(result).getByText("使用上次翻译结果")).toBeTruthy();
    expect(within(result).queryByText(/run_translate_1|audit_translate_1/)).toBeNull();
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

  it("disables remembering preferences when the source language is not explicit", () => {
    const onRememberPreference = vi.fn();

    render(
      <HermesReaderTranslationResult
        translation={translationFixture({ sourceLanguage: "auto" })}
        preferenceBusy={false}
        refreshBusy={false}
        canRememberPreference={false}
        onRememberPreference={onRememberPreference}
        onRefresh={vi.fn()}
      />,
    );

    const rememberButton = screen.getByRole("button", {
      name: "Remember Hermes translation preference",
    }) as HTMLButtonElement;
    expect(rememberButton.disabled).toBe(true);
    fireEvent.click(rememberButton);
    expect(onRememberPreference).not.toHaveBeenCalled();
  });

  it("refreshes both fresh and cached reader translations", () => {
    const onRefresh = vi.fn();
    const { rerender } = render(
      <HermesReaderTranslationResult
        translation={translationFixture({ cached: false })}
        preferenceBusy={false}
        refreshBusy={false}
        canRememberPreference
        onRememberPreference={vi.fn()}
        onRefresh={onRefresh}
      />,
    );

    const refreshButton = screen.getByRole("button", {
      name: "Refresh Hermes translation",
    }) as HTMLButtonElement;
    expect(refreshButton.disabled).toBe(false);
    fireEvent.click(refreshButton);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    rerender(
      <HermesReaderTranslationResult
        translation={translationFixture({ cached: true })}
        preferenceBusy={false}
        refreshBusy
        canRememberPreference
        onRememberPreference={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    const busyRefreshButton = screen.getByRole("button", {
      name: "Refresh Hermes translation",
    }) as HTMLButtonElement;
    expect(busyRefreshButton.disabled).toBe(true);
    expect(busyRefreshButton.textContent).toBe("重新翻译中");
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
