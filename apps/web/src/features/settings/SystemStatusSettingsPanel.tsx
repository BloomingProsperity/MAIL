import { useEffect, useState } from "react";
import type {
  ApiHealthDto,
  EmailHubApi,
  MailEngineHealthDto,
  OperationalEventDto,
} from "../../lib/emailHubApi";
import "./SystemStatusSettingsPanel.css";

export function SystemStatusSettingsPanel(props: { api?: EmailHubApi }) {
  const [apiHealth, setApiHealth] = useState<ApiHealthDto | undefined>();
  const [apiHealthUnavailable, setApiHealthUnavailable] = useState(false);
  const [mailEngineHealth, setMailEngineHealth] =
    useState<MailEngineHealthDto | undefined>();
  const [mailEngineHealthUnavailable, setMailEngineHealthUnavailable] =
    useState(false);
  const [mailEngineLaunchEvents, setMailEngineLaunchEvents] = useState<
    OperationalEventDto[]
  >([]);
  const [mailEngineLaunchNotice, setMailEngineLaunchNotice] = useState("");

  useEffect(() => {
    if (!props.api) {
      setApiHealth(undefined);
      setApiHealthUnavailable(false);
      return;
    }

    let alive = true;
    props.api
      .getApiHealth()
      .then((health) => {
        if (alive) {
          setApiHealth(health);
          setApiHealthUnavailable(false);
        }
      })
      .catch(() => {
        if (alive) {
          setApiHealth(undefined);
          setApiHealthUnavailable(true);
        }
      });

    return () => {
      alive = false;
    };
  }, [props.api]);

  useEffect(() => {
    if (!props.api) {
      setMailEngineHealth(undefined);
      setMailEngineHealthUnavailable(false);
      return;
    }

    let alive = true;
    props.api
      .getMailEngineHealth()
      .then((health) => {
        if (alive) {
          setMailEngineHealth(health);
          setMailEngineHealthUnavailable(false);
        }
      })
      .catch(() => {
        if (alive) {
          setMailEngineHealth(undefined);
          setMailEngineHealthUnavailable(true);
        }
      });

    return () => {
      alive = false;
    };
  }, [props.api]);

  useEffect(() => {
    if (!props.api) {
      setMailEngineLaunchEvents([]);
      setMailEngineLaunchNotice("");
      return;
    }

    let alive = true;
    setMailEngineLaunchNotice("");
    void Promise.all([
      props.api.listOperationalEvents({
        service: "email-hub-api",
        event: "emailengine_webhook_ingested",
        lane: "sync",
        limit: 3,
      }),
      props.api.listOperationalEvents({
        service: "email-hub-worker",
        lane: "sync",
        limit: 5,
      }),
    ])
      .then(([webhookPage, workerPage]) => {
        if (!alive) {
          return;
        }
        const events = latestOperationalEvents(
          [...webhookPage.items, ...workerPage.items],
          5,
        );
        setMailEngineLaunchEvents(events);
        setMailEngineLaunchNotice(events.length > 0 ? "" : "暂无最近同步。");
      })
      .catch(() => {
        if (alive) {
          setMailEngineLaunchEvents([]);
          setMailEngineLaunchNotice("最近同步暂时不可用。");
        }
      });

    return () => {
      alive = false;
    };
  }, [props.api]);

  if (!props.api) {
    return (
      <section className="page-panel" aria-label="运行状态">
        <h2>运行状态</h2>
        <p>暂时不可用。</p>
      </section>
    );
  }

  return (
    <>
      <ApiHealthPanel health={apiHealth} unavailable={apiHealthUnavailable} />
      <MailEngineReadinessPanel
        health={mailEngineHealth}
        unavailable={mailEngineHealthUnavailable}
      />
      <MailEngineLaunchActivityPanel
        events={mailEngineLaunchEvents}
        notice={mailEngineLaunchNotice}
      />
    </>
  );
}

