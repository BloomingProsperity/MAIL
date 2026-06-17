import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import type {
  EmailHubApi,
  HermesAuditLogEntryDto,
  HermesMemoryDto,
} from "../../lib/emailHubApi";

export interface HermesMemoryManagerPanelProps {
  api?: EmailHubApi;
  accountId?: string;
  onInspectMemoryUsage?: (memory: HermesMemoryDto) => void;
}

export interface HermesAuditLogPanelProps {
  api?: EmailHubApi;
  accountId?: string;
  focusedMemoryId?: string;
  focusedMemoryLabel?: string;
  onClearFocusedMemory?: () => void;
}

const previewMemories: HermesMemoryDto[] = [
  {
    id: "preview-writing-style",
    layer: "writing_style_profile",
    scope: "global",
    content: {
      preference: "Keep replies concise, warm, and action-oriented.",
    },
    confidence: 0.82,
    createdAt: "2026-06-15T08:00:00.000Z",
    updatedAt: "2026-06-15T09:00:00.000Z",
  },
];

const previewAuditEvents: HermesAuditLogEntryDto[] = [
  {
    id: "preview_audit_translate",
    eventType: "hermes.skill.translate_text",
    skillRunId: "preview_run_translate",
    skillId: "translate_text",
    skillTitle: "邮件翻译",
    readMessageIds: ["preview_message"],
    memoryIds: ["preview_translation_preference"],
    action: {
      skillId: "translate_text",
      targetLanguage: "zh-CN",
      memoryScope: "global",
    },
    createdAt: "2026-06-15T09:30:00.000Z",
  },
];

