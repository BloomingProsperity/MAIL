export interface HermesNoticeProps {
  notice: string;
  compact?: boolean;
  className?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function HermesNotice(props: HermesNoticeProps) {
  const className = props.className
    ? `${props.className} hermes-actionable-notice`
    : props.compact
      ? "backend-notice compact hermes-actionable-notice"
      : "backend-notice hermes-actionable-notice";
  return (
    <div className={className} role="status">
      <span>{props.notice}</span>
      {props.actionLabel && props.onAction ? (
        <button type="button" onClick={props.onAction}>
          {props.actionLabel}
        </button>
      ) : null}
    </div>
  );
}