function ApiHealthPanel(props: { health?: ApiHealthDto; unavailable?: boolean }) {
  const degraded = props.unavailable || props.health?.ok === false;
  const databaseStatus = props.health?.checks?.database;
  return (
    <section
      className={`page-panel api-health-panel ${
        degraded ? "is-degraded" : "is-ready"
      }`}
      aria-label="运行状态"
    >
      <div>
        <strong>{degraded ? "运行需要处理" : "运行正常"}</strong>
        <span>
          {props.unavailable
            ? "暂时不可用。"
            : props.health?.ok
              ? "连接正常。"
              : "连接可用，部分项目需要处理。"}
        </span>
      </div>
      <div className="api-health-grid">
        <p>
          <strong>
            {props.health?.ok ? "可用" : props.unavailable ? "未知" : "异常"}
          </strong>
          <span>连接</span>
        </p>
        <p>
          <strong>{formatApiDatabaseHealth(databaseStatus)}</strong>
          <span>数据存储</span>
        </p>
      </div>
    </section>
  );
}

function MailEngineReadinessPanel(props: {
  health?: MailEngineHealthDto;
  unavailable?: boolean;
}) {
  const health = props.health;
  const degraded =
    props.unavailable || health?.readiness.status === "degraded";
  const statusRows = health
    ? mailEngineReadinessRows(health)
    : mailEngineUnavailableRows();
  const hasAdminDetails = Boolean(
    health &&
      (health.missing.length > 0 ||
        health.warnings.length > 0 ||
        health.readiness.setupActions.length > 0),
  );

  return (
    <section
      className={`page-panel mail-engine-readiness ${
        degraded ? "is-degraded" : "is-ready"
      }`}
      aria-label="邮箱接入状态"
    >
      <div>
        <strong>
          {props.unavailable
            ? "邮箱接入暂时不可用"
            : degraded
              ? "邮箱接入需要处理"
              : "邮箱接入就绪"}
        </strong>
        <span>
          {props.unavailable
            ? "邮箱接入暂时不可用。"
            : !degraded
              ? "邮箱接入已就绪。"
              : friendlyMailEngineCopy(
                  health?.readiness.summary ?? "邮箱接入暂时不可用。",
                )}
        </span>
      </div>
      <div className="mail-engine-readiness-grid">
        {statusRows.map((row) => (
          <p key={row.label}>
            <strong>{row.value}</strong>
            <span>{row.label}</span>
          </p>
        ))}
      </div>
      {health && hasAdminDetails ? (
        <details className="mail-engine-admin-details">
          <summary>详细状态</summary>
          {health.missing.length > 0 ? (
            <div className="mail-engine-status-notes" aria-label="邮箱接入需补充">
              <p>
                <strong>需补充</strong>
                <span>{friendlyMailEngineIssueList(health.missing)}</span>
              </p>
            </div>
          ) : null}
          {health.warnings.length > 0 ? (
            <div className="mail-engine-status-notes" aria-label="邮箱接入提醒">
              <p>
                <strong>提醒</strong>
                <span>{friendlyMailEngineIssueList(health.warnings)}</span>
              </p>
            </div>
          ) : null}
          {health.readiness.setupActions.length > 0 ? (
            <div className="mail-engine-setup-actions">
              {health.readiness.setupActions.map((action) => (
                <div key={action.code}>
                  <strong>{friendlyMailEngineCopy(action.label)}</strong>
                  <span>{friendlyMailEngineEnvList(action.env)}</span>
                  <p>{friendlyMailEngineCopy(action.effect)}</p>
                </div>
              ))}
            </div>
          ) : null}
        </details>
      ) : null}
    </section>
  );
}

