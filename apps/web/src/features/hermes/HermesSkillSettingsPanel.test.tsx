import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HermesSkillSettingsPanel } from "./HermesSkillSettingsPanel";

describe("HermesSkillSettingsPanel", () => {
  it("filters skills by mode and unsaved edits", () => {
    render(<HermesSkillSettingsPanel />);

    expect(screen.getByText("翻译邮件")).toBeTruthy();
    expect(screen.getByText("生成回复草稿")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Show Hermes skill mode draft" }),
    );
    expect(screen.getByText("生成回复草稿")).toBeTruthy();
    expect(screen.queryByText("翻译邮件")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Show Hermes skill mode all" }),
    );
    const translateCard = screen
      .getByText("翻译邮件")
      .closest("article") as HTMLElement;
    fireEvent.click(
      within(translateCard).getByLabelText("Enable Hermes skill 翻译邮件"),
    );
    expect(within(translateCard).getByText(/未保存/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText("仅看未保存"));
    expect(screen.getByText("翻译邮件")).toBeTruthy();
    expect(screen.queryByText("线程总结")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Reset Hermes skill settings 翻译邮件",
      }),
    );
    expect(screen.getByText("没有匹配的 Hermes 能力。")).toBeTruthy();
  });
});
