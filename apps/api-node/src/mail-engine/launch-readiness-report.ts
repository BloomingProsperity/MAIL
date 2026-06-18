import {
  verifyEmailEngineProductionEnv,
  type PreflightCheck,
  type PreflightIssue,
} from "./production-env-preflight.js";

export interface EmailEngineLaunchReadinessReportOptions {
  env: Record<string, string | undefined>;
  envFile?: string;
  now?: () => Date;
}

export interface EmailEngineLaunchReadinessReport {
  ok: boolean;
  internalTestReady: boolean;
  productionReady: boolean;
  gate: "emailengine_launch_readiness";
  envFile?: string;
  checkedAt: string;
  checks: {
    internalSecrets: PreflightCheck;
    nativeEngine: PreflightCheck;
    smokeConfig: PreflightCheck;
    optionalIntegrations: PreflightCheck;
    productionDelta: PreflightCheck;
  };
  runnableSuites: ReadinessSuite[];
  requiredFollowUps: string[];
  productionFollowUps: string[];
}

export interface ReadinessSuite {
  name: string;
  command: string;
  status: "ready" | "blocked" | "optional";
  detail: string;
}

interface RequiredInternalSecret {
  name: string;
  detail: string;
}

const REQUIRED_INTERNAL_SECRETS: RequiredInternalSecret[] = [
  {
    name: "EMAILHUB_API_TOKEN",
    detail:
      "Lets diagnostics-backed smoke checks read protected launch evidence.",
  },
  {
    name: "EMAILENGINE_ACCESS_TOKEN",
    detail: "Lets the API and worker call EmailEngine during internal testing.",
  },
  {
    name: "EENGINE_PREPARED_TOKEN",
    detail: "Lets the EmailEngine Docker container import the launch token.",
  },
  {
    name: "EMAILENGINE_WEBHOOK_SECRET",
    detail: "Lets the API verify signed EmailEngine webhook smoke events.",
  },
  {
    name: "EENGINE_SECRET",
    detail: "Lets EmailEngine protect service settings inside Docker.",
  },
];

const SMOKE_PORT_ENV = [
  "EMAILHUB_SMOKE_IMAP_PORT",
  "EMAILHUB_SMOKE_SMTP_PORT",
  "EMAILHUB_SMOKE_DELIVERY_SMTP_PORT",
  "EMAILHUB_AUTH_SMOKE_IMAP_PORT",
  "EMAILHUB_AUTH_SMOKE_SMTP_PORT",
];

export function createEmailEngineLaunchReadinessReport(
  options: EmailEngineLaunchReadinessReportOptions,
): EmailEngineLaunchReadinessReport {
  const checkedAt = (options.now ?? (() => new Date()))().toISOString();
  const internalSecrets = checkRequiredInternalSecrets(options.env);
  const nativeEngine = checkNativeEnginePaused(options.env);
  const smokeConfig = checkSmokeConfig(options.env);
  const optionalIntegrations = checkOptionalIntegrations(options.env);
  const production = verifyEmailEngineProductionEnv({
    env: options.env,
    envFile: options.envFile,
    now: () => new Date(checkedAt),
  });
  const productionDelta = productionDeltaCheck(production.requiredFollowUps);
  const internalTestReady =
    internalSecrets.ok && nativeEngine.ok && smokeConfig.ok;
  const requiredFollowUps = [
    ...internalSecrets.issues,
    ...nativeEngine.issues,
    ...smokeConfig.issues,
  ]
    .filter((issue) => issue.severity === "error")
    .map((issue) => issue.detail);

  return {
    ok: internalTestReady,
    internalTestReady,
    productionReady: production.ok,
    gate: "emailengine_launch_readiness",
    ...(options.envFile ? { envFile: options.envFile } : {}),
    checkedAt,
    checks: {
      internalSecrets,
      nativeEngine,
      smokeConfig,
      optionalIntegrations,
      productionDelta,
    },
    runnableSuites: readinessSuites({
      internalTestReady,
      productionReady: production.ok,
      hermesReady: hasValue(options.env.HERMES_CHAT_COMPLETIONS_URL),
      gmailReady:
        hasValue(options.env.GOOGLE_OAUTH_CLIENT_ID) &&
        hasValue(options.env.GOOGLE_OAUTH_CLIENT_SECRET) &&
        hasValue(options.env.EMAILENGINE_GMAIL_OAUTH2_PROVIDER_ID),
      outlookReady:
        hasValue(options.env.MICROSOFT_OAUTH_CLIENT_ID) &&
        hasValue(options.env.MICROSOFT_OAUTH_CLIENT_SECRET) &&
        hasValue(options.env.EMAILENGINE_OUTLOOK_OAUTH2_PROVIDER_ID),
      strictDbReady: hasValue(options.env.TEST_DATABASE_URL),
    }),
    requiredFollowUps,
    productionFollowUps: production.requiredFollowUps,
  };
}