function mailEngineReadinessRows(
  health: MailEngineHealthDto,
): Array<{ label: string; value: string }> {
  return [
    {
      label: "连接",
      value: formatMailEngineHttpStatus(health.checks?.http),
    },
    {
      label: "访问权限",
      value: health.capabilities.accessTokenConfigured ? "已设置" : "待设置",
    },
    {
      label: "授权",
      value: formatMailEngineApiAuthStatus(health.checks?.apiAuth),
    },
    {
      label: "接入凭据",
      value: formatMailEngineConfiguredStatus(health.checks?.preparedToken),
    },
    {
      label: "回调保护",
      value: formatMailEngineWebhookSecretStatus(health.checks?.webhookSecret),
    },
    {
      label: "邮箱接入",
      value: health.capabilities.imapSmtpOnboarding ? "可用" : "不可用",
    },
    {
      label: "附件下载",
      value: health.capabilities.attachmentDownload ? "可用" : "不可用",
    },
    {
      label: "发信链路",
      value: health.capabilities.send ? "可用" : "不可用",
    },
  ];
}

function mailEngineUnavailableRows(): Array<{ label: string; value: string }> {
  return [
    "连接",
    "访问权限",
    "授权",
    "接入凭据",
    "回调保护",
    "邮箱接入",
    "附件下载",
    "发信链路",
  ].map((label) => ({
    label,
    value: label === "连接" || label === "授权" ? "未检查" : "未知",
  }));
}

