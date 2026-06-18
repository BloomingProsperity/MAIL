export interface EmailEngineProductionEnvPreflightOptions {
  env: Record<string, string | undefined>;
  envFile?: string;
  now?: () => Date;
}

export interface EmailEngineProductionEnvPreflightResult {
  ok: boolean;
  gate: "emailengine_prod_env";
  envFile?: string;
  checkedAt: string;
  checks: {
    requiredSecrets: PreflightCheck;
    containerImage: PreflightCheck;
    webApiToken: PreflightCheck;
    nativeEngine: PreflightCheck;
    optionalIntegrations: PreflightCheck;
  };
  requiredFollowUps: string[];
}

export interface PreflightCheck {
  ok: boolean;
  issues: PreflightIssue[];
}

export interface PreflightIssue {
  code: string;
  severity: "error" | "warning";
  env: string[];
  detail: string;
}

interface RequiredSecret {
  name: string;
  defaultValue?: string;
  detail: string;
}

const REQUIRED_PRODUCTION_SECRETS: RequiredSecret[] = [
  {
    name: "EMAILHUB_API_TOKEN",
    defaultValue: "dev-emailhub-token",
    detail: "Protects production /api routes and host health probes.",
  },
  {
    name: "EMAILENGINE_ACCESS_TOKEN",
    detail: "Lets the API and worker call EmailEngine token-backed routes.",
  },
  {
    name: "EENGINE_PREPARED_TOKEN",
    detail: "Lets the EmailEngine container import its access token on startup.",
  },
  {
    name: "EMAILENGINE_WEBHOOK_SECRET",
    defaultValue: "dev-emailhub-secret",
    detail: "Verifies EmailEngine webhook signatures.",
  },
  {
    name: "EMAILENGINE_AUTH_SERVER_SECRET",
    defaultValue: "dev-emailhub-secret",
    detail: "Protects the EmailEngine OAuth auth-server callback.",
  },
  {
    name: "EENGINE_SECRET",
    defaultValue: "dev-emailhub-secret",
    detail: "Protects EmailEngine service settings.",
  },
];

export function verifyEmailEngineProductionEnv(
  options: EmailEngineProductionEnvPreflightOptions,
): EmailEngineProductionEnvPreflightResult {
  const checkedAt = (options.now ?? (() => new Date()))().toISOString();
  const requiredSecrets = checkRequiredProductionSecrets(options.env);
  const containerImage = checkEmailEngineImage(options.env);
  const webApiToken = checkWebApiTokenCompatibility(options.env);
  const nativeEngine = checkNativeEnginePaused(options.env);
  const optionalIntegrations = checkOptionalIntegrations(options.env);
  const requiredFollowUps = [
    ...requiredSecrets.issues,
    ...containerImage.issues,
    ...webApiToken.issues,
    ...nativeEngine.issues,
  ]
    .filter((issue) => issue.severity === "error")
    .map((issue) => issue.detail);

  return {
    ok: requiredSecrets.ok && containerImage.ok && webApiToken.ok && nativeEngine.ok,
    gate: "emailengine_prod_env",
    ...(options.envFile ? { envFile: options.envFile } : {}),
    checkedAt,
    checks: {
      requiredSecrets,
      containerImage,
      webApiToken,
      nativeEngine,
      optionalIntegrations,
    },
    requiredFollowUps,
  };
}

function checkRequiredProductionSecrets(
  env: Record<string, string | undefined>,
): PreflightCheck {
  const issues = [
    ...REQUIRED_PRODUCTION_SECRETS.flatMap((secret) =>
      productionSecretIssues(env, secret),
    ),
    ...emailEngineTokenPairIssues(env),
    ...bundledPostgresPasswordIssues(env),
  ];

  return {
    ok: !issues.some((issue) => issue.severity === "error"),
    issues,
  };
}

function productionSecretIssues(
  env: Record<string, string | undefined>,
  secret: RequiredSecret,
): PreflightIssue[] {
  const value = env[secret.name]?.trim();
  if (!value) {
    return [
      {
        code: `${secret.name.toLowerCase()}_missing`,
        severity: "error",
        env: [secret.name],
        detail: `${secret.name} must be set before the EmailEngine production launch gate. ${secret.detail}`,
      },
    ];
  }

  if (secret.defaultValue && value === secret.defaultValue) {
    return [
      {
        code: `${secret.name.toLowerCase()}_uses_default`,
        severity: "error",
        env: [secret.name],
        detail: `${secret.name} must not use the development default before the EmailEngine production launch gate. ${secret.detail}`,
      },
    ];
  }

  return [];
}

