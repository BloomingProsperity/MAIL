import type { HermesSkillRequiredPermission } from "../../lib/emailHubApi";

export interface HermesNoticeProps {
  notice: string;
  skillId?: string;
  requiredPermission?: HermesSkillRequiredPermission;
  compact?: boolean;
  className?: string;
  onOpenSkillSettings?: (
    skillId: string,
    requiredPermission?: HermesSkillRequiredPermission,
  ) => void;
}

export function HermesNotice(props: HermesNoticeProps) {
  const className = props.className
    ? `${props.className} hermes-actionable-notice`
    : props.compact
      ? "backend-notice compact hermes-actionable-notice"
      : "backend-notice hermes-actionable-notice";
  const canOpenSkillSettings = Boolean(props.skillId && props.onOpenSkillSettings);

  function openSkillSettings() {
    if (!props.skillId) {
      return;
    }
    props.onOpenSkillSettings?.(props.skillId, props.requiredPermission);
  }

  return (
    <div className={className} role="status">
      <span>{props.notice}</span>
      {canOpenSkillSettings ? (
        <button type="button" onClick={openSkillSettings}>
          打开能力选项
        </button>
      ) : null}
    </div>
  );
}