function MailEngineLaunchActivityPanel(props: {
  events: OperationalEventDto[];
  notice: string;
}) {
  return (
    <section
      className="page-panel sync-diagnostics-panel"
      aria-label="同步记录"
    >
      <div className="sync-diagnostics-header">
        <div>
          <h2>同步记录</h2>
          <p>最近同步活动。</p>
        </div>
      </div>
      {props.notice ? (
        <div className="backend-notice" role="status">
          {props.notice}
        </div>
      ) : null}
      {props.events.length > 0 ? (
        <div className="diagnostic-list">
          {props.events.map((event) => (
            <div className="diagnostic-row sync-diagnostic-row" key={event.id}>
              <div>
                <strong>{friendlySyncDiagnosticTitle(event)}</strong>
                <span>
                  {formatOperationalEventSource(event)} ·{" "}
                  {formatOperationalEventLevel(event.level)}
                  {event.jobId ? ` · ${event.jobId}` : ""}
                </span>
                {friendlySyncDiagnosticDetail(event) ? (
                  <p>{friendlySyncDiagnosticDetail(event)}</p>
                ) : null}
              </div>
              <span>{formatMailDate(event.occurredAt)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function formatApiDatabaseHealth(
  status: "ok" | "unavailable" | undefined,
): string {
  if (status === "ok") {
    return "可用";
  }

  if (status === "unavailable") {
    return "不可用";
  }

  return "未探测";
}

function formatMailEngineHttpStatus(
  status: NonNullable<MailEngineHealthDto["checks"]>["http"] | undefined,
): string {
  if (status === "ok") {
    return "可达";
  }

  if (status === "unavailable") {
    return "不可达";
  }

  return "未探测";
}

function formatMailEngineApiAuthStatus(
  status: NonNullable<MailEngineHealthDto["checks"]>["apiAuth"] | undefined,
): string {
  if (status === "ok") {
    return "可用";
  }

  if (status === "unauthorized") {
    return "被拒绝";
  }

  if (status === "unavailable") {
    return "不可用";
  }

  return "未探测";
}

function formatMailEngineConfiguredStatus(
  status:
    | NonNullable<MailEngineHealthDto["checks"]>["accessToken"]
    | NonNullable<MailEngineHealthDto["checks"]>["preparedToken"]
    | undefined,
): string {
  if (status === "configured") {
    return "已配置";
  }

  if (status === "missing") {
    return "缺少";
  }

  return "未探测";
}

function formatMailEngineWebhookSecretStatus(
  status: NonNullable<MailEngineHealthDto["checks"]>["webhookSecret"] | undefined,
): string {
  if (status === "custom") {
    return "已替换";
  }

  if (status === "default") {
    return "默认值";
  }

  if (status === "missing") {
    return "缺少";
  }

  return "未探测";
}

function friendlyMailEngineCopy(value: string): string {
  return value
    .replace(/更新 EmailEngine 访问令牌/g, "更新邮箱接入权限")
    .replace(/设置 EmailEngine 访问令牌/g, "设置邮箱接入权限")
    .replace(/EmailEngine/g, "邮箱接入服务")
    .replace(/邮箱接入服务\s*已具备\s*接入配置。/g, "邮箱接入已就绪。")
    .replace(/上线能力/g, "接入能力")
    .replace(/上线/g, "接入")
    .replace(/同步任务/g, "同步")
    .replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, "$1$2");
}

function friendlyMailEngineIssueList(values: string[]): string {
  return values.map(friendlyMailEngineIssue).join(" / ");
}

function friendlyMailEngineIssue(value: string): string {
  const labels: Record<string, string> = {
    EMAILENGINE_ACCESS_TOKEN_REJECTED: "访问权限未通过",
    EMAILENGINE_ACCESS_TOKEN_MISSING: "访问权限待设置",
    EENGINE_PREPARED_TOKEN_MISSING: "接入凭据待设置",
    EMAILENGINE_WEBHOOK_SECRET_MISSING: "回调保护待设置",
  };
  return labels[value] ?? friendlyMailEngineCopy(value);
}

function friendlyMailEngineEnvList(values: string[]): string {
  return values.map(friendlyMailEngineEnvName).join(" / ");
}

function friendlyMailEngineEnvName(value: string): string {
  const labels: Record<string, string> = {
    EMAILENGINE_ACCESS_TOKEN: "访问权限",
    EENGINE_PREPARED_TOKEN: "接入凭据",
    EMAILENGINE_WEBHOOK_SECRET: "回调保护",
    EMAILENGINE_URL: "连接地址",
  };
  return labels[value] ?? friendlyMailEngineCopy(value);
}

function friendlySyncDiagnosticTitle(event: OperationalEventDto): string {
  const labels: Record<string, string> = {
    emailengine_webhook_ingested: "邮箱服务状态已更新",
    worker_result: "同步已处理",
    sync_account_failed: "同步没有完成",
    sync_account_dead_lettered: "同步多次失败",
    sync_job_retry_scheduled: "同步稍后重试",
    sync_job_dead_lettered: "同步多次失败",
    reauthorization_imap_smtp_failed: "重新授权没有通过",
    native_send_reauthorization_required: "发信权限需要重新授权",
    smtp_send_reauthorization_required: "发信权限需要重新提交授权码",
  };
  return labels[event.event] ?? event.message ?? event.event;
}

function friendlySyncDiagnosticDetail(event: OperationalEventDto): string | undefined {
  if (event.event === "emailengine_webhook_ingested") {
    return "已收到邮箱更新。";
  }
  if (event.event === "worker_result") {
    return "邮箱内容已同步。";
  }
  if (event.event === "sync_job_retry_scheduled") {
    return "稍后会自动重试；如果持续出现，请检查账号。";
  }
  if (event.event === "sync_job_dead_lettered") {
    return "多次失败后已暂停重试，请检查账号。";
  }
  if (event.event === "reauthorization_imap_smtp_failed") {
    return "请检查授权码、专用密码和自定义服务器设置后重新提交。";
  }
  if (event.event.includes("reauthorization_required")) {
    return "请从上方重新授权入口恢复这个账号。";
  }

  return event.message;
}

function latestOperationalEvents(
  events: OperationalEventDto[],
  limit: number,
): OperationalEventDto[] {
  return [...events]
    .sort(
      (left, right) =>
        Date.parse(right.occurredAt) - Date.parse(left.occurredAt),
    )
    .slice(0, limit);
}

function formatOperationalEventSource(event: OperationalEventDto): string {
  if (event.event === "emailengine_webhook_ingested") {
    return "邮箱更新";
  }

  const labels: Record<string, string> = {
    "email-hub-api": "连接",
    "email-hub-worker": "同步",
  };

  return labels[event.service] ?? event.service;
}

function formatOperationalEventLevel(level: OperationalEventDto["level"]) {
  const labels: Record<OperationalEventDto["level"], string> = {
    debug: "记录",
    info: "信息",
    warn: "提醒",
    error: "错误",
  };
  return labels[level];
}

function formatMailDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
