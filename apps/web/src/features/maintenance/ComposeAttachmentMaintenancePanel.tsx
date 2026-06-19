import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Sparkles } from "lucide-react";
import type {
  ComposeAttachmentMaintenanceCleanupResultDto,
  ComposeAttachmentMaintenanceStatusDto,
  EmailHubApi,
  HermesRetentionMaintenanceCleanupResultDto,
  HermesRetentionMaintenanceStatusDto,
} from "../../lib/emailHubApi";

export function ComposeAttachmentMaintenancePanel(props: { api?: EmailHubApi }) {
  const [status, setStatus] = useState<ComposeAttachmentMaintenanceStatusDto>(
    previewComposeAttachmentMaintenanceStatus(),
  );
  const [hermesStatus, setHermesStatus] =
    useState<HermesRetentionMaintenanceStatusDto>(
      previewHermesRetentionMaintenanceStatus(),
    );
  const [minAgeHours, setMinAgeHours] = useState("168");
  const [limit, setLimit] = useState("100");
  const [retentionDays, setRetentionDays] = useState("30");
  const [hermesLimit, setHermesLimit] = useState("500");
  const [busy, setBusy] = useState<
    "" | "refresh" | "cleanup" | "hermes-cleanup"
  >("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let alive = true;

    if (!props.api) {
      setStatus(previewComposeAttachmentMaintenanceStatus());
      setHermesStatus(previewHermesRetentionMaintenanceStatus());
      setNotice("");
      return () => {
        alive = false;
      };
    }

    setBusy("refresh");
    void Promise.all([
      props.api.getComposeAttachmentMaintenanceStatus(),
      props.api.getHermesRetentionMaintenanceStatus(),
    ])
      .then(([nextStatus, nextHermesStatus]) => {
        if (!alive) return;
        setStatus(nextStatus);
        setHermesStatus(nextHermesStatus);
        setNotice("");
      })
      .catch(() => {
        if (!alive) return;
        setNotice("暂时无法读取维护状态。");
      })
      .finally(() => {
        if (alive) {
          setBusy("");
        }
      });

    return () => {
      alive = false;
    };
  }, [props.api]);

  async function refreshStatus() {
    if (!props.api) {
      setStatus(previewComposeAttachmentMaintenanceStatus());
      setHermesStatus(previewHermesRetentionMaintenanceStatus());
      setNotice("");
      return;
    }

    setBusy("refresh");
    try {
      const [nextStatus, nextHermesStatus] = await Promise.all([
        props.api.getComposeAttachmentMaintenanceStatus(),
        props.api.getHermesRetentionMaintenanceStatus(),
      ]);
      setStatus(nextStatus);
      setHermesStatus(nextHermesStatus);
      setNotice("维护状态已刷新。");
    } catch {
      setNotice("刷新失败。");
    } finally {
      setBusy("");
    }
  }

  async function cleanupUploads(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedMinAgeHours = readMaintenanceInteger(minAgeHours, 1, 24 * 90);
    const parsedLimit = readMaintenanceInteger(limit, 1, 10000);
    if (!parsedMinAgeHours || !parsedLimit) {
      setNotice("请输入有效的保留时间和清理数量。");
      return;
    }

    if (!props.api) {
      setStatus({
        ...status,
        generatedAt: new Date().toISOString(),
        staleUnreferenced: 0,
        staleUnreferencedBytes: 0,
      });
      setNotice("预览清理完成：释放 2 MB。");
      return;
    }

    setBusy("cleanup");
    try {
      const result = await props.api.cleanupComposeAttachments({
        minAgeHours: parsedMinAgeHours,
        limit: parsedLimit,
      });
      setStatus(composeMaintenanceStatusFromCleanup(result));
      setNotice(
        `已清理 ${result.cleanup.deleted} 个未引用附件，释放 ${formatByteSize(
          result.cleanup.bytesDeleted,
        )}。`,
      );
    } catch {
      setNotice("清理失败。");
    } finally {
      setBusy("");
    }
  }

  async function cleanupHermesRetention(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedRetentionDays = readMaintenanceInteger(retentionDays, 1, 365);
    const parsedLimit = readMaintenanceInteger(hermesLimit, 1, 10000);
    if (!parsedRetentionDays || !parsedLimit) {
      setNotice("请输入有效的 Hermes 保留天数和清理数量。");
      return;
    }

    if (!props.api) {
      setHermesStatus({
        ...hermesStatus,
        generatedAt: new Date().toISOString(),
        retentionDays: parsedRetentionDays,
        retentionMs: parsedRetentionDays * 24 * 60 * 60 * 1000,
        cleanupLimit: parsedLimit,
        expiredRows: 0,
        scanLimited: false,
        tables: hermesStatus.tables.map((table) => ({
          ...table,
          expiredRows: 0,
          scanLimited: false,
        })),
      });
      setNotice("预览清理完成：Hermes 过期数据已归零。");
      return;
    }

    setBusy("hermes-cleanup");
    try {
      const result = await props.api.cleanupHermesRetention({
        retentionDays: parsedRetentionDays,
        limit: parsedLimit,
      });
      setHermesStatus(hermesRetentionStatusFromCleanup(result));
      setNotice(`已清理 ${result.cleanup.deleted} 条 Hermes 过期记录。`);
    } catch {
      setNotice("Hermes 清理失败。");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="settings-panel" aria-label="存储维护面板">
      <header className="settings-panel-head">
        <div>
          <h2>存储维护</h2>
          <p>清理临时附件和过期记录。</p>
        </div>
        <button
          className="ghost-button"
          type="button"
          disabled={busy === "refresh"}
          onClick={() => void refreshStatus()}
        >
          刷新
        </button>
      </header>

      <div className="settings-card-grid maintenance-grid">
        <article className="settings-module maintenance-stat">
          <span>未引用附件</span>
          <strong>{status.staleUnreferenced.toLocaleString()}</strong>
          <p>{formatByteSize(status.staleUnreferencedBytes)} 可清理</p>
        </article>
        <article className="settings-module maintenance-stat">
          <span>受保护附件</span>
          <strong>{status.protected.toLocaleString()}</strong>
          <p>{status.protectedStorageKeyCount.toLocaleString()} 个草稿引用</p>
        </article>
        <article className="settings-module maintenance-stat">
          <span>检查数量</span>
          <strong>{status.scanned.toLocaleString()}</strong>
          <p>
            最多 {status.scanLimit.toLocaleString()}
            {status.scanLimited ? " · 已到上限" : ""}
          </p>
        </article>
        <article className="settings-module maintenance-stat">
          <span>异常记录</span>
          <strong>{status.invalid.toLocaleString()}</strong>
          <p>缓存总量 {formatByteSize(status.totalBytes)}</p>
        </article>
      </div>

      <div className="settings-card-grid maintenance-grid">
        <article className="settings-module maintenance-stat">
          <span>Hermes 过期记录</span>
          <strong>{hermesStatus.expiredRows.toLocaleString()}</strong>
          <p>{hermesStatus.scanLimited ? "超过扫描上限" : "当前可清理"}</p>
        </article>
        <article className="settings-module maintenance-stat">
          <span>Hermes 保留天数</span>
          <strong>{hermesStatus.retentionDays.toLocaleString()}</strong>
          <p>截止 {formatMaintenanceDate(hermesStatus.cutoff)}</p>
        </article>
        <article className="settings-module maintenance-stat">
          <span>Hermes 每次清理</span>
          <strong>{hermesStatus.cleanupLimit.toLocaleString()}</strong>
          <p>单次上限</p>
        </article>
        <article className="settings-module maintenance-stat">
          <span>Hermes 数据项</span>
          <strong>{hermesStatus.tables.length.toLocaleString()}</strong>
          <p>缓存和历史记录</p>
        </article>
      </div>

      <section className="settings-module hermes-retention-table-list">
        <div className="sync-diagnostics-header">
          <div>
            <h3>Hermes 历史记录</h3>
            <p>{hermesStatus.scanLimited ? "还有更多过期记录" : "当前范围内已检查"}</p>
          </div>
        </div>
        <div className="task-list">
          {hermesStatus.tables.map((table) => (
            <div className="task-row" key={table.table}>
              <Sparkles size={18} />
              <div>
                <strong>{formatHermesRetentionTableName(table.table)}</strong>
                <span>
                  {table.expiredRows.toLocaleString()} 条过期
                  {table.scanLimited ? " · 已到上限" : ""}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <form className="settings-module maintenance-cleanup" onSubmit={cleanupUploads}>
        <div>
          <h3>附件清理</h3>
          <p>{`保留最近 ${Math.round(status.retentionMs / 3600000)} 小时的附件。`}</p>
        </div>
        <label>
          <span>最小保留小时</span>
          <input
            aria-label="保留小时"
            type="number"
            min={1}
            max={24 * 90}
            value={minAgeHours}
            onChange={(event) => setMinAgeHours(event.currentTarget.value)}
          />
        </label>
        <label>
          <span>每次最多清理</span>
          <input
            aria-label="附件每次最多清理"
            type="number"
            min={1}
            max={10000}
            value={limit}
            onChange={(event) => setLimit(event.currentTarget.value)}
          />
        </label>
        <button
          className="primary-button"
          type="submit"
          disabled={busy === "cleanup"}
        >
          清理未引用附件
        </button>
      </form>

      <form
        className="settings-module maintenance-cleanup"
        aria-label="Hermes 历史清理"
        onSubmit={cleanupHermesRetention}
      >
        <div>
          <h3>Hermes 历史清理</h3>
          <p>{`默认删除超过 ${hermesStatus.retentionDays} 天的缓存和历史记录。`}</p>
        </div>
        <label>
          <span>保留天数</span>
          <input
            aria-label="Hermes 保留天数"
            type="number"
            min={1}
            max={365}
            value={retentionDays}
            onChange={(event) => setRetentionDays(event.currentTarget.value)}
          />
        </label>
        <label>
          <span>每次最多清理</span>
          <input
            aria-label="Hermes 每次最多清理"
            type="number"
            min={1}
            max={10000}
            value={hermesLimit}
            onChange={(event) => setHermesLimit(event.currentTarget.value)}
          />
        </label>
        <button
          className="primary-button"
          type="submit"
          disabled={busy === "hermes-cleanup"}
        >
          清理 Hermes 历史
        </button>
      </form>

      {notice ? (
        <div className="backend-notice" role="status">
          {notice}
        </div>
      ) : null}
    </section>
  );
}

function previewComposeAttachmentMaintenanceStatus(): ComposeAttachmentMaintenanceStatusDto {
  return {
    generatedAt: "2026-06-16T00:00:00.000Z",
    storage: "local",
    retentionMs: 7 * 24 * 60 * 60 * 1000,
    cleanupLimit: 100,
    protectedStorageKeyCount: 2,
    scanned: 12,
    scanLimit: 5000,
    scanLimited: false,
    uploads: 10,
    totalBytes: 8 * 1024 * 1024,
    protected: 2,
    fresh: 3,
    staleUnreferenced: 5,
    staleUnreferencedBytes: 2 * 1024 * 1024,
    invalid: 0,
    oldestCreatedAt: "2026-06-01T00:00:00.000Z",
    newestCreatedAt: "2026-06-15T23:00:00.000Z",
  };
}

function previewHermesRetentionMaintenanceStatus(): HermesRetentionMaintenanceStatusDto {
  return {
    generatedAt: "2026-06-16T00:00:00.000Z",
    retentionMs: 30 * 24 * 60 * 60 * 1000,
    retentionDays: 30,
    cleanupLimit: 500,
    cutoff: "2026-05-17T00:00:00.000Z",
    expiredRows: 18,
    scanLimited: false,
    tables: [
      hermesRetentionTableStatus("hermes_message_translations", "updated_at", 3),
      hermesRetentionTableStatus("hermes_message_summaries", "updated_at", 2),
      hermesRetentionTableStatus("hermes_action_plans", "created_at", 4),
      hermesRetentionTableStatus("hermes_feedback", "created_at", 1),
      hermesRetentionTableStatus("hermes_audit_events", "created_at", 5),
      hermesRetentionTableStatus("hermes_skill_runs", "created_at", 3),
    ],
  };
}

function hermesRetentionTableStatus(
  table: string,
  timestampColumn: string,
  expiredRows: number,
): HermesRetentionMaintenanceStatusDto["tables"][number] {
  return {
    table,
    timestampColumn,
    expiredRows,
    scanLimit: 500,
    scanLimited: false,
  };
}

function composeMaintenanceStatusFromCleanup(
  result: ComposeAttachmentMaintenanceCleanupResultDto,
): ComposeAttachmentMaintenanceStatusDto {
  return {
    generatedAt: result.generatedAt,
    storage: result.storage,
    retentionMs: result.retentionMs,
    cleanupLimit: result.cleanupLimit,
    protectedStorageKeyCount: result.protectedStorageKeyCount,
    ...result.after,
  };
}

function hermesRetentionStatusFromCleanup(
  result: HermesRetentionMaintenanceCleanupResultDto,
): HermesRetentionMaintenanceStatusDto {
  return result.after;
}

function formatHermesRetentionTableName(table: string): string {
  const labels: Record<string, string> = {
    hermes_message_translations: "邮件翻译缓存",
    hermes_message_summaries: "邮件总结缓存",
    hermes_action_plans: "整理建议",
    hermes_feedback: "草稿反馈",
    hermes_audit_events: "操作记录",
    hermes_skill_runs: "执行记录",
  };

  return labels[table] ?? table;
}

function readMaintenanceInteger(
  value: string,
  min: number,
  max: number,
): number | undefined {
  if (!/^\d+$/.test(value.trim())) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : undefined;
}

function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const formatted =
    Number.isInteger(value) || value >= 10 || unitIndex === 0
      ? String(Math.round(value))
      : value.toFixed(1);

  return `${formatted} ${units[unitIndex]}`;
}

function formatMaintenanceDate(value: string): string {
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
