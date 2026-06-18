import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import type { EmailHubApi, FollowUpDto } from "../../lib/emailHubApi";
import "./FollowUpTodoPanel.css";

export function FollowUpTodoPanel(props: {
  api?: EmailHubApi;
  accountId: string;
  embedded?: boolean;
}) {
  const [items, setItems] = useState<FollowUpDto[]>([]);
  const [notice, setNotice] = useState("正在加载待办...");

  useEffect(() => {
    if (!props.api?.listFollowUps) {
      setItems([
        {
          id: "preview_followup",
          accountId: props.accountId,
          messageId: "preview_message",
          kind: "waiting_on_them",
          status: "open",
          dueAt: "2026-06-14T09:00:00.000Z",
          title: "今天 17:00 前确认 Q2 合作方案",
          note: "来自邮件和 Hermes 提取。",
          source: "hermes_followup",
          createdAt: "2026-06-13T09:00:00.000Z",
          updatedAt: "2026-06-13T09:00:00.000Z",
        },
      ]);
      setNotice("连接服务后会显示同步后的待办。");
      return;
    }

    let alive = true;
    setNotice("正在加载待办...");
    void props.api
      .listFollowUps({
        accountId: props.accountId,
        status: "open",
        limit: 50,
      })
      .then((page) => {
        if (!alive) return;
        setItems(page.items);
        setNotice(page.items.length === 0 ? "没有待处理事项。" : "");
      })
      .catch(() => {
        if (alive) {
          setNotice("待办暂时不可用。");
        }
      });

    return () => {
      alive = false;
    };
  }, [props.accountId, props.api]);

  async function markDone(item: FollowUpDto) {
    if (!props.api?.updateFollowUp) {
      setItems((current) =>
        current.filter((candidate) => candidate.id !== item.id),
      );
      return;
    }

    const updated = await props.api.updateFollowUp({
      id: item.id,
      status: "done",
    });
    setItems((current) =>
      current.filter((candidate) => candidate.id !== updated.id),
    );
    setNotice(`${updated.title ?? updated.messageId} marked done.`);
  }

  return (
    <section
      className={
        props.embedded
          ? "page-panel follow-up-mail-panel"
          : "workspace-page page-scroll narrow"
      }
      aria-label={props.embedded ? "邮箱待办" : undefined}
    >
      <header
        className={props.embedded ? "follow-up-panel-head" : "topbar single"}
      >
        <div>
          {props.embedded ? <h2>待办</h2> : <h1>待办</h1>}
          <p>待回复、稍后提醒和跟进事项集中处理。</p>
        </div>
      </header>
      {notice ? (
        <div className="backend-notice" role="status">
          {notice}
        </div>
      ) : null}
      <section className={props.embedded ? "follow-up-list" : "page-panel"}>
        {items.map((item) => (
          <div className="task-row" key={item.id}>
            <CheckCircle2 size={19} />
            <div>
              <strong>{item.title ?? item.messageId}</strong>
              <span>
                {item.note ?? item.kind} · {formatFollowUpDate(item.dueAt)}
              </span>
            </div>
            <button
              type="button"
              aria-label="Mark follow-up done"
              onClick={() => void markDone(item)}
            >
              完成
            </button>
          </div>
        ))}
      </section>
    </section>
  );
}

function formatFollowUpDate(value: string): string {
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