function checkRequiredInternalSecrets(
  env: Record<string, string | undefined>,
): PreflightCheck {
  const issues: PreflightIssue[] = REQUIRED_INTERNAL_SECRETS.flatMap((secret) => {
    if (hasValue(env[secret.name])) {
      return [];
    }

    return [
      {
        code: `${secret.name.toLowerCase()}_missing`,
        severity: "error",
        env: [secret.name],
        detail: `${secret.name} must be set before the EmailEngine internal test gate. ${secret.detail}`,
      },
    ];
  });

  const accessToken = env.EMAILENGINE_ACCESS_TOKEN?.trim();
  const preparedToken = env.EENGINE_PREPARED_TOKEN?.trim();
  if (accessToken && preparedToken && accessToken === preparedToken) {
    issues.push({
      code: "eengine_prepared_token_equals_raw_token",
      severity: "error",
      env: ["EMAILENGINE_ACCESS_TOKEN", "EENGINE_PREPARED_TOKEN"],
      detail:
        "EENGINE_PREPARED_TOKEN must be the exported prepared token string, not the raw EmailEngine API token itself.",
    });
  }

  return {
    ok: !issues.some((issue) => issue.severity === "error"),
    issues,
  };
}

function checkNativeEnginePaused(
  env: Record<string, string | undefined>,
): PreflightCheck {
  if (env.EMAILHUB_NATIVE_ENGINE_ENABLED?.trim().toLowerCase() !== "true") {
    return { ok: true, issues: [] };
  }

  return {
    ok: false,
    issues: [
      {
        code: "native_engine_enabled",
        severity: "error",
        env: ["EMAILHUB_NATIVE_ENGINE_ENABLED"],
        detail:
          "EMAILHUB_NATIVE_ENGINE_ENABLED must stay false for EmailEngine-first internal testing; Native Engine is paused.",
      },
    ],
  };
}

function checkSmokeConfig(
  env: Record<string, string | undefined>,
): PreflightCheck {
  const issues: PreflightIssue[] = [];

  for (const name of SMOKE_PORT_ENV) {
    const value = env[name]?.trim();
    if (!value) {
      continue;
    }
    const port = Number(value);
    if (!Number.isInteger(port) || port <= 0) {
      issues.push({
        code: `${name.toLowerCase()}_invalid`,
        severity: "error",
        env: [name],
        detail: `${name} must be a positive integer for GreenMail smoke checks.`,
      });
    }
  }

  if (!hasValue(env.TEST_DATABASE_URL)) {
    issues.push({
      code: "test_database_url_missing",
      severity: "warning",
      env: ["TEST_DATABASE_URL"],
      detail:
        "TEST_DATABASE_URL is not set; strict Postgres stress can be skipped for a quick internal UI smoke, but not for full launch readiness.",
    });
  }

  return {
    ok: !issues.some((issue) => issue.severity === "error"),
    issues,
  };
}

function checkOptionalIntegrations(
  env: Record<string, string | undefined>,
): PreflightCheck {
  const issues: PreflightIssue[] = [];

  if (!hasValue(env.HERMES_CHAT_COMPLETIONS_URL)) {
    issues.push({
      code: "hermes_runtime_not_env_configured",
      severity: "warning",
      env: ["HERMES_CHAT_COMPLETIONS_URL", "HERMES_MODEL", "HERMES_API_KEY"],
      detail:
        "Hermes can still be configured from the sidebar Hermes workspace, but real Hermes AI skills are not env-ready yet.",
    });
  }
  if (
    !hasValue(env.GOOGLE_OAUTH_CLIENT_ID) ||
    !hasValue(env.GOOGLE_OAUTH_CLIENT_SECRET) ||
    !hasValue(env.EMAILENGINE_GMAIL_OAUTH2_PROVIDER_ID)
  ) {
    issues.push({
      code: "gmail_oauth_not_configured",
      severity: "warning",
      env: [
        "GOOGLE_OAUTH_CLIENT_ID",
        "GOOGLE_OAUTH_CLIENT_SECRET",
        "EMAILENGINE_GMAIL_OAUTH2_PROVIDER_ID",
      ],
      detail:
        "Gmail OAuth onboarding is not ready for internal test until Google OAuth credentials and the EmailEngine OAuth2 app id are configured.",
    });
  }
  if (
    !hasValue(env.MICROSOFT_OAUTH_CLIENT_ID) ||
    !hasValue(env.MICROSOFT_OAUTH_CLIENT_SECRET) ||
    !hasValue(env.EMAILENGINE_OUTLOOK_OAUTH2_PROVIDER_ID)
  ) {
    issues.push({
      code: "outlook_oauth_not_configured",
      severity: "warning",
      env: [
        "MICROSOFT_OAUTH_CLIENT_ID",
        "MICROSOFT_OAUTH_CLIENT_SECRET",
        "EMAILENGINE_OUTLOOK_OAUTH2_PROVIDER_ID",
      ],
      detail:
        "Outlook OAuth onboarding is not ready for internal test until Microsoft OAuth credentials and the EmailEngine OAuth2 app id are configured.",
    });
  }

  return { ok: true, issues };
}