function checkEmailEngineImage(
  env: Record<string, string | undefined>,
): PreflightCheck {
  const image = env.EMAILENGINE_IMAGE?.trim();
  if (!image) {
    return { ok: true, issues: [] };
  }

  const tag = readDockerImageTag(image);
  const issues: PreflightIssue[] = [];

  if (tag?.toLowerCase() === "latest") {
    issues.push({
      code: "emailengine_image_uses_latest",
      severity: "error",
      env: ["EMAILENGINE_IMAGE"],
      detail:
        "EMAILENGINE_IMAGE must not use the mutable latest tag before the EmailEngine production launch gate. Use the default pinned image, a v2.x.x image tag, or an immutable sha256 digest.",
    });
  } else if (!isPinnedEmailEngineImage(image, tag)) {
    issues.push({
      code: "emailengine_image_not_pinned",
      severity: "error",
      env: ["EMAILENGINE_IMAGE"],
      detail:
        "EMAILENGINE_IMAGE must be omitted for the default pinned image, set to a v2.x.x image tag, or set to an immutable sha256 digest before the EmailEngine production launch gate.",
    });
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

function isPinnedEmailEngineImage(
  image: string,
  tag: string | undefined,
): boolean {
  return (
    /@sha256:[a-f0-9]{64}$/i.test(image) ||
    (tag !== undefined && /^v2\.\d+\.\d+$/i.test(tag))
  );
}

function readDockerImageTag(image: string): string | undefined {
  const withoutDigest = image.split("@", 1)[0] ?? image;
  const lastSlashIndex = withoutDigest.lastIndexOf("/");
  const lastColonIndex = withoutDigest.lastIndexOf(":");

  if (lastColonIndex <= lastSlashIndex) {
    return undefined;
  }

  return withoutDigest.slice(lastColonIndex + 1);
}

function emailEngineTokenPairIssues(
  env: Record<string, string | undefined>,
): PreflightIssue[] {
  const accessToken = env.EMAILENGINE_ACCESS_TOKEN?.trim();
  const preparedToken = env.EENGINE_PREPARED_TOKEN?.trim();
  const issues: PreflightIssue[] = [];

  if (accessToken && !/^[a-f0-9]{64}$/i.test(accessToken)) {
    issues.push({
      code: "emailengine_access_token_format_invalid",
      severity: "error",
      env: ["EMAILENGINE_ACCESS_TOKEN"],
      detail:
        "EMAILENGINE_ACCESS_TOKEN must be the original 64-character EmailEngine API token. Generate it with `emailengine tokens issue` before the production launch gate.",
    });
  }

  if (accessToken && preparedToken && accessToken === preparedToken) {
    issues.push({
      code: "eengine_prepared_token_equals_raw_token",
      severity: "error",
      env: ["EMAILENGINE_ACCESS_TOKEN", "EENGINE_PREPARED_TOKEN"],
      detail:
        "EENGINE_PREPARED_TOKEN must be the exported prepared token string for EMAILENGINE_ACCESS_TOKEN, not the raw API token itself. Generate it with `emailengine tokens export -t EMAILENGINE_ACCESS_TOKEN`.",
    });
  }

  return issues;
}

function bundledPostgresPasswordIssues(
  env: Record<string, string | undefined>,
): PreflightIssue[] {
  if (env.DATABASE_URL?.trim()) {
    return [];
  }

  return productionSecretIssues(env, {
    name: "POSTGRES_PASSWORD",
    defaultValue: "emailhub_dev",
    detail:
      "Avoids the local development database password when Docker compose uses bundled Postgres.",
  });
}

function checkWebApiTokenCompatibility(
  env: Record<string, string | undefined>,
): PreflightCheck {
  const apiToken = env.EMAILHUB_API_TOKEN?.trim();
  const webToken = env.VITE_EMAILHUB_API_TOKEN?.trim();
  if (apiToken && webToken && apiToken !== webToken) {
    return {
      ok: false,
      issues: [
        {
          code: "vite_emailhub_api_token_mismatch",
          severity: "error",
          env: ["EMAILHUB_API_TOKEN", "VITE_EMAILHUB_API_TOKEN"],
          detail:
            "VITE_EMAILHUB_API_TOKEN must match EMAILHUB_API_TOKEN for the bundled protected web app.",
        },
      ],
    };
  }

  return { ok: true, issues: [] };
}

function checkNativeEnginePaused(
  env: Record<string, string | undefined>,
): PreflightCheck {
  const nativeEngineEnabled =
    env.EMAILHUB_NATIVE_ENGINE_ENABLED?.trim().toLowerCase() === "true";
  if (!nativeEngineEnabled) {
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
          "EMAILHUB_NATIVE_ENGINE_ENABLED must stay false for the EmailEngine-first production launch; the self-built Native Engine is paused.",
      },
    ],
  };
}

function checkOptionalIntegrations(
  env: Record<string, string | undefined>,
): PreflightCheck {
  const issues: PreflightIssue[] = [];

  if (!env.HERMES_CHAT_COMPLETIONS_URL?.trim()) {
    issues.push({
      code: "hermes_runtime_env_not_set",
      severity: "warning",
      env: ["HERMES_CHAT_COMPLETIONS_URL", "HERMES_MODEL", "HERMES_API_KEY"],
      detail:
        "Hermes runtime can be configured from Settings, but no env-level Hermes endpoint is set.",
    });
  }

  if (
    !env.GOOGLE_OAUTH_CLIENT_ID?.trim() ||
    !env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() ||
    !env.EMAILENGINE_GMAIL_OAUTH2_PROVIDER_ID?.trim()
  ) {
    issues.push({
      code: "gmail_oauth_not_set",
      severity: "warning",
      env: [
        "GOOGLE_OAUTH_CLIENT_ID",
        "GOOGLE_OAUTH_CLIENT_SECRET",
        "EMAILENGINE_GMAIL_OAUTH2_PROVIDER_ID",
      ],
      detail:
        "Gmail OAuth onboarding will stay unavailable until Google OAuth credentials and the EmailEngine OAuth2 app id are set.",
    });
  }

  if (
    !env.MICROSOFT_OAUTH_CLIENT_ID?.trim() ||
    !env.MICROSOFT_OAUTH_CLIENT_SECRET?.trim() ||
    !env.EMAILENGINE_OUTLOOK_OAUTH2_PROVIDER_ID?.trim()
  ) {
    issues.push({
      code: "outlook_oauth_not_set",
      severity: "warning",
      env: [
        "MICROSOFT_OAUTH_CLIENT_ID",
        "MICROSOFT_OAUTH_CLIENT_SECRET",
        "EMAILENGINE_OUTLOOK_OAUTH2_PROVIDER_ID",
      ],
      detail:
        "Outlook OAuth onboarding will stay unavailable until Microsoft OAuth credentials and the EmailEngine OAuth2 app id are set.",
    });
  }

  return { ok: true, issues };
}
