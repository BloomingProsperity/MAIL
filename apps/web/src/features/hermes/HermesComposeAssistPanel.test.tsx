import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HERMES_QUICK_REPLY_ACTIONS,
  HermesComposeDraftTools,
  HermesReplyAssistantPanel,
} from "./HermesComposeAssistPanel";

afterEach(() => {
  cleanup();
});

describe("Hermes compose assistant panel", () => {
  it("routes compose translation, polish, and preview actions", () => {
    const onSourceLanguageChange = vi.fn();
    const onTargetLanguageChange = vi.fn();
    const onTranslate = vi.fn();
    const onPolish = vi.fn();
    const onPreview = vi.fn();

    render(
      <HermesComposeDraftTools
        sourceLanguage="auto"
        targetLanguage="English"
        busy={false}
        onSourceLanguageChange={onSourceLanguageChange}
        onTargetLanguageChange={onTargetLanguageChange}
        onTranslate={onTranslate}
        onPolish={onPolish}
        onPreview={onPreview}
      />,
    );

    fireEvent.change(
      screen.getByRole("combobox", {
        name: "Compose translation source language",
      }),
      { target: { value: "Chinese" } },
    );
    fireEvent.change(
      screen.getByRole("combobox", {
        name: "Compose translation target language",
      }),
      { target: { value: "French" } },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Translate composed draft with Hermes",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Polish composed draft with Hermes",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Preview composed draft" }));

    expect(onSourceLanguageChange).toHaveBeenCalledWith("Chinese");
    expect(onTargetLanguageChange).toHaveBeenCalledWith("French");
    expect(onTranslate).toHaveBeenCalledTimes(1);
    expect(onPolish).toHaveBeenCalledTimes(1);
    expect(onPreview).toHaveBeenCalledTimes(1);
  });

  it("disables compose assistant controls while busy", () => {
    render(
      <HermesComposeDraftTools
        sourceLanguage="auto"
        targetLanguage="English"
        busy
        onSourceLanguageChange={vi.fn()}
        onTargetLanguageChange={vi.fn()}
        onTranslate={vi.fn()}
        onPolish={vi.fn()}
        onPreview={vi.fn()}
      />,
    );

    expect(
      (
        screen.getByRole("combobox", {
          name: "Compose translation source language",
        }) as HTMLSelectElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Polish composed draft with Hermes",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", { name: "Preview composed draft" }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("prevents no-op compose translations when source and target languages match", () => {
    const onTranslate = vi.fn();
    const onPolish = vi.fn();
    const onPreview = vi.fn();

    const { rerender } = render(
      <HermesComposeDraftTools
        sourceLanguage="French"
        targetLanguage="French"
        busy={false}
        onSourceLanguageChange={vi.fn()}
        onTargetLanguageChange={vi.fn()}
        onTranslate={onTranslate}
        onPolish={onPolish}
        onPreview={onPreview}
      />,
    );

    const translateButton = screen.getByRole("button", {
      name: "Translate composed draft with Hermes",
    }) as HTMLButtonElement;
    expect(translateButton.disabled).toBe(true);
    expect(translateButton.title).toBe("源语言和目标语言相同，无需翻译");
    fireEvent.click(translateButton);
    expect(onTranslate).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Polish composed draft with Hermes",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Preview composed draft" }));
    expect(onPolish).toHaveBeenCalledTimes(1);
    expect(onPreview).toHaveBeenCalledTimes(1);

    rerender(
      <HermesComposeDraftTools
        sourceLanguage="auto"
        targetLanguage="French"
        busy={false}
        onSourceLanguageChange={vi.fn()}
        onTargetLanguageChange={vi.fn()}
        onTranslate={onTranslate}
        onPolish={onPolish}
        onPreview={onPreview}
      />,
    );

    expect(translateButton.disabled).toBe(false);
    fireEvent.click(translateButton);
    expect(onTranslate).toHaveBeenCalledTimes(1);
  });

  it("routes draft reply and quick reply selections", () => {
    const onDraftReply = vi.fn();
    const onQuickReply = vi.fn();

    render(
      <HermesReplyAssistantPanel
        fromLabel="Support <support@example.com>"
        busy={false}
        onDraftReply={onDraftReply}
        onQuickReply={onQuickReply}
      />,
    );

    expect(screen.getByText("From: Support <support@example.com>")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ask Hermes to draft reply" }));
    fireEvent.click(
      within(screen.getByLabelText("Hermes 快速回复")).getByRole("button", {
        name: "Ask Hermes quick reply thanks",
      }),
    );

    expect(onDraftReply).toHaveBeenCalledTimes(1);
    expect(onQuickReply).toHaveBeenCalledWith(
      HERMES_QUICK_REPLY_ACTIONS.find((action) => action.scenario === "thanks"),
    );
  });
});
