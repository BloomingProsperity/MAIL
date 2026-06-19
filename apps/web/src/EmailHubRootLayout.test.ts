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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
