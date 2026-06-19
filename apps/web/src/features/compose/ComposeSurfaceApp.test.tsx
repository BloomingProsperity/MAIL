import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "../../App";

describe("Compose surface", () => {
  afterEach(() => {
    cleanup();
  });

  it("opens new mail as a floating window without replacing the reader", () => {
    render(<App />);

    const reader = screen.getByRole("article");
    expect(within(reader).queryByLabelText("写邮件面板")).toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: "写邮件" })[0]);

    const composeWindow = screen.getByRole("dialog", { name: "写邮件窗口" });
    expect(composeWindow.className).toContain("compose-surface-floating");
    expect(within(composeWindow).getByLabelText("写邮件面板")).toBeTruthy();
    expect(within(composeWindow).queryByText(/account_1/)).toBeNull();
    expect(within(reader).queryByLabelText("写邮件面板")).toBeNull();
    expect(within(reader).getByText("优先级")).toBeTruthy();

    fireEvent.keyDown(composeWindow, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "写邮件窗口" })).toBeNull();
  });
});
