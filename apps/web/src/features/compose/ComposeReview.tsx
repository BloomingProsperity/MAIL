import type {
  MailComposePreviewDto,
  MailDraftAttachmentDto,
} from "../../lib/emailHubApi";

export interface ComposeReviewProps {
  preview: MailComposePreviewDto;
  bodyText: string;
  controlledBodyHtml?: string;
  attachments: MailDraftAttachmentDto[];
  warningsText: string;
}

export function ComposeReview(props: ComposeReviewProps) {
  const bodyText = props.bodyText.trim();

  return (
    <div className="compose-review" role="status" aria-label="Compose review">
      <div className="compose-review-head">
        <strong>{props.preview.readyToSend ? "可发送预览" : "预览待处理"}</strong>
        <span>
          {props.preview.to.length} 收件人 ·{" "}
          {formatReviewBytes(props.preview.estimatedSizeBytes)}
        </span>
      </div>
      <div className="compose-review-meta">
        <span>{props.preview.subject || "无主题"}</span>
        {props.warningsText ? <em>{props.warningsText}</em> : null}
      </div>
      <div className="compose-review-body" aria-label="Compose review body">
        {props.controlledBodyHtml ? (
          <div dangerouslySetInnerHTML={{ __html: props.controlledBodyHtml }} />
        ) : (
          <p>{bodyText || "正文为空"}</p>
        )}
      </div>
      <div
        className="compose-review-attachments"
        aria-label="Compose review attachments"
      >
        <strong>附件 {props.attachments.length}</strong>
        {props.attachments.length > 0 ? (
          <ul>
            {props.attachments.map((attachment) => (
              <li key={attachment.attachmentId}>
                <span>{attachment.filename}</span>
                <em>{formatReviewBytes(attachment.byteSize)}</em>
              </li>
            ))}
          </ul>
        ) : (
          <span>无附件</span>
        )}
      </div>
    </div>
  );
}

function formatReviewBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (bytes >= 1024) {
    return `${Math.ceil(bytes / 1024)} KB`;
  }

  return `${bytes} B`;
}
