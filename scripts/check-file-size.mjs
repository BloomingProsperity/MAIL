#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const DEFAULT_MAX_LINES = 1000;

const trackedExtensions = new Set([
  ".cjs",
  ".css",
  ".js",
  ".json",
  ".jsonc",
  ".jsx",
  ".mjs",
  ".rs",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

const generatedOrExternalFiles = new Set(["Cargo.lock", "package-lock.json"]);
const ignoredPathParts = new Set([
  ".git",
  "coverage",
  "dist",
  "node_modules",
]);

const legacyLargeFileCaps = new Map([
  ["apps/web/src/App.test.tsx", 11233],
  ["apps/web/src/App.tsx", 11077],
  ["apps/api-node/src/http/router.ts", 10027],
  ["apps/web/src/lib/emailHubApi.test.ts", 4670],
  ["apps/web/src/lib/emailHubApi.ts", 4061],
  ["apps/api-node/tests/hermesRoutes.test.ts", 3942],
  ["apps/api-node/tests/routes.test.ts", 3660],
  ["apps/web/src/styles.css", 3494],
  ["apps/api-node/tests/mailCompose.test.ts", 3223],
  ["apps/api-node/src/mail-compose/mail-compose.ts", 2644],
  ["apps/worker-node/src/mail-engine/postgres-mirror-store.ts", 2151],
  ["apps/api-node/tests/mailComposeRoutes.test.ts", 2104],
  ["apps/worker-node/tests/postgresMirrorStore.test.ts", 1847],
  ["apps/api-node/tests/nativeSendTransport.test.ts", 1656],
  ["apps/api-node/tests/postgresMailComposeStore.test.ts", 1608],
  ["ui-preview/styles.css", 1527],
  ["apps/api-node/src/hermes/rules.ts", 1477],
  ["apps/api-node/tests/emailEngineRealWebhookSmoke.test.ts", 1352],
  ["apps/api-node/src/mail-compose/postgres-mail-compose-store.ts", 1282],
  ["apps/api-node/src/mail-engine/real-roundtrip-smoke.ts", 1156],
  ["apps/api-node/tests/hermesRules.test.ts", 1121],
  ["apps/api-node/tests/emailEngineDockerHealthVerifier.test.ts", 1097],
  ["apps/api-node/tests/hermesActionPlan.test.ts", 1070],
  ["apps/api-node/src/http/router-handler.ts", 2933],
  ["apps/api-node/src/http/router-hermes-inputs.ts", 2050],
  ["apps/api-node/src/http/router-mail-parsers.ts", 1167],
  ["apps/api-node/src/http/router-account-compose-inputs.ts", 1002],
  ["apps/api-node/tests/hermesMessageRoutes.test.ts", 1304],
  ["apps/api-node/tests/mailComposeScheduled.test.ts", 1055],
  ["apps/web/src/App.compose.test.tsx", 2686],
  ["apps/web/src/App.hermes-dock-reader.test.tsx", 1816],
  ["apps/web/src/features/add-mail/AddMailAndSyncPages.tsx", 2466],
  ["apps/web/src/features/mail/MailWorkspace.tsx", 2973],
  ["apps/web/src/lib/emailHubApi.hermes.test.ts", 2712],
  ["apps/web/src/lib/emailHubApiClient.ts", 1567],
  ["apps/web/src/lib/emailHubApiTypes.ts", 2388],
  ["apps/web/src/styles-panels.css", 1434],
  ["apps/web/src/test/appTestFixtures.ts", 2507],
]);

const files = listGitFiles();
const violations = [];
let checkedCount = 0;

for (const file of files) {
  if (!isTrackedHandwrittenFile(file)) {
    continue;
  }
  if (!existsSync(file)) {
    continue;
  }

  checkedCount += 1;
  const lineCount = countLines(readFileSync(file, "utf8"));
  const legacyCap = legacyLargeFileCaps.get(file);
  const maxLines = legacyCap ?? DEFAULT_MAX_LINES;

  if (lineCount > maxLines) {
    violations.push({
      file,
      lineCount,
      maxLines,
      reason: legacyCap
        ? "legacy file grew past its documented cap"
        : "handwritten file exceeds the standard cap",
    });
  }
}

if (violations.length > 0) {
  console.error("File-size guard failed.");
  for (const violation of violations) {
    console.error(
      [
        `- ${violation.file}`,
        `${violation.lineCount} lines`,
        `limit ${violation.maxLines}`,
        violation.reason,
      ].join(" | "),
    );
  }
  console.error(
    "Split new behavior into focused modules or lower the legacy file before raising its cap.",
  );
  process.exitCode = 1;
} else {
  console.log(
    `File-size guard passed: ${checkedCount} handwritten files checked, ${legacyLargeFileCaps.size} legacy caps enforced.`,
  );
}

function listGitFiles() {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { encoding: "utf8" },
  )
    .split("\n")
    .map((file) => file.trim())
    .filter(Boolean);
}

function isTrackedHandwrittenFile(file) {
  if (generatedOrExternalFiles.has(file)) {
    return false;
  }

  const parts = file.split("/");
  if (parts.some((part) => ignoredPathParts.has(part))) {
    return false;
  }

  const extension = file.match(/(\.[^.]+)$/)?.[1];
  return extension ? trackedExtensions.has(extension) : false;
}

function countLines(content) {
  if (content.length === 0) {
    return 0;
  }

  const newlineCount = content.match(/\n/g)?.length ?? 0;
  return content.endsWith("\n") ? newlineCount : newlineCount + 1;
}
