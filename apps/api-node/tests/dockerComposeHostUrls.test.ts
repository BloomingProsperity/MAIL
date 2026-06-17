import { describe, expect, it } from "vitest";

import {
  parseDockerComposeHostBind,
  resolveDockerComposeHostBaseUrl,
} from "../src/mail-engine/docker-compose-host-urls";

describe("Docker compose host URL helpers", () => {
  it("prefers explicit host base URLs and redacts userinfo/query fragments", () => {
    expect(
      resolveDockerComposeHostBaseUrl({
        explicitBaseUrl: "http://user:secret@127.0.0.1:8080/?token=abc#frag",
        bind: "127.0.0.1:18080",
        fallback: "http://127.0.0.1:8080",
      }),
    ).toBe("http://127.0.0.1:8080");
  });

  it("rejects invalid explicit host base URLs instead of falling back", () => {
    expect(() =>
      resolveDockerComposeHostBaseUrl({
        explicitBaseUrl: "not-a-url",
        explicitName: "EMAILHUB_API_BASE_URL",
        bind: "127.0.0.1:18080",
        fallback: "http://127.0.0.1:8080",
      }),
    ).toThrow("EMAILHUB_API_BASE_URL must be a valid http(s) URL.");
    expect(() =>
      resolveDockerComposeHostBaseUrl({
        explicitBaseUrl: "ftp://127.0.0.1:8080",
        explicitName: "EMAILHUB_API_BASE_URL",
        bind: "127.0.0.1:18080",
        fallback: "http://127.0.0.1:8080",
      }),
    ).toThrow("EMAILHUB_API_BASE_URL must be a valid http(s) URL.");
  });

  it("derives local probe URLs from compose bind overrides", () => {
    expect(
      resolveDockerComposeHostBaseUrl({
        bind: "127.0.0.1:5174",
        fallback: "http://127.0.0.1:5173",
      }),
    ).toBe("http://127.0.0.1:5174");
    expect(
      resolveDockerComposeHostBaseUrl({
        bind: "18080",
        fallback: "http://127.0.0.1:8080",
      }),
    ).toBe("http://127.0.0.1:18080");
  });

  it("uses loopback for wildcard host binds", () => {
    expect(parseDockerComposeHostBind("0.0.0.0:5173")).toEqual({
      host: "127.0.0.1",
      port: 5173,
    });
    expect(parseDockerComposeHostBind("[::]:5173")).toEqual({
      host: "127.0.0.1",
      port: 5173,
    });
  });

  it("falls back when bind syntax cannot identify one host port", () => {
    expect(
      resolveDockerComposeHostBaseUrl({
        bind: "not-a-bind",
        fallback: "http://127.0.0.1:5173/",
      }),
    ).toBe("http://127.0.0.1:5173");
    expect(parseDockerComposeHostBind("2001:db8::1:5173")).toBeUndefined();
  });
});
