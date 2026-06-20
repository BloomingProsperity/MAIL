import { describe, expect, it } from "vitest";

import {
  defaultMailSearchScopes,
  mailSearchScopeOptions,
  normalizeMailSearchScopes,
  toggleMailSearchScope,
} from "./searchScopeSelection";

describe("search scope selection", () => {
  it("exposes all user-selectable message search scopes", () => {
    expect(mailSearchScopeOptions.map((option) => option.scope)).toEqual([
      "sender",
      "recipients",
      "subject",
      "body",
    ]);
  });

  it("normalizes empty or duplicate scopes to a stable request shape", () => {
    expect(normalizeMailSearchScopes(undefined)).toEqual(defaultMailSearchScopes());
    expect(normalizeMailSearchScopes([])).toEqual(defaultMailSearchScopes());
    expect(normalizeMailSearchScopes(["sender", "sender", "body"])).toEqual([
      "sender",
      "body",
    ]);
  });

  it("keeps at least one selected search scope", () => {
    expect(toggleMailSearchScope(["sender"], "sender")).toEqual(["sender"]);
    expect(toggleMailSearchScope(["sender", "body"], "sender")).toEqual(["body"]);
    expect(toggleMailSearchScope(["sender"], "subject")).toEqual([
      "sender",
      "subject",
    ]);
  });
});
