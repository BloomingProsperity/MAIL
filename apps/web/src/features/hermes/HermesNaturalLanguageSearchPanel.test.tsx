import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HermesNaturalLanguageSearchPanel } from "./HermesNaturalLanguageSearchPanel";

afterEach(() => {
  cleanup();
});

describe("HermesNaturalLanguageSearchPanel", () => {
  it("routes natural-language query changes and submits to Hermes", () => {
    const onQueryChange = vi.fn();
    const onSubmit = vi.fn();

    render(
      <HermesNaturalLanguageSearchPanel
        query="合同在哪里"
        busy={false}
        onQueryChange={onQueryChange}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText("Hermes 搜索问题"), {
      target: { value: "客户上次提到的合同在哪里？" },
    });
    fireEvent.submit(
      screen.getByRole("form", { name: "Hermes 自然语言搜索" }),
    );

    expect(onQueryChange).toHaveBeenCalledWith(
      "客户上次提到的合同在哪里？",
    );
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("disables the submit action while Hermes is searching", () => {
    render(
      <HermesNaturalLanguageSearchPanel
        query="发票"
        busy
        onQueryChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", {
      name: "Hermes 搜索中",
    }) as HTMLButtonElement;

    expect(button.disabled).toBe(true);
  });
});
