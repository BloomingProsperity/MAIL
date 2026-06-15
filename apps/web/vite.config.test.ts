import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("vite development proxy", () => {
  it("forwards API routes to the local backend during development", async () => {
    const source = await readFile(join(process.cwd(), "vite.config.ts"), "utf8");

    expect(source).toContain('"/api"');
    expect(source).toContain('"/health"');
    expect(source).toContain('"http://127.0.0.1:8080"');
    expect(source).toContain("changeOrigin: true");
  });
});
