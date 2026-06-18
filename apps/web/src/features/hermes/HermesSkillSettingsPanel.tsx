import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ShieldCheck, Sparkles, Undo2 } from "lucide-react";
import type {
  EmailHubApi,
  HermesResourceProfileDto,
  HermesSkillDto,
  HermesSkillMode,
  HermesSkillRequiredPermission,
} from "../../lib/emailHubApi";

type SkillModeFilter = "all" | HermesSkillMode;

const BULK_SKILL_SAVE_ID = "__all__";

const skillModeFilters: Array<{ id: SkillModeFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "read", label: "读信" },
  { id: "draft", label: "写作" },
  { id: "classify", label: "整理" },
  { id: "learn", label: "学习" },
];

const fallbackHermesSkills: HermesSkillDto[] = [
  fallbackHermesSkill("thread_summarize", "线程总结", "read", "总结线程状态、争议点和下一步"),
  fallbackHermesSkill("reply_draft", "生成回复草稿", "draft", "根据上下文生成可编辑回复", {
    requireConfirmation: true,
  }),
  fallbackHermesSkill("rewrite_polish", "改写润色", "draft", "缩短、扩写或调整语气", {
    requireConfirmation: true,
  }),
  fallbackHermesSkill("quick_reply", "快速短回复", "draft", "生成确认、拒绝、推进等短回复", {
    requireConfirmation: true,
  }),
  fallbackHermesSkill("email_search_qa", "自然语言查邮件", "read", "把问题转成搜索并总结结果"),
  fallbackHermesSkill("action_item_extract", "提取待办", "read", "识别负责人、期限和承诺"),
  fallbackHermesSkill("priority_triage", "优先级判断", "classify", "给出优先级和理由"),
  fallbackHermesSkill("label_suggest", "建议标签", "classify", "建议标签、归档、稍后"),
  fallbackHermesSkill("newsletter_cleanup", "订阅清理", "classify", "识别订阅和营销邮件"),
  fallbackHermesSkill("followup_tracker", "跟进追踪", "read", "识别待回复和等待对方回复"),
  fallbackHermesSkill(
    "translate_text",
    "翻译邮件",
    "read",
    "翻译邮件正文、选中文本或草稿，保留格式和语气",
  ),
  fallbackHermesSkill("action_plan", "执行计划", "learn", "把自然语言邮箱操作转成可确认计划", {
    allowMemoryWrite: true,
    requireConfirmation: true,
  }),
  fallbackHermesSkill("rule_suggest", "规则建议", "learn", "从重复行为生成候选规则", {
    requireConfirmation: true,
  }),
  fallbackHermesSkill("memory_review", "记忆管理", "learn", "查看、修改、删除偏好", {
    allowBodyRead: false,
    allowMemoryWrite: true,
    requireConfirmation: true,
  }),
];

const fallbackHermesResourceProfile: HermesResourceProfileDto = {
  skills: {
    total: fallbackHermesSkills.length,
    enabled: fallbackHermesSkills.filter((skill) => skill.settings.enabled).length,
    bodyReadEnabled: fallbackHermesSkills.filter(
      (skill) => skill.settings.enabled && skill.settings.allowBodyRead,
    ).length,
    memoryWriteEnabled: fallbackHermesSkills.filter(
      (skill) => skill.settings.enabled && skill.settings.allowMemoryWrite,
    ).length,
    confirmationRequired: fallbackHermesSkills.filter(
      (skill) => skill.settings.enabled && skill.settings.requireConfirmation,
    ).length,
    maxContextCharsPerRun: 24000,
    maxMemoryItemsPerRun: 6,
    enabledContextBudgetChars:
      fallbackHermesSkills.filter((skill) => skill.settings.enabled).length * 24000,
    enabledMemoryBudgetItems:
      fallbackHermesSkills.filter((skill) => skill.settings.enabled).length * 6,
  },
  retention: {
    retentionDays: 30,
    cleanupIntervalMs: 60 * 60 * 1000,
    cleanupLimit: 500,
    managedTables: [
      "hermes_message_translations",
      "hermes_message_summaries",
      "hermes_action_plans",
      "hermes_feedback",
      "hermes_audit_events",
      "hermes_skill_runs",
    ],
  },
  deployment: {
    profile: "medium",
    recommendedMinimum: {
      cpuCores: 2,
      memoryGb: 6,
      diskGb: 30,
    },
    localModelRecommendedMinimum: {
      cpuCores: 6,
      memoryGb: 24,
      diskGb: 80,
    },
  },
  guardrails: [
    "Context is capped per capability before model calls and audit persistence.",
    "Custom capability instructions are length capped and appended below system rules.",
    "Memory fan-out is capped per capability through item limits.",
    "State-changing learning paths must pass capability permission and confirmation checks.",
  ],
};

