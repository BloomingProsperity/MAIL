import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("EmailHubRoot layout", () => {
  it("keeps the auth home scrollable while the app body owns overflow", () => {
    const styles = readSource("styles.css");
    const authStyles = readSource("EmailHubRoot.css");
    const bodyBlock = readCssBlock(styles, "body");
    const authHomeBlock = readCssBlock(authStyles, ".auth-home");

    expect(bodyBlock).toContain("overflow: hidden");
    expect(authHomeBlock).toContain("height: 100vh");
    expect(authHomeBlock).toContain("height: 100dvh");
    expect(authHomeBlock).toContain("min-height: 0");
    expect(authHomeBlock).toContain("overflow-y: auto");
  });

  it("keeps the login panel visible before the product preview can dominate scrolling", () => {
    const authStyles = readSource("EmailHubRoot.css");
    const rootSource = readSource("EmailHubRoot.tsx");
    const authPanelBlock = readCssBlock(authStyles, ".auth-panel");
    const authHeroBlock = readCssBlock(authStyles, ".auth-hero");
    const narrowPanelBlock = readNestedCssBlock(
      authStyles,
      "@media (max-width: 1180px)",
      ".auth-panel",
    );

    expect(rootSource.indexOf("<AuthPanel")).toBeLessThan(
      rootSource.indexOf('<section className="auth-hero"'),
    );
    expect(authPanelBlock).toContain("position: sticky");
    expect(authPanelBlock).toContain("grid-column: 2");
    expect(authPanelBlock).toContain("max-height: calc(100dvh - 44px)");
    expect(authHeroBlock).toContain("grid-column: 1");
    expect(narrowPanelBlock).toContain("position: relative");
    expect(narrowPanelBlock).toContain("grid-column: 1");
  });
});

function readSource(file: string): string {
  return readFileSync(resolve(import.meta.dirname, file), "utf8");
}

function readCssBlock(source: string, selector: string): string {
  const match = new RegExp(
    `${escapeRegExp(selector)}\\s*\\{(?<body>[^}]*)\\}`,
    "m",
  ).exec(source);
  return match?.groups?.body ?? "";
}

function readNestedCssBlock(
  source: string,
  parentSelector: string,
  childSelector: string,
): string {
  const parentStart = source.indexOf(parentSelector);
  if (parentStart < 0) {
    return "";
  }

  const childStart = source.indexOf(childSelector, parentStart);
  if (childStart < 0) {
    return "";
  }

  return readCssBlock(source.slice(childStart), childSelector);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
