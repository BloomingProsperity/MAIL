import type { MailComposePreviewDto } from "../../lib/emailHubApi";

const COMPOSE_WARNING_LABELS: Record<
  MailComposePreviewDto["warnings"][number],
  string
> = {
  missing_recipient: "缺少收件人",
  missing_body: "缺少正文",
  missing_subject: "缺少主题",
  large_body: "正文过大",
  duplicate_recipient: "收件人重复",
  possible_missing_attachment: "可能缺少附件",
  external_recipient_warning: "包含外部收件人",
};

export function formatComposeWarnings(
  warnings: MailComposePreviewDto["warnings"],
): string {
  return warnings.map((warning) => COMPOSE_WARNING_LABELS[warning]).join("，");
}