export function HermesSkillSettingsPanel(props: {
  api?: EmailHubApi;
  focusedSkillId?: string;
  focusedPermission?: HermesSkillRequiredPermission;
  focusRequestId?: number;
}) {
  const [skills, setSkills] = useState<HermesSkillDto[]>(fallbackHermesSkills);
  const [savedSkills, setSavedSkills] =
    useState<HermesSkillDto[]>(fallbackHermesSkills);
  const [resourceProfile, setResourceProfile] = useState<HermesResourceProfileDto>(
    fallbackHermesResourceProfile,
  );
  const [modeFilter, setModeFilter] = useState<SkillModeFilter>("all");
  const [showUnsavedOnly, setShowUnsavedOnly] = useState(false);
  const [savingSkillId, setSavingSkillId] = useState<string>();
  const [notice, setNotice] = useState("正在读取 Hermes 能力选项...");
  const focusedSkillRef = useRef<HTMLElement | null>(null);
  const focusedSkillControlRef = useRef<HTMLInputElement | null>(null);
  const handledFocusRequestRef = useRef("");
  const savedSkillsById = useMemo(
    () => new Map(savedSkills.map((skill) => [skill.id, skill])),
    [savedSkills],
  );
  const unsavedSkills = useMemo(
    () =>
      skills.filter((skill) =>
        isHermesSkillUnsaved(skill, savedSkillsById),
      ),
    [skills, savedSkillsById],
  );
  const unsavedSkillIds = useMemo(
    () => new Set(unsavedSkills.map((skill) => skill.id)),
    [unsavedSkills],
  );
  const visibleSkills = skills.filter((skill) => {
    return (
      (modeFilter === "all" || skill.mode === modeFilter) &&
      (!showUnsavedOnly || unsavedSkillIds.has(skill.id))
    );
  });
  const isSavingAnySkill = Boolean(savingSkillId);

  useEffect(() => {
    if (!props.focusedSkillId) {
      return;
    }

    const focusRequestKey = [
      props.focusRequestId ?? 0,
      props.focusedSkillId,
      props.focusedPermission ?? "enabled",
    ].join(":");
    if (handledFocusRequestRef.current === focusRequestKey) {
      return;
    }

    const focusedSkill = skills.find((skill) => skill.id === props.focusedSkillId);
    setShowUnsavedOnly(false);
    setModeFilter(focusedSkill?.mode ?? "all");
    if (focusedSkill) {
      handledFocusRequestRef.current = focusRequestKey;
    }
  }, [
    props.focusRequestId,
    props.focusedSkillId,
    props.focusedPermission,
    skills,
  ]);

  useEffect(() => {
    if (!props.focusedSkillId || !focusedSkillRef.current) {
      return;
    }

    const focusTarget =
      focusedSkillControlRef.current ?? focusedSkillRef.current;
    focusTarget.focus({ preventScroll: true });
    focusedSkillRef.current.scrollIntoView?.({
      block: "center",
      behavior: "smooth",
    });
  }, [
    props.focusRequestId,
    props.focusedSkillId,
    props.focusedPermission,
    visibleSkills.length,
  ]);

  useEffect(() => {
    let alive = true;

    if (!props.api) {
      setSkills(fallbackHermesSkills);
      setSavedSkills(fallbackHermesSkills);
      setResourceProfile(fallbackHermesResourceProfile);
      setNotice("本地预览能力选项，连接后会保存到后端。");
      return () => {
        alive = false;
      };
    }

    void Promise.all([
      props.api.listHermesSkills(),
      props.api.getHermesResourceProfile(),
    ])
      .then(([items, profile]) => {
        if (!alive) return;
        setSkills(items);
        setSavedSkills(items);
        setResourceProfile(profile);
        setNotice("能力选项已同步。");
      })
      .catch(() => {
        if (!alive) return;
        setSkills(fallbackHermesSkills);
        setSavedSkills(fallbackHermesSkills);
        setResourceProfile(fallbackHermesResourceProfile);
        setNotice("暂时无法读取能力选项，已使用本地兜底。");
      });

    return () => {
      alive = false;
    };
  }, [props.api]);

  function updateLocalSkill(
    skillId: string,
    patch: Partial<HermesSkillDto["settings"]>,
  ) {
    setSkills((current) =>
      current.map((skill) =>
        skill.id === skillId
          ? {
              ...skill,
              settings: {
                ...skill.settings,
                ...patch,
              },
            }
          : skill,
      ),
    );
  }

  function resetLocalSkill(skill: HermesSkillDto) {
    const saved = savedSkillsById.get(skill.id);
    if (!saved) {
      return;
    }

    setSkills((current) =>
      current.map((item) =>
        item.id === skill.id
          ? {
              ...item,
              settings: { ...saved.settings },
            }
          : item,
      ),
    );
    setNotice(`已撤回未保存更改：${saved.title}。`);
  }

  async function saveSkill(skill: HermesSkillDto) {
    if (!props.api) {
      setSavedSkills((current) =>
        current.map((item) => (item.id === skill.id ? skill : item)),
      );
      setNotice(`预览已更新：${skill.title}。`);
      return;
    }

    setSavingSkillId(skill.id);
    setNotice(`正在保存：${skill.title}...`);
    try {
      const saved = await props.api.updateHermesSkillSettings({
        skillId: skill.id,
        patch: skill.settings,
      });
      setSkills((current) =>
        current.map((item) => (item.id === saved.id ? saved : item)),
      );
      setSavedSkills((current) =>
        current.map((item) => (item.id === saved.id ? saved : item)),
      );
      try {
        setResourceProfile(await props.api.getHermesResourceProfile());
        setNotice(`能力选项已保存：${saved.title}，资源画像已刷新。`);
      } catch {
        setNotice(`能力选项已保存：${saved.title}，资源画像暂时未刷新。`);
      }
    } catch {
      setNotice(`保存失败：${skill.title}。`);
    } finally {
      setSavingSkillId(undefined);
    }
  }

  async function saveAllChangedSkills() {
    if (unsavedSkills.length === 0) {
      setNotice("没有需要保存的能力选项。");
      return;
    }

    if (!props.api) {
      setSavedSkills(skills);
      setNotice(`预览已保存 ${unsavedSkills.length} 个能力选项。`);
      return;
    }

    const api = props.api;
    setSavingSkillId(BULK_SKILL_SAVE_ID);
    setNotice(`正在保存 ${unsavedSkills.length} 个能力选项...`);
    try {
      const results = await Promise.allSettled(
        unsavedSkills.map((skill) =>
          api.updateHermesSkillSettings({
            skillId: skill.id,
            patch: skill.settings,
          }),
        ),
      );
      const saved = results
        .filter(
          (result): result is PromiseFulfilledResult<HermesSkillDto> =>
            result.status === "fulfilled",
        )
        .map((result) => result.value);
      const savedById = new Map(saved.map((skill) => [skill.id, skill]));

      if (saved.length > 0) {
        setSkills((current) =>
          current.map((item) => savedById.get(item.id) ?? item),
        );
        setSavedSkills((current) =>
          current.map((item) => savedById.get(item.id) ?? item),
        );
      }

      let profileRefreshed = false;
      if (saved.length > 0) {
        try {
          setResourceProfile(await api.getHermesResourceProfile());
          profileRefreshed = true;
        } catch {
          profileRefreshed = false;
        }
      }

      if (saved.length === unsavedSkills.length) {
        setNotice(
          `已保存 ${saved.length} 个能力选项，资源画像${
            profileRefreshed ? "已刷新" : "暂时未刷新"
          }。`,
        );
        return;
      }

      setNotice(
        `已保存 ${saved.length} 个能力选项，${unsavedSkills.length - saved.length} 个保存失败，资源画像${
          profileRefreshed ? "已刷新" : "暂时未刷新"
        }。`,
      );
    } finally {
      setSavingSkillId(undefined);
    }
  }

  return (
    <section className="hermes-skill-settings" aria-label="Hermes skill settings">
      <header className="settings-panel-head">
        <div>
          <h3>能力选项与预算</h3>
          <p>每个能力都可以独立限制正文读取、记忆写入、确认门槛和上下文预算。</p>
        </div>
        <button
          className="ghost-button"
          type="button"
          aria-label="Save all changed Hermes skill settings"
          disabled={unsavedSkills.length === 0 || isSavingAnySkill}
          onClick={() => void saveAllChangedSkills()}
        >
          <CheckCircle2 size={15} aria-hidden="true" />
          {savingSkillId === BULK_SKILL_SAVE_ID
            ? "保存中"
            : `保存全部${unsavedSkills.length > 0 ? ` (${unsavedSkills.length})` : ""}`}
        </button>
      </header>

      <div
        className="settings-card-grid maintenance-grid"
        aria-label="Hermes resource profile"
      >
        <article className="settings-module maintenance-stat">
          <span>启用技能</span>
          <strong>
            {resourceProfile.skills.enabled}/{resourceProfile.skills.total}
          </strong>
          <p>{resourceProfile.skills.bodyReadEnabled} 个允许读取正文</p>
        </article>
        <article className="settings-module maintenance-stat">
          <span>单次上下文上限</span>
          <strong>
            {resourceProfile.skills.maxContextCharsPerRun.toLocaleString()}
          </strong>
          <p>
            总预算{" "}
            {resourceProfile.skills.enabledContextBudgetChars.toLocaleString()} 字符
          </p>
        </article>
        <article className="settings-module maintenance-stat">
          <span>记忆扇出</span>
          <strong>{resourceProfile.skills.maxMemoryItemsPerRun}</strong>
          <p>{resourceProfile.skills.memoryWriteEnabled} 个技能允许写入记忆</p>
        </article>
        <article className="settings-module maintenance-stat">
          <span>部署档位</span>
          <strong>{formatHermesDeploymentProfile(resourceProfile.deployment.profile)}</strong>
          <p>
            {resourceProfile.deployment.recommendedMinimum.cpuCores}C /{" "}
            {resourceProfile.deployment.recommendedMinimum.memoryGb}GB RAM /{" "}
            {resourceProfile.deployment.recommendedMinimum.diskGb}GB disk
          </p>
        </article>
      </div>

      <div className="backend-notice compact" role="note">
        Hermes 保留 {resourceProfile.retention.retentionDays} 天数据，清理间隔{" "}
        {Math.round(resourceProfile.retention.cleanupIntervalMs / 60000)} 分钟，
        每批最多 {resourceProfile.retention.cleanupLimit.toLocaleString()} 行。
        本地模型建议至少{" "}
        {resourceProfile.deployment.localModelRecommendedMinimum.cpuCores}C /{" "}
        {resourceProfile.deployment.localModelRecommendedMinimum.memoryGb}GB RAM /{" "}
        {resourceProfile.deployment.localModelRecommendedMinimum.diskGb}GB disk。
      </div>

      {resourceProfile.guardrails.length > 0 ? (
        <div
          className="diagnostic-list compact"
          aria-label="Hermes resource guardrails"
        >
          {resourceProfile.guardrails.map((guardrail) => (
            <div className="diagnostic-row" key={guardrail}>
              <ShieldCheck size={18} />
              <div>
                <strong>{formatHermesGuardrail(guardrail)}</strong>
                <span>上下文与保留治理</span>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="hermes-skill-filter-row">
        <div className="hermes-skill-mode-filter" aria-label="Hermes skill mode filter">
          {skillModeFilters.map((filter) => (
            <button
              key={filter.id}
              className={
                filter.id === modeFilter ? "ghost-button is-active" : "ghost-button"
              }
              type="button"
              aria-label={`Show Hermes skill mode ${filter.id}`}
              aria-pressed={filter.id === modeFilter}
              onClick={() => setModeFilter(filter.id)}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <label className="field-toggle">
          <input
            type="checkbox"
            checked={showUnsavedOnly}
            onChange={(event) => setShowUnsavedOnly(event.currentTarget.checked)}
          />
          <span>仅看未保存</span>
        </label>
      </div>

      <div className="skill-grid compact hermes-skill-grid">
        {visibleSkills.map((skill) => {
          const hasUnsavedChanges = unsavedSkillIds.has(skill.id);
          const isFocusedSkill = skill.id === props.focusedSkillId;
          const focusedControl = isFocusedSkill
            ? props.focusedPermission ?? "enabled"
            : undefined;
          return (
            <article
              key={skill.id}
              ref={isFocusedSkill ? focusedSkillRef : undefined}
              className={
                isFocusedSkill
                  ? "skill-card hermes-skill-card is-focused"
                  : "skill-card hermes-skill-card"
              }
              aria-label={
                isFocusedSkill ? `Focused Hermes skill ${skill.title}` : undefined
              }
              tabIndex={isFocusedSkill ? -1 : undefined}
            >
              <Sparkles size={18} />
              <div className="hermes-skill-card-body">
                <div className="skill-card-head">
                  <strong>{skill.title}</strong>
                  <span>{formatHermesSkillMode(skill.mode)}</span>
                </div>
                <span>{skill.description}</span>

                <div className="hermes-skill-toggles">
                  <label className="field-toggle">
                    <input
                      ref={
                        focusedControl === "enabled"
                          ? focusedSkillControlRef
                          : undefined
                      }
                      aria-label={`Enable Hermes skill ${skill.title}`}
                      type="checkbox"
                      disabled={isSavingAnySkill}
                      checked={skill.settings.enabled}
                      onChange={(event) =>
                        updateLocalSkill(skill.id, {
                          enabled: event.currentTarget.checked,
                        })
                      }
                    />
                    <span>启用</span>
                  </label>
                  <label className="field-toggle">
                    <input
                      ref={
                        focusedControl === "body_read"
                          ? focusedSkillControlRef
                          : undefined
                      }
                      aria-label={`Allow Hermes body reads ${skill.title}`}
                      type="checkbox"
                      disabled={isSavingAnySkill}
                      checked={skill.settings.allowBodyRead}
                      onChange={(event) =>
                        updateLocalSkill(skill.id, {
                          allowBodyRead: event.currentTarget.checked,
                        })
                      }
                    />
                    <span>读取正文</span>
                  </label>
                  <label className="field-toggle">
                    <input
                      ref={
                        focusedControl === "memory_write"
                          ? focusedSkillControlRef
                          : undefined
                      }
                      aria-label={`Allow Hermes memory writes ${skill.title}`}
                      type="checkbox"
                      disabled={isSavingAnySkill}
                      checked={skill.settings.allowMemoryWrite}
                      onChange={(event) =>
                        updateLocalSkill(skill.id, {
                          allowMemoryWrite: event.currentTarget.checked,
                        })
                      }
                    />
                    <span>写入记忆</span>
                  </label>
                  <label className="field-toggle">
                    <input
                      aria-label={`Require Hermes confirmation ${skill.title}`}
                      type="checkbox"
                      disabled={isSavingAnySkill}
                      checked={skill.settings.requireConfirmation}
                      onChange={(event) =>
                        updateLocalSkill(skill.id, {
                          requireConfirmation: event.currentTarget.checked,
                        })
                      }
                    />
                    <span>操作确认</span>
                  </label>
                </div>

                <div className="hermes-skill-budget-grid">
                  <label>
                    <span>上下文字符</span>
                    <input
                      aria-label={`Hermes skill max context ${skill.title}`}
                      type="number"
                      min={skill.settingBounds.maxContextChars.min}
                      max={skill.settingBounds.maxContextChars.max}
                      step={skill.settingBounds.maxContextChars.step}
                      disabled={isSavingAnySkill}
                      value={skill.settings.maxContextChars}
                      onChange={(event) =>
                        updateLocalSkill(skill.id, {
                          maxContextChars: clampHermesSkillInteger(
                            event.currentTarget.value,
                            skill.settings.maxContextChars,
                            skill.settingBounds.maxContextChars,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>记忆条数</span>
                    <input
                      aria-label={`Hermes skill memory limit ${skill.title}`}
                      type="number"
                      min={skill.settingBounds.memoryLimit.min}
                      max={skill.settingBounds.memoryLimit.max}
                      step={skill.settingBounds.memoryLimit.step}
                      disabled={isSavingAnySkill}
                      value={skill.settings.memoryLimit}
                      onChange={(event) =>
                        updateLocalSkill(skill.id, {
                          memoryLimit: clampHermesSkillInteger(
                            event.currentTarget.value,
                            skill.settings.memoryLimit,
                            skill.settingBounds.memoryLimit,
                          ),
                        })
                      }
                    />
                  </label>
                </div>

                <label className="hermes-skill-custom-instructions">
                  <span>自定义指令</span>
                  <textarea
                    aria-label={`Hermes skill custom instructions ${skill.title}`}
                    maxLength={skill.settingBounds.customInstructions.maxLength}
                    rows={4}
                    disabled={isSavingAnySkill}
                    value={skill.settings.customInstructions}
                    onChange={(event) =>
                      updateLocalSkill(skill.id, {
                        customInstructions: event.currentTarget.value,
                      })
                    }
                  />
                  <span>
                    {skill.settings.customInstructions.length.toLocaleString()} /{" "}
                    {skill.settingBounds.customInstructions.maxLength.toLocaleString()}
                  </span>
                </label>

                <div className="inline-actions">
                  <button
                    className="ghost-button"
                    type="button"
                    aria-label={`Reset Hermes skill settings ${skill.title}`}
                    disabled={!hasUnsavedChanges || isSavingAnySkill}
                    onClick={() => resetLocalSkill(skill)}
                  >
                    <Undo2 size={15} aria-hidden="true" />
                    撤回更改
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    aria-label={`Save Hermes skill settings ${skill.title}`}
                    disabled={!hasUnsavedChanges || isSavingAnySkill}
                    onClick={() => void saveSkill(skill)}
                  >
                    <CheckCircle2 size={15} aria-hidden="true" />
                    {savingSkillId === skill.id ? "保存中" : "保存选项"}
                  </button>
                  <span
                    className={
                      hasUnsavedChanges
                        ? "hermes-skill-sync-status unsaved"
                        : "hermes-skill-sync-status"
                    }
                  >
                    {hasUnsavedChanges ? "未保存" : "已同步"} ·{" "}
                    {skill.settings.maxContextChars.toLocaleString()} 字符 ·{" "}
                    {skill.settings.memoryLimit} 条记忆
                  </span>
                </div>
              </div>
            </article>
          );
        })}
        {visibleSkills.length === 0 ? (
          <div className="empty-search">没有匹配的 Hermes 能力。</div>
        ) : null}
      </div>

      <div className="backend-notice compact" role="status">
        {notice}
      </div>
    </section>
  );
}

function fallbackHermesSkill(
  id: string,
  title: string,
  mode: HermesSkillDto["mode"],
  description: string,
  settings: Partial<HermesSkillDto["settings"]> = {},
): HermesSkillDto {
  return {
    id,
    title,
    mode,
    description,
    settings: {
      enabled: true,
      maxContextChars: 24000,
      memoryLimit: 6,
      allowBodyRead: true,
      allowMemoryWrite: false,
      requireConfirmation: false,
      customInstructions: "",
      ...settings,
    },
    settingBounds: {
      maxContextChars: { min: 1000, max: 200000, step: 1000 },
      memoryLimit: { min: 0, max: 50, step: 1 },
      customInstructions: { maxLength: 2000 },
    },
  };
}

function formatHermesSkillMode(mode: HermesSkillDto["mode"]): string {
  const labels: Record<HermesSkillDto["mode"], string> = {
    read: "读取",
    draft: "草稿",
    classify: "分类",
    learn: "学习",
  };
  return labels[mode];
}

function formatHermesDeploymentProfile(
  profile: HermesResourceProfileDto["deployment"]["profile"],
): string {
  const labels: Record<HermesResourceProfileDto["deployment"]["profile"], string> = {
    small: "轻量",
    medium: "标准",
    large: "高负载",
  };
  return labels[profile];
}

function formatHermesGuardrail(guardrail: string): string {
  const labels: Record<string, string> = {
    "Prompt context is capped per skill before provider calls and audit persistence.":
      "调用前按单项能力预算截断上下文，并按实际内容审计。",
    "Context is capped per capability before model calls and audit persistence.":
      "调用前按单项能力预算截断上下文，并按实际内容审计。",
    "Skill custom instructions are length capped and appended below system rules.":
      "自定义能力指令有长度上限，并且优先级低于系统规则。",
    "Custom capability instructions are length capped and appended below system rules.":
      "自定义能力指令有长度上限，并且优先级低于系统规则。",
    "Memory fan-out is capped per skill through memoryLimit.":
      "每项能力按记忆条数上限读取，避免记忆扇出失控。",
    "Memory fan-out is capped per capability through item limits.":
      "每项能力按记忆条数上限读取，避免记忆扇出失控。",
    "State-changing learning paths must pass skill permission and confirmation checks.":
      "会改变状态的学习路径必须通过能力权限和确认门槛。",
    "State-changing learning paths must pass capability permission and confirmation checks.":
      "会改变状态的学习路径必须通过能力权限和确认门槛。",
    "Retention cleanup prunes expired Hermes caches, plans, feedback, audit events, and skill runs in bounded batches.":
      "保留清理会分批删除过期缓存、计划、反馈、审计和运行记录。",
    "Prompt context is capped per skill.":
      "调用前按单项能力预算截断上下文。",
  };

  return labels[guardrail] ?? guardrail;
}

function clampHermesSkillInteger(
  value: string,
  current: number,
  bounds: { min: number; max: number },
): number {
  const next = Number(value);
  if (!Number.isFinite(next)) {
    return current;
  }

  return Math.min(bounds.max, Math.max(bounds.min, Math.trunc(next)));
}

function isHermesSkillUnsaved(
  skill: HermesSkillDto,
  savedSkillsById: Map<string, HermesSkillDto>,
): boolean {
  const savedSkill = savedSkillsById.get(skill.id);
  return savedSkill
    ? !areHermesSkillSettingsEqual(skill.settings, savedSkill.settings)
    : false;
}

function areHermesSkillSettingsEqual(
  a: HermesSkillDto["settings"],
  b: HermesSkillDto["settings"],
): boolean {
  return (
    a.enabled === b.enabled &&
    a.maxContextChars === b.maxContextChars &&
    a.memoryLimit === b.memoryLimit &&
    a.allowBodyRead === b.allowBodyRead &&
    a.allowMemoryWrite === b.allowMemoryWrite &&
    a.requireConfirmation === b.requireConfirmation &&
    a.customInstructions === b.customInstructions
  );
}
