import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "../../App";

describe("Mail reader priority copy", () => {
  it("does not show smart-priority reason cards or chips in ordinary mail UI", () => {
    render(<App />);

    expect(within(screen.getByRole("article")).queryByText("优先级")).toBeNull();
    expect(screen.queryByText("直接发给你")).toBeNull();
  });
});
