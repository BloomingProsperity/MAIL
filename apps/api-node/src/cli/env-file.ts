import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type CliEnv = Record<string, string | undefined>;

export interface LoadCliEnvFileOptions {
  env: CliEnv;
  projectRoot: string;
  fileExists?: (path: string) => boolean;
  readEnvFile?: (path: string) => string | undefined;
}

export function loadCliEnvFile(options: LoadCliEnvFileOptions): {
  envFile: string;
  runtimeEnv: CliEnv;
} {
  const fileExists = options.fileExists ?? existsSync;
  const readEnvFile = options.readEnvFile ?? readCliEnvFile;
  const configuredEnvFile = options.env.EMAILHUB_ENV_FILE ?? ".env";
  const envFile = fileExists(resolve(options.projectRoot, configuredEnvFile))
    ? configuredEnvFile
    : ".env.example";
  return {
    envFile,
    runtimeEnv: {
      ...parseEnvFile(readEnvFile(resolve(options.projectRoot, envFile)) ?? ""),
      ...options.env,
    },
  };
}

function readCliEnvFile(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function parseEnvFile(content: string): CliEnv {
  const parsed: CliEnv = {};
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(
      line,
    );
    if (!match) {
      continue;
    }
    parsed[match[1]] = parseEnvValue(match[2] ?? "");
  }
  return parsed;
}

function parseEnvValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    const unquoted = trimmed.slice(1, -1);
    return trimmed.startsWith('"')
      ? unquoted
          .replace(/\\n/g, "\n")
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, "\\")
      : unquoted;
  }

  return trimmed.replace(/\s+#.*$/, "").trim();
}
