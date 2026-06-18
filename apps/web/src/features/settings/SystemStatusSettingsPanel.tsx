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
    setMailEngineLaunchNotice("正在读取最近运行事件...");
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
        setMailEngineLaunchNotice(
          events.length > 0 ? "" : "还没有最近运行事件。",
        );
      })
      .catch(() => {
        if (alive) {
          setMailEngineLaunchEvents([]);
          setMailEngineLaunchNotice("最近运行事件暂时不可用。");
        }
      });

    return () => {
      alive = false;
    };
  }, [props.api]);

  if (!props.api) {
    return (
      <section className="page-panel" aria-label="系统状态">
        <h2>系统状态</h2>
        <p>连接服务后可查看系统状态。</p>
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
      aria-label="服务运行体检"
    >
      <div>
        <strong>{degraded ? "服务运行需要检查" : "服务运行正常"}</strong>
        <span>
          {props.unavailable
            ? "无法读取服务状态，请检查后端进程、网络和访问配置。"
            : props.health?.ok
              ? "服务正常响应，数据库探测结果如下。"
              : "服务已响应，但依赖探测未全部通过。"}
        </span>
      </div>
      <div className="api-health-grid">
        <p>
          <strong>
            {props.health?.ok ? "可用" : props.unavailable ? "未知" : "异常"}
          </strong>
          <span>服务</span>
        </p>
        <p>
          <strong>{formatApiDatabaseHealth(databaseStatus)}</strong>
          <span>数据库</span>
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
      aria-label="邮箱接入体检"
    >
      <div>
        <strong>
          {props.unavailable
            ? "邮箱接入体检暂时不可用"
            : degraded
              ? "邮箱接入还差配置"
              : "邮箱接入服务就绪"}
        </strong>
        <span>
          {friendlyMailEngineCopy(
            health?.readiness.summary ??
              "无法读取接入体检，请检查服务状态和访问配置。",
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
          <summary>管理员配置明细</summary>
          {health.missing.length > 0 ? (
            <div className="mail-engine-status-notes" aria-label="邮箱接入缺失">
              <p>
                <strong>缺失</strong>
                <span>{health.missing.join(" / ")}</span>
              </p>
            </div>
          ) : null}
          {health.warnings.length > 0 ? (
            <div className="mail-engine-status-notes" aria-label="邮箱接入警告">
              <p>
                <strong>警告</strong>
                <span>{health.warnings.join(" / ")}</span>
              </p>
            </div>
          ) : null}
          {health.readiness.setupActions.length > 0 ? (
            <div className="mail-engine-setup-actions">
              {health.readiness.setupActions.map((action) => (
                <div key={action.code}>
                  <strong>{friendlyMailEngineCopy(action.label)}</strong>
                  <span>{action.env.join(" / ")}</span>
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
      label: "运行探测",
      value: formatMailEngineHttpStatus(health.checks?.http),
    },
    {
      label: "访问令牌",
      value: health.capabilities.accessTokenConfigured ? "已配置" : "缺少",
    },
    {
      label: "认证探测",
      value: formatMailEngineApiAuthStatus(health.checks?.apiAuth),
    },
    {
      label: "预置令牌",
      value: formatMailEngineConfiguredStatus(health.checks?.preparedToken),
    },
    {
      label: "回调密钥",
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
    "运行探测",
    "访问令牌",
    "认证探测",
    "预置令牌",
    "回调密钥",
    "邮箱接入",
    "附件下载",
    "发信链路",
  ].map((label) => ({
    label,
    value: label === "运行探测" || label === "认证探测" ? "未探测" : "未知",
  }));
}

function MailEngineLaunchActivityPanel(props: {
  events: OperationalEventDto[];
  notice: string;
}) {
  return (
    <section
      className="page-panel sync-diagnostics-panel"
      aria-label="邮箱同步运行记录"
    >
      <div className="sync-diagnostics-header">
        <div>
          <h2>邮箱同步运行记录</h2>
          <p>最近收信回调、同步任务和重试活动。</p>
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
    .replace(/更新 EmailEngine 访问令牌/g, "更新邮箱接入访问令牌")
    .replace(/设置 EmailEngine 访问令牌/g, "设置邮箱接入访问令牌")
    .replace(/EmailEngine/g, "邮箱接入服务")
    .replace(/上线/g, "接入")
    .replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, "$1$2");
}

function friendlySyncDiagnosticTitle(event: OperationalEventDto): string {
  const labels: Record<string, string> = {
    emailengine_webhook_ingested: "邮箱服务状态已更新",
    worker_result: "同步任务已处理",
    sync_account_failed: "同步任务没有完成",
    sync_account_dead_lettered: "同步任务多次失败",
    sync_job_retry_scheduled: "同步任务等待重试",
    sync_job_dead_lettered: "同步任务多次失败",
    reauthorization_imap_smtp_failed: "重新授权没有通过",
    native_send_reauthorization_required: "发信权限需要重新授权",
    smtp_send_reauthorization_required: "发信权限需要重新提交授权码",
  };
  return labels[event.event] ?? event.message ?? event.event;
}

function friendlySyncDiagnosticDetail(event: OperationalEventDto): string | undefined {
  if (event.event === "emailengine_webhook_ingested") {
    return "系统已收到邮箱服务回调，正在按本地同步状态处理。";
  }
  if (event.event === "worker_result") {
    return "后台已处理一条同步任务，邮箱镜像链路有最近活动。";
  }
  if (event.event === "sync_job_retry_scheduled") {
    return "同步任务会自动重试；如果持续出现，请打开账号诊断查看恢复建议。";
  }
  if (event.event === "sync_job_dead_lettered") {
    return "同步任务多次失败后已停止重试，请打开账号诊断处理。";
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
    return "收信回调";
  }

  const labels: Record<string, string> = {
    "email-hub-api": "服务",
    "email-hub-worker": "同步任务",
  };

  return labels[event.service] ?? event.service;
}

function formatOperationalEventLevel(level: OperationalEventDto["level"]) {
  const labels: Record<OperationalEventDto["level"], string> = {
    debug: "调试",
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
