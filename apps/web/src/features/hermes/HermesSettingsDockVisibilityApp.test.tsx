import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "../../App";

describe("Hermes settings page", () => {
  it("does not render the global Hermes dock over runtime settings", async () => {
    render(<App />);

    fireEvent.click(
      within(screen.getByRole("navigation")).getByRole("button", {
        name: "Hermes",
      }),
    );

    expect(await screen.findByLabelText("Hermes 配置")).toBeTruthy();
    expect(screen.queryByLabelText("Hermes 底部输入")).toBeNull();
  });
});
