import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import type {
  EmailHubApi,
  GatekeeperMode,
  GatekeeperSenderDto,
} from "../../lib/emailHubApi";

const gatekeeperOptions: Array<{
  mode: GatekeeperMode;
  label: string;
  description: string;
}> = [
  {
    mode: "off_accept_all",
    label: "不筛新发件人",
    description: "新来信直接进入原邮箱目录，适合刚开始使用。",
  },
  {
    mode: "inside_email",
    label: "在邮箱内提醒",
    description: "陌生发件人仍进邮箱，但会显示提醒，方便快速判断。",
  },
  {
    mode: "before_inbox",
    label: "先进入新发件人",
    description: "第一次来信先集中到新发件人区域，确认后再进入主收件箱。",
  },
];

export function GatekeeperSettingsPanel(props: {
  api?: EmailHubApi;
  accountId: string;
}) {
  const [mode, setMode] = useState<GatekeeperMode>("off_accept_all");
  const [notice, setNotice] = useState("正在读取当前设置...");
  const [senders, setSenders] = useState<GatekeeperSenderDto[]>([]);
  const [senderBusy, setSenderBusy] = useState("");

  async function loadSenders() {
    if (!props.api) {
      setSenders([
        {
          senderId: "preview_sender",
          email: "new-client@example.com",
          domain: "example.com",
          status: "unknown",
          messageCount: 2,
          latestMessageId: "preview_message",
          latestReceivedAt: "2026-06-14T08:00:00.000Z",
          bulkAvailable: true,
        },
      ]);
      return;
    }

    try {
      const page = await props.api.listGatekeeperSenders({
        accountId: props.accountId,
        status: "unknown",
      });
      setSenders(page.items);
    } catch {
      setSenders([]);
    }
  }

  useEffect(() => {
    let alive = true;

    if (!props.api) {
      setMode("inside_email");
      setNotice("本地预览设置。连接后会保存到当前邮箱账号。");
      void loadSenders();
      return () => {
        alive = false;
      };
    }

    void props.api
      .getGatekeeperSettings({ accountId: props.accountId })
      .then((settings) => {
        if (!alive) return;
        setMode(settings.mode);
        setNotice("设置已同步。");
        void loadSenders();
      })
      .catch(() => {
        if (!alive) return;
        setNotice("暂时无法读取设置，稍后可重试。");
      });

    return () => {
      alive = false;
    };
  }, [props.accountId, props.api]);

  async function chooseMode(nextMode: GatekeeperMode) {
    setMode(nextMode);

    if (!props.api) {
      setNotice(`当前：${gatekeeperModeLabel(nextMode)}`);
      return;
    }

    setNotice("正在保存...");
    try {
      const saved = await props.api.updateGatekeeperSettings({
        accountId: props.accountId,
        mode: nextMode,
      });
      setMode(saved.mode);
      setNotice(`当前：${gatekeeperModeLabel(saved.mode)}`);
      await loadSenders();
    } catch {
      setNotice("保存失败，请稍后重试。");
    }
  }

  async function decideSender(
    sender: GatekeeperSenderDto,
    action: "accept" | "block" | "block_domain",
  ) {
    if (!props.api) {
      setSenders((current) =>
        current.filter((item) => item.senderId !== sender.senderId),
      );
      setNotice(
        action === "accept"
          ? "预览：发件人已放行。"
          : "预览：发件人已阻止。",
      );
      return;
    }

    const actionKey = `${sender.senderId}:${action}`;
    setSenderBusy(actionKey);
    try {
      if (action === "accept") {
        await props.api.acceptGatekeeperSender({
          accountId: props.accountId,
          senderId: sender.senderId,
        });
        setNotice(`${sender.email} 已放行。`);
      } else if (action === "block") {
        await props.api.blockGatekeeperSender({
          accountId: props.accountId,
          senderId: sender.senderId,
        });
        setNotice(`${sender.email} 已阻止。`);
      } else {
        await props.api.blockGatekeeperDomain({
          accountId: props.accountId,
          domain: sender.domain,
        });
        setNotice(`${sender.domain} 已阻止。`);
      }
      await loadSenders();
    } catch {
      setNotice("新发件人处理失败，请稍后重试。");
    } finally {
      setSenderBusy("");
    }
  }

  async function bulkAcceptSenders() {
    if (senders.length === 0) {
      setNotice("没有待处理的新发件人。");
      return;
    }
    if (!props.api) {
      setSenders([]);
      setNotice("预览：已批量放行。");
      return;
    }

    setSenderBusy("bulk:accept");
    try {
      const result = await props.api.bulkDecideGatekeeperSenders({
        accountId: props.accountId,
        senderIds: senders
          .filter((sender) => sender.bulkAvailable)
          .map((sender) => sender.senderId),
        action: "accept",
      });
      setNotice(`已放行 ${result.items.length} 个发件人。`);
      await loadSenders();
    } catch {
      setNotice("批量处理失败，确认当前模式是否允许批量操作。");
    } finally {
      setSenderBusy("");
    }
  }

  return (
    <section className="settings-panel" aria-label="Gatekeeper settings">
      <header className="settings-panel-head">
        <div>
          <h2>新发件人处理</h2>
          <p>控制第一次联系你的发件人怎么进入邮箱，避免重要邮件和陌生来信混在一起。</p>
        </div>
      </header>
      <div className="mode-grid">
        {gatekeeperOptions.map((option) => (
          <button
            key={option.mode}
            className={mode === option.mode ? "mode-button active" : "mode-button"}
            type="button"
            aria-label={option.label}
            onClick={() => void chooseMode(option.mode)}
          >
            <strong>{option.label}</strong>
            <span>{option.description}</span>
          </button>
        ))}
      </div>
      <div className="backend-notice" role="status">
        {notice.startsWith("当前：")
          ? notice
          : `当前：${gatekeeperModeLabel(mode)} · ${notice}`}
      </div>
      <section className="settings-module gatekeeper-senders">
        <div className="sync-diagnostics-header">
          <div>
            <h3>新发件人</h3>
            <p>{senders.length ? `${senders.length} 个待处理` : "暂无待处理发件人"}</p>
          </div>
          <div className="task-actions">
            <button
              type="button"
              disabled={senderBusy === "bulk:accept"}
              onClick={() => void bulkAcceptSenders()}
            >
              批量放行
            </button>
            <button type="button" onClick={() => void loadSenders()}>
              刷新
            </button>
          </div>
        </div>
        {senders.map((sender) => (
          <div className="task-row" key={sender.senderId}>
            <ShieldCheck size={19} />
            <div>
              <strong>{sender.email}</strong>
              <span>
                {sender.domain} · {sender.messageCount} 封
                {sender.latestReceivedAt
                  ? ` · ${formatGatekeeperDate(sender.latestReceivedAt)}`
                  : ""}
              </span>
            </div>
            <div className="task-actions">
              <button
                type="button"
                aria-label={`Accept sender ${sender.email}`}
                disabled={senderBusy === `${sender.senderId}:accept`}
                onClick={() => void decideSender(sender, "accept")}
              >
                放行
              </button>
              <button
                type="button"
                aria-label={`Block sender ${sender.email}`}
                disabled={senderBusy === `${sender.senderId}:block`}
                onClick={() => void decideSender(sender, "block")}
              >
                阻止发件人
              </button>
              <button
                type="button"
                aria-label={`Block domain ${sender.domain}`}
                disabled={senderBusy === `${sender.senderId}:block_domain`}
                onClick={() => void decideSender(sender, "block_domain")}
              >
                阻止域名
              </button>
            </div>
          </div>
        ))}
      </section>
    </section>
  );
}

function gatekeeperModeLabel(mode: GatekeeperMode): string {
  return (
    gatekeeperOptions.find((option) => option.mode === mode)?.label ??
    "不筛新发件人"
  );
}

function formatGatekeeperDate(value: string): string {
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
