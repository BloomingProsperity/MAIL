import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SearchSavedViewFilter } from "./SearchSavedViewFilter";

describe("SearchSavedViewFilter", () => {
  it("selects and clears virtual folder filters without exposing provider folders", () => {
    const onSelectSavedView = vi.fn();

    render(
      <SearchSavedViewFilter
        categories={[
          { id: "codes", label: "验证码", count: 4 },
          { id: "receipts", label: "账单/收据", count: 2 },
        ]}
        selectedSavedView="codes"
        onSelectSavedView={onSelectSavedView}
      />,
    );

    const codesButton = screen.getByRole("button", {
      name: "Search saved view 验证码",
    });

    expect(screen.getByLabelText("常用分类搜索筛选")).toBeTruthy();
    expect(codesButton.textContent).toContain("验证码 4");

    fireEvent.click(codesButton);
    expect(onSelectSavedView).toHaveBeenLastCalledWith(undefined);

    fireEvent.click(screen.getByRole("button", { name: "Search saved view 账单/收据" }));
    expect(onSelectSavedView).toHaveBeenLastCalledWith("receipts");
  });
});