export function HermesMemoryManagerPanel(props: HermesMemoryManagerPanelProps) {
  const [memories, setMemories] = useState<HermesMemoryDto[]>([]);
  const [memoryEdits, setMemoryEdits] = useState<
    Record<string, { contentText: string; confidenceText: string }>
  >({});
  const [memoryLayerFilter, setMemoryLayerFilter] = useState("");
  const [memoryScopeFilter, setMemoryScopeFilter] = useState("");
  const [memoryLimit, setMemoryLimit] = useState("50");
  const [reviewOnly, setReviewOnly] = useState(false);
  const [memoryNotice, setMemoryNotice] = useState("正在读取 Hermes 学习记录...");
  const [busyMemoryId, setBusyMemoryId] = useState("");
  const [pendingDeleteMemoryId, setPendingDeleteMemoryId] = useState("");
  const visibleMemories = useMemo(
    () =>
      reviewOnly
        ? memories.filter((memory) => memory.confidence < 0.6)
        : memories,
    [memories, reviewOnly],
  );

  function syncMemoryEdits(nextMemories: HermesMemoryDto[]) {
    setMemoryEdits(
      Object.fromEntries(
        nextMemories.map((memory) => [
          memory.id,
          {
            contentText: formatHermesMemoryContent(memory.content),
            confidenceText: String(memory.confidence),
          },
        ]),
      ),
    );
  }

  async function loadMemories() {
    const limit = Number.parseInt(memoryLimit, 10);
    const safeLimit = Number.isInteger(limit) && limit >= 1 ? Math.min(limit, 100) : 50;

    if (!props.api) {
      setMemories(previewMemories);
      syncMemoryEdits(previewMemories);
      setMemoryNotice("本地预览学习记录，连接后会读取真实 Hermes 学习记录。");
      return;
    }

    if (!props.accountId) {
      setMemories([]);
      syncMemoryEdits([]);
      setPendingDeleteMemoryId("");
      setMemoryNotice("请先添加邮箱并完成同步，再查看 Hermes 学习记录。");
      return;
    }

    setMemoryNotice("正在读取 Hermes 学习记录...");
    try {
      const page = await props.api.listHermesMemories({
        accountId: props.accountId,
        ...(memoryLayerFilter.trim() ? { layer: memoryLayerFilter.trim() } : {}),
        ...(memoryScopeFilter.trim() ? { scope: memoryScopeFilter.trim() } : {}),
        limit: safeLimit,
      });
      setMemories(page.items);
      syncMemoryEdits(page.items);
      setPendingDeleteMemoryId("");
      setMemoryNotice(
        page.items.length === 0
          ? "没有匹配的 Hermes 学习记录。"
          : `已读取 ${page.items.length} 条 Hermes 学习记录。`,
      );
    } catch {
      setMemories([]);
      syncMemoryEdits([]);
      setPendingDeleteMemoryId("");
      setMemoryNotice("Hermes 学习记录暂时不可用。");
    }
  }

  useEffect(() => {
    void loadMemories();
    // Filters are applied by the explicit refresh button to avoid reloading while typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.accountId, props.api]);

  function updateMemoryEdit(
    memory: HermesMemoryDto,
    patch: Partial<{ contentText: string; confidenceText: string }>,
  ) {
    setMemoryEdits((current) => ({
      ...current,
      [memory.id]: {
        contentText:
          current[memory.id]?.contentText ??
          formatHermesMemoryContent(memory.content),
        confidenceText:
          current[memory.id]?.confidenceText ?? String(memory.confidence),
        ...patch,
      },
    }));
  }

  async function saveMemory(memory: HermesMemoryDto) {
    const edit = memoryEdits[memory.id] ?? {
      contentText: formatHermesMemoryContent(memory.content),
      confidenceText: String(memory.confidence),
    };
    let content;
    try {
      content = parseHermesMemoryContent(edit.contentText);
    } catch {
      setMemoryNotice("学习内容必须是 JSON 对象。");
      return;
    }

    const confidence = parseHermesMemoryConfidence(edit.confidenceText);
    if (confidence === undefined) {
      setMemoryNotice("置信度必须在 0 到 1 之间。");
      return;
    }

    if (!props.api) {
      setMemories((current) =>
        current.map((item) =>
          item.id === memory.id
            ? {
                ...item,
                content,
                confidence,
                updatedAt: new Date().toISOString(),
              }
            : item,
        ),
      );
      setMemoryNotice("预览学习记录已更新。");
      return;
    }

    if (!props.accountId) {
      setMemoryNotice("请先添加邮箱并完成同步，再保存 Hermes 学习记录。");
      return;
    }

    setBusyMemoryId(memory.id);
    setMemoryNotice("正在保存 Hermes 学习记录...");
    try {
      const saved = await props.api.updateHermesMemory({
        id: memory.id,
        accountId: props.accountId,
        content,
        confidence,
      });
      setMemories((current) =>
        current.map((item) => (item.id === saved.id ? saved : item)),
      );
      updateMemoryEdit(saved, {
        contentText: formatHermesMemoryContent(saved.content),
        confidenceText: String(saved.confidence),
      });
      setMemoryNotice("Hermes 学习记录已保存。");
    } catch {
      setMemoryNotice("保存 Hermes 学习记录失败。");
    } finally {
      setBusyMemoryId("");
    }
  }

  async function deleteMemory(memory: HermesMemoryDto) {
    if (pendingDeleteMemoryId !== memory.id) {
      setPendingDeleteMemoryId(memory.id);
      setMemoryNotice(`再次点击确认删除 ${formatHermesMemoryLayer(memory.layer)}。`);
      return;
    }

    if (!props.api) {
      setMemories((current) => current.filter((item) => item.id !== memory.id));
      setPendingDeleteMemoryId("");
      setMemoryNotice("预览学习记录已删除。");
      return;
    }

    if (!props.accountId) {
      setMemoryNotice("请先添加邮箱并完成同步，再删除 Hermes 学习记录。");
      return;
    }

    setBusyMemoryId(memory.id);
    setMemoryNotice("正在删除 Hermes 学习记录...");
    try {
      await props.api.deleteHermesMemory({
        id: memory.id,
        accountId: props.accountId,
      });
      setMemories((current) => current.filter((item) => item.id !== memory.id));
      setPendingDeleteMemoryId("");
      setMemoryNotice("Hermes 学习记录已删除。");
    } catch {
      setMemoryNotice("删除 Hermes 学习记录失败。");
    } finally {
      setBusyMemoryId("");
    }
  }

  return (
    <section className="settings-subpanel" aria-label="Hermes 学习记录">
      <header className="settings-panel-head">
        <div>
          <h3>学习记录</h3>
          <p>查看、修正或删除 Hermes 用来适配你写作和整理习惯的记忆。</p>
        </div>
        <button className="ghost-button" type="button" onClick={() => void loadMemories()}>
          刷新学习记录
        </button>
      </header>

      <div className="memory-filter-grid">
        <label>
          <span>层级</span>
          <input
            aria-label="Hermes memory layer filter"
            value={memoryLayerFilter}
            onChange={(event) => setMemoryLayerFilter(event.target.value)}
            placeholder="writing_style_profile"
          />
        </label>
        <label>
          <span>作用域</span>
          <input
            aria-label="Hermes memory scope filter"
            value={memoryScopeFilter}
            onChange={(event) => setMemoryScopeFilter(event.target.value)}
            placeholder="global"
          />
        </label>
        <label>
          <span>数量</span>
          <input
            aria-label="Hermes memory limit"
            inputMode="numeric"
            value={memoryLimit}
            onChange={(event) => setMemoryLimit(event.target.value)}
          />
        </label>
      </div>

      <label className="field-toggle hermes-review-toggle">
        <input
          aria-label="Show Hermes memories needing review"
          type="checkbox"
          checked={reviewOnly}
          onChange={(event) => setReviewOnly(event.currentTarget.checked)}
        />
        <span>仅看需复核记忆</span>
      </label>

      <div className="backend-notice compact" role="status">
        {memoryNotice}
      </div>

      <div className="hermes-memory-list">
        {visibleMemories.map((memory) => {
          const edit = memoryEdits[memory.id] ?? {
            contentText: formatHermesMemoryContent(memory.content),
            confidenceText: String(memory.confidence),
          };
          const isBusy = busyMemoryId === memory.id;
          return (
            <article className="hermes-memory-card" key={memory.id}>
              <div className="hermes-memory-meta">
                <div>
                  <strong>{formatHermesMemoryLayer(memory.layer)}</strong>
                  <span>
                    作用域 {memory.scope} · 置信度{" "}
                    {Math.round(memory.confidence * 100)}%
                  </span>
                </div>
                <span>{formatHermesPanelDate(memory.updatedAt)}</span>
              </div>
              <label>
                <span>内容 JSON</span>
                <textarea
                  aria-label={`Hermes memory content ${memory.id}`}
                  value={edit.contentText}
                  onChange={(event) =>
                    updateMemoryEdit(memory, {
                      contentText: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                <span>置信度</span>
                <input
                  aria-label={`Hermes memory confidence ${memory.id}`}
                  inputMode="decimal"
                  value={edit.confidenceText}
                  onChange={(event) =>
                    updateMemoryEdit(memory, {
                      confidenceText: event.target.value,
                    })
                  }
                />
              </label>
              <div className="inline-actions">
                <button
                  className="ghost-button"
                  type="button"
                  disabled={isBusy}
                  aria-label={`Inspect Hermes memory usage ${memory.id}`}
                  onClick={() => props.onInspectMemoryUsage?.(memory)}
                >
                  查看使用记录
                </button>
                <button
                  className="primary-button"
                  type="button"
                  disabled={isBusy}
                  onClick={() => void saveMemory(memory)}
                >
                  保存学习记录
                </button>
                <button
                  className="ghost-button danger"
                  type="button"
                  disabled={isBusy}
                  onClick={() => void deleteMemory(memory)}
                >
                  {pendingDeleteMemoryId === memory.id ? "确认删除" : "准备删除"}
                </button>
              </div>
            </article>
          );
        })}
        {visibleMemories.length === 0 ? (
          <div className="empty-search">没有匹配的 Hermes 学习记录。</div>
        ) : null}
      </div>
    </section>
  );
}

export function HermesAuditLogPanel(props: HermesAuditLogPanelProps) {
  const [events, setEvents] = useState<HermesAuditLogEntryDto[]>([]);
  const [skillFilter, setSkillFilter] = useState("");
  const [messageIdFilter, setMessageIdFilter] = useState("");
  const [memoryIdFilter, setMemoryIdFilter] = useState("");
  const [limitText, setLimitText] = useState("50");
  const [memoryEventsOnly, setMemoryEventsOnly] = useState(false);
  const [auditNotice, setAuditNotice] = useState("正在读取 Hermes 审计日志...");
  const [auditBusy, setAuditBusy] = useState(false);
  const visibleEvents = useMemo(
    () =>
      memoryEventsOnly
        ? events.filter((event) => event.memoryIds.length > 0)
        : events,
    [events, memoryEventsOnly],
  );

  async function loadAuditEvents(
    overrides: {
      memoryId?: string;
      clearSkillAndMessageFilters?: boolean;
    } = {},
  ) {
    const limit = Number.parseInt(limitText, 10);
    const safeLimit = Number.isInteger(limit) && limit >= 1 ? Math.min(limit, 100) : 50;
    const effectiveSkillId = overrides.clearSkillAndMessageFilters
      ? ""
      : skillFilter.trim();
    const effectiveMessageId = overrides.clearSkillAndMessageFilters
      ? ""
      : messageIdFilter.trim();
    const effectiveMemoryId =
      overrides.memoryId !== undefined ? overrides.memoryId : memoryIdFilter.trim();

    if (!props.api) {
      setEvents(previewAuditEvents);
      setAuditNotice("本地预览审计日志，连接后会读取真实 Hermes 读信和操作记录。");
      return;
    }

    if (!props.accountId) {
      setEvents([]);
      setAuditNotice("请先添加邮箱并完成同步，再查看 Hermes 审计日志。");
      return;
    }

    setAuditBusy(true);
    setAuditNotice("正在读取 Hermes 审计日志...");
    try {
      const page = await props.api.listHermesAuditLog({
        accountId: props.accountId,
        ...(effectiveSkillId ? { skillId: effectiveSkillId } : {}),
        ...(effectiveMessageId ? { messageId: effectiveMessageId } : {}),
        ...(effectiveMemoryId ? { memoryId: effectiveMemoryId } : {}),
        limit: safeLimit,
      });
      setEvents(page.items);
      setAuditNotice(
        page.items.length === 0
          ? "没有匹配的 Hermes 审计事件。"
          : `已读取 ${page.items.length} 条 Hermes 审计事件。`,
      );
    } catch {
      setEvents([]);
      setAuditNotice("Hermes 审计日志暂时不可用。");
    } finally {
      setAuditBusy(false);
    }
  }

  useEffect(() => {
    void loadAuditEvents();
    // Filters are applied by the explicit refresh button to avoid reloading while typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.accountId, props.api]);

  useEffect(() => {
    if (!props.focusedMemoryId) {
      return;
    }

    setSkillFilter("");
    setMessageIdFilter("");
    setMemoryIdFilter(props.focusedMemoryId);
    void loadAuditEvents({
      memoryId: props.focusedMemoryId,
      clearSkillAndMessageFilters: true,
    });
    // Focus changes are user-triggered by the memory panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.focusedMemoryId]);

  return (
    <section className="settings-subpanel" aria-label="Hermes 审计日志">
      <header className="settings-panel-head">
        <div>
          <h3>审计日志</h3>
          <p>查看 Hermes 最近读取邮件、使用记忆和生成操作计划的记录。</p>
        </div>
        <button
          className="ghost-button"
          type="button"
          disabled={auditBusy}
          onClick={() => void loadAuditEvents()}
        >
          刷新审计
        </button>
      </header>

      <div className="audit-filter-grid">
        <label>
          <span>技能</span>
          <select
            aria-label="Hermes audit skill filter"
            value={skillFilter}
            onChange={(event) => setSkillFilter(event.target.value)}
          >
            <option value="">全部技能</option>
            <option value="email_search_qa">搜索问答</option>
            <option value="translate_text">翻译</option>
            <option value="thread_summarize">总结</option>
            <option value="reply_draft">写回复</option>
            <option value="quick_reply">快速回复</option>
            <option value="priority_triage">优先级</option>
            <option value="label_suggest">标签建议</option>
            <option value="newsletter_cleanup">订阅整理</option>
            <option value="action_item_extract">待办提取</option>
            <option value="followup_tracker">跟进识别</option>
            <option value="rewrite_polish">改写润色</option>
            <option value="action_plan">执行计划</option>
          </select>
        </label>
        <label>
          <span>邮件 ID</span>
          <input
            aria-label="Hermes audit message filter"
            value={messageIdFilter}
            onChange={(event) => setMessageIdFilter(event.target.value)}
            placeholder="message_..."
          />
        </label>
        <label>
          <span>记忆 ID</span>
          <input
            aria-label="Hermes audit memory filter"
            value={memoryIdFilter}
            onChange={(event) => setMemoryIdFilter(event.target.value)}
            placeholder="memory_..."
          />
        </label>
        <label>
          <span>数量</span>
          <input
            aria-label="Hermes audit limit"
            inputMode="numeric"
            value={limitText}
            onChange={(event) => setLimitText(event.target.value)}
          />
        </label>
      </div>

      <label className="field-toggle hermes-review-toggle">
        <input
          aria-label="Show Hermes audit events with memory usage"
          type="checkbox"
          checked={memoryEventsOnly}
          onChange={(event) => setMemoryEventsOnly(event.currentTarget.checked)}
        />
        <span>仅看使用记忆</span>
      </label>

      <div className="backend-notice compact" role="status">
        {auditNotice}
      </div>

      {props.focusedMemoryId ? (
        <div className="audit-focus-banner" role="status">
          <span>
            正在查看记忆使用记录：{props.focusedMemoryLabel ?? props.focusedMemoryId}
          </span>
          <button
            className="ghost-button"
            type="button"
            onClick={() => {
              setMemoryIdFilter("");
              props.onClearFocusedMemory?.();
              void loadAuditEvents({ memoryId: "" });
            }}
          >
            清除记忆过滤
          </button>
        </div>
      ) : null}

      <div className="task-list hermes-audit-list">
        {visibleEvents.map((event) => (
          <div
            className="task-row"
            key={event.id}
            aria-label={`Hermes audit event ${event.id}`}
          >
            <Sparkles size={19} />
            <div>
              <strong>{formatHermesAuditTitle(event)}</strong>
              <span>
                {formatHermesAuditEventType(event.eventType)} ·{" "}
                {formatHermesAuditTimestamp(event.createdAt)} · 读取{" "}
                {event.readMessageIds.length} 封邮件 · 使用{" "}
                {event.memoryIds.length} 条记忆
              </span>
              <span>{formatHermesAuditAction(event.action)}</span>
            </div>
          </div>
        ))}
        {visibleEvents.length === 0 ? (
          <div className="empty-search">没有 Hermes 审计事件。</div>
        ) : null}
      </div>
    </section>
  );
}

export function formatHermesMemoryLayer(layer: string) {
  const labels: Record<string, string> = {
    writing_style_profile: "写作风格",
    contact_memory: "联系人偏好",
    procedural_memory: "处理规则",
    semantic_profile: "语义偏好",
  };
  return labels[layer] ?? layer;
}

export function formatHermesAuditSkillId(skillId: string | undefined) {
  if (!skillId) {
    return "Hermes 操作";
  }

  const labels: Record<string, string> = {
    action_item_extract: "待办提取",
    action_plan: "执行计划",
    email_search_qa: "搜索问答",
    followup_tracker: "跟进识别",
    label_suggest: "标签建议",
    newsletter_cleanup: "订阅整理",
    priority_triage: "优先级判断",
    quick_reply: "快速回复",
    reply_draft: "写回复",
    rewrite_polish: "改写润色",
    memory_review: "记忆管理",
    rule_suggest: "规则建议",
    thread_summarize: "邮件总结",
    translate_text: "邮件翻译",
  };
  return labels[skillId] ?? skillId;
}

function formatHermesAuditTitle(event: HermesAuditLogEntryDto) {
  return event.skillTitle?.trim() || formatHermesAuditSkillId(event.skillId);
}

function formatHermesAuditEventType(eventType: string) {
  const labels: Record<string, string> = {
    "hermes.action_plan.confirmed": "确认执行计划",
    "hermes.action_plan.created": "生成执行计划",
    "hermes.skill.action_item_extract": "运行待办提取",
    "hermes.skill.email_search_qa": "运行搜索问答",
    "hermes.skill.followup_tracker": "运行跟进识别",
    "hermes.skill.label_suggest": "运行标签建议",
    "hermes.skill.newsletter_cleanup": "运行订阅整理",
    "hermes.skill.priority_triage": "运行优先级判断",
    "hermes.skill.quick_reply": "运行快速回复",
    "hermes.skill.reply_draft": "运行写回复",
    "hermes.skill.rewrite_polish": "运行改写润色",
    "hermes.skill.thread_summarize": "运行邮件总结",
    "hermes.skill.translate_text": "运行邮件翻译",
  };
  return labels[eventType] ?? eventType;
}

function formatHermesAuditTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatHermesAuditAction(action: Record<string, unknown>) {
  const labels: Record<string, string> = {
    applyToHistory: "回填历史",
    accountId: "账号",
    bucket: "分类",
    candidateId: "候选",
    currentBucket: "当前分类",
    editable: "可编辑",
    intent: "意图",
    labelId: "标签 ID",
    labelName: "标签",
    language: "语言",
    limit: "数量",
    mailboxId: "邮箱目录",
    memoryLayers: "记忆层",
    memoryScope: "记忆作用域",
    mode: "模式",
    planId: "计划",
    providerWriteback: "写回服务商",
    requiresUserConfirmation: "需确认",
    ruleId: "规则",
    scenario: "场景",
    sendsDirectly: "直接发送",
    searchPlan: "搜索条件",
    searchQuery: "搜索词",
    skillId: "技能",
    sourceLanguage: "源语言",
    status: "状态",
    targetLanguage: "目标语言",
    type: "类型",
  };
  const fields = Object.keys(labels);
  const parts = fields.flatMap((field) => {
    const value =
      field === "searchPlan"
        ? formatHermesAuditSearchPlan(action[field])
        : formatHermesAuditActionValue(action[field]);
    return value ? [`${labels[field]} ${value}`] : [];
  });

  return parts.length > 0
    ? `动作摘要：${parts.join(" · ")}`
    : "动作摘要：无可展示字段";
}

function formatHermesAuditActionValue(value: unknown): string | undefined {
  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? truncateHermesAuditValue(trimmed) : undefined;
  }

  if (Array.isArray(value)) {
    const items = value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 3)
      .map(truncateHermesAuditValue);
    return items.length > 0 ? items.join("、") : undefined;
  }

  return undefined;
}

function formatHermesAuditSearchPlan(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const filters = Array.isArray(record.filters)
    ? record.filters
        .flatMap((filter) => {
          if (!filter || typeof filter !== "object" || Array.isArray(filter)) {
            return [];
          }
          const label = (filter as Record<string, unknown>).label;
          return typeof label === "string" && label.trim()
            ? [truncateHermesAuditValue(label.trim())]
            : [];
        })
        .slice(0, 4)
    : [];
  if (filters.length > 0) {
    return filters.join("、");
  }

  const quickFilters = Array.isArray(record.quickFilters)
    ? record.quickFilters
        .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
        .map((item) => item.trim())
        .slice(0, 4)
    : [];
  if (quickFilters.length > 0) {
    return quickFilters.join("、");
  }

  return undefined;
}

function truncateHermesAuditValue(value: string): string {
  return value.length > 48 ? `${value.slice(0, 45)}...` : value;
}

function formatHermesMemoryContent(content: Record<string, unknown>) {
  return JSON.stringify(content, null, 2);
}

function parseHermesMemoryContent(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Hermes memory content must be an object.");
  }

  return parsed as Record<string, unknown>;
}

function parseHermesMemoryConfidence(value: string): number | undefined {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
    ? parsed
    : undefined;
}

function formatHermesPanelDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