function productionDeltaCheck(followUps: string[]): PreflightCheck {
  return {
    ok: followUps.length === 0,
    issues: followUps.map((detail) => ({
      code: "production_gate_follow_up",
      severity: "warning",
      env: [],
      detail,
    })),
  };
}

function readinessSuites(input: {
  internalTestReady: boolean;
  productionReady: boolean;
  hermesReady: boolean;
  gmailReady: boolean;
  outlookReady: boolean;
  strictDbReady: boolean;
}): ReadinessSuite[] {
  return [
    {
      name: "compose_config",
      command: "npm run compose:config:prod",
      status: "ready",
      detail: "Validates the production Docker compose overlay without starting services.",
    },
    {
      name: "docker_internal_stack",
      command: "npm run compose:up:detached",
      status: input.internalTestReady ? "ready" : "blocked",
      detail: input.internalTestReady
        ? "Can start the EmailEngine-first self-hosted stack for internal testing."
        : "Fix required internal env follow-ups before starting the stack.",
    },
    {
      name: "docker_greenmail_stack",
      command: "npm run compose:up:test:detached",
      status: input.internalTestReady ? "ready" : "blocked",
      detail: input.internalTestReady
        ? "Can start the EmailEngine-first stack with GreenMail test services."
        : "Fix required internal env follow-ups before starting GreenMail smokes.",
    },
    {
      name: "greenmail_smokes",
      command: "npm run verify:emailengine-launch:greenmail",
      status: input.internalTestReady ? "ready" : "blocked",
      detail:
        "Exercises IMAP/SMTP onboarding, real webhook, send, attachment download, and mail action through GreenMail.",
    },
    {
      name: "strict_postgres_stress",
      command: "npm run verify:emailengine-launch:strict-db",
      status: input.strictDbReady ? "ready" : "optional",
      detail: input.strictDbReady
        ? "TEST_DATABASE_URL is set for strict Postgres stress."
        : "Set TEST_DATABASE_URL before claiming full launch-grade stress coverage.",
    },
    {
      name: "hermes_real_ai",
      command: "Configure Hermes from the sidebar Hermes workspace, then exercise search, translate, summary, and compose skills.",
      status: input.hermesReady ? "ready" : "optional",
      detail: input.hermesReady
        ? "Hermes env runtime is configured."
        : "Hermes runtime can be set from the sidebar Hermes workspace; env-level Hermes is not configured.",
    },
    {
      name: "gmail_oauth",
      command: "Exercise Gmail OAuth onboarding after Google OAuth env is configured.",
      status: input.gmailReady ? "ready" : "optional",
      detail: input.gmailReady
        ? "Google OAuth credentials and EmailEngine OAuth2 app id are configured."
        : "Gmail OAuth should be skipped until credentials and the EmailEngine OAuth2 app id are configured.",
    },
    {
      name: "outlook_oauth",
      command: "Exercise Outlook OAuth onboarding after Microsoft OAuth env is configured.",
      status: input.outlookReady ? "ready" : "optional",
      detail: input.outlookReady
        ? "Microsoft OAuth credentials and EmailEngine OAuth2 app id are configured."
        : "Outlook OAuth should be skipped until credentials and the EmailEngine OAuth2 app id are configured.",
    },
    {
      name: "production_launch_gate",
      command: "npm run verify:emailengine-launch",
      status: input.productionReady ? "ready" : "blocked",
      detail: input.productionReady
        ? "Production env preflight is ready for the full launch gate."
        : "Production env preflight still has required follow-ups.",
    },
  ];
}

function hasValue(value: string | undefined): boolean {
  return Boolean(value?.trim());
}
