import { ApiRequestError } from "../../lib/emailHubApi";
import { hermesSkillDisabledNotice } from "../hermes/hermesRules";
import type { MailItem } from "./mail-items";
import type {
  AttachmentDownload,
  HermesMessageTranslationResult,
  HermesSkillRequiredPermission,
  MailComposeSeedAttachmentDto,
  MailDraftAttachmentDto,
  MailDraftDto,
  MailQuickFilter,
  MailSendIdentityCandidateDto,
  MailSendIdentityDiagnosticsDto,
  MailSendIdentityDto,
  MessageDetailDto,
  ScheduledSendDto,
} from "../../lib/emailHubApi";
import type {
  ComposeAutosaveStatus,
  ComposeDraftSignatureInput,
  HermesNoticeAction,
} from "./MailWorkspaceTypes";
export function hasBackendAccountId(accountId: string): boolean {
  return Boolean(accountId && accountId !== "preview");
}

export function focusComposeTarget(target: "to" | "body"): void {
  const elementId = target === "to" ? "compose-recipients" : "compose-body";
  document.getElementById(elementId)?.focus();
}

export function previewSendIdentities(accountId: string): MailSendIdentityDto[] {
  return [
    {
      id: "account:preview",
      accountId,
      from: { address: "work@demo.site", name: "Work" },
      source: "account",
      isDefault: true,
      verified: true,
    },
  ];
}

export function upsertSendIdentityCandidate(
  candidates: MailSendIdentityCandidateDto[],
  candidate: MailSendIdentityCandidateDto,
): MailSendIdentityCandidateDto[] {
  const next = candidates.filter((item) => item.id !== candidate.id);
  return [...next, candidate].sort((left, right) =>
    left.from.address.localeCompare(right.from.address),
  );
}

export function formatSendIdentity(identity: MailSendIdentityDto): string {
  const label = identity.from.name
    ? `${identity.from.name} <${identity.from.address}>`
    : identity.from.address;
  const markers = [
    ...(identity.isDefault ? ["默认"] : []),
    ...(identity.source === "domain_alias" ? ["域名别名"] : []),
    ...(identity.source === "provider_native"
      ? [providerNativeIdentityLabel(identity)]
      : []),
  ];
  return markers.length > 0 ? `${label} · ${markers.join(" · ")}` : label;
}

export function formatSendIdentityCandidateState(
  candidate: MailSendIdentityCandidateDto,
): string {
  if (candidate.verificationState === "verified" && candidate.enabled) {
    return "已验证";
  }
  if (candidate.verificationState === "failed") {
    return candidate.verificationError
      ? `失败 ${candidate.verificationError}`
      : "失败";
  }
  if (candidate.verificationState === "pending") {
    return "待验证";
  }
  return "未验证";
}

export function formatSendIdentityTargetState(
  candidate: MailSendIdentityCandidateDto,
): string {
  if (
    candidate.sendMailTargetMode === "users" &&
    candidate.userSendMailEligible
  ) {
    return "共享发件箱已启用";
  }
  if (candidate.userTargetVerificationError) {
    return `目标失败 ${candidate.userTargetVerificationError}`;
  }
  if (candidate.verificationState === "verified" && candidate.enabled) {
    return "可选目标邮箱";
  }
  return "先验证发件人";
}

export function formatGraphDiagnosticsStatus(
  status: MailSendIdentityDiagnosticsDto["status"],
): string {
  const labels: Record<MailSendIdentityDiagnosticsDto["status"], string> = {
    ready: "诊断通过",
    needs_from_verification: "需要验证发件人",
    from_verification_failed: "发件人权限失败",
    target_verification_recommended: "建议验证共享箱",
    target_verification_failed: "共享箱目标失败",
  };
  return labels[status];
}

export function composeAttachmentUploadErrorNotice(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 413 || error.code === "request_body_too_large") {
      return "附件超过 25 MB，请压缩或拆分后再上传。";
    }
    if (error.code === "compose_attachment_storage_unavailable") {
      return "附件存储未配置，暂时不能上传附件。";
    }
  }

  return "附件上传失败。";
}

export function candidateTargetMailboxValue(
  candidate: MailSendIdentityCandidateDto,
): string {
  return (
    candidate.targetMailbox?.userPrincipalName ??
    candidate.targetMailbox?.userId ??
    candidate.from.address
  );
}

export function mergeGraphTargetMailboxValues(
  current: Record<string, string>,
  candidates: MailSendIdentityCandidateDto[],
): Record<string, string> {
  const next = { ...current };
  for (const candidate of candidates) {
    if (!next[candidate.id]) {
      next[candidate.id] = candidateTargetMailboxValue(candidate);
    }
  }
  return next;
}

function providerNativeIdentityLabel(identity: MailSendIdentityDto): string {
  const provider = identity.provider ? providerLabel(identity.provider) : "服务商";
  const typeLabel: Partial<Record<NonNullable<MailSendIdentityDto["identityType"]>, string>> = {
    alias: "授权别名",
    shared_mailbox: "共享邮箱",
    send_on_behalf: "代表发送",
    group: "群组身份",
  };
  const suffix = identity.identityType
    ? typeLabel[identity.identityType]
    : undefined;
  return suffix ? `${provider}${suffix}` : `${provider}授权`;
}

function providerLabel(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "gmail" || normalized === "google") {
    return "Gmail";
  }
  if (
    normalized === "graph" ||
    normalized === "outlook" ||
    normalized === "microsoft"
  ) {
    return "Outlook";
  }
  return provider.trim() || "服务商";
}

export function formatComposeAddressList(addresses: Array<{ address: string; name?: string }>): string {
  return addresses
    .map((address) =>
      address.name ? `${address.name} <${address.address}>` : address.address,
    )
    .join(", ");
}

export function composeDraftSignature(input: ComposeDraftSignatureInput): string {
  return JSON.stringify({
    accountId: input.accountId,
    from: input.from ? normalizedComposeAddress(input.from) : null,
    to: input.to.map(normalizedComposeAddress),
    cc: input.cc.map(normalizedComposeAddress),
    bcc: input.bcc.map(normalizedComposeAddress),
    subject: input.subject.trim(),
    bodyText: input.bodyText.trim(),
    source: input.source,
    attachments: (input.attachments ?? []).map((attachment) => ({
      id: attachment.id,
      source: attachment.source,
      attachmentId: attachment.attachmentId,
      storageKey: attachment.storageKey ?? null,
      filename: attachment.filename,
      contentType: attachment.contentType,
      byteSize: attachment.byteSize,
      inline: attachment.inline,
      contentId: attachment.contentId ?? null,
    })),
    replyToMessageId: input.replyToMessageId ?? null,
    sourceMessageId: input.sourceMessageId ?? null,
    hermesSkillRunId: input.hermesSkillRunId ?? null,
    hermesDraftText: input.hermesDraftText ?? null,
    bodyHtml: input.bodyHtml ?? null,
  });
}

export function composeDraftSignatureFromDraft(draft: MailDraftDto): string {
  return composeDraftSignature({
    accountId: draft.accountId,
    from: draft.from,
    to: draft.to,
    cc: draft.cc,
    bcc: draft.bcc,
    subject: draft.subject,
    bodyText: draft.bodyText ?? "",
    bodyHtml: draft.bodyHtml,
    source: draft.source,
    attachments: draft.attachments,
    replyToMessageId: draft.replyToMessageId,
    sourceMessageId: draft.sourceMessageId,
    hermesSkillRunId: draft.hermesSkillRunId,
    hermesDraftText: draft.hermesDraftText,
  });
}

function normalizedComposeAddress(address: { address: string; name?: string }) {
  const name = address.name?.trim();
  return {
    address: address.address.trim().toLowerCase(),
    ...(name ? { name } : {}),
  };
}

export function formatComposeAutosaveStatus(status: ComposeAutosaveStatus): string {
  switch (status) {
    case "pending":
      return "自动保存待处理";
    case "saving":
      return "自动保存中";
    case "saved":
      return "已自动保存";
    case "error":
      return "自动保存失败";
    case "idle":
      return "";
  }
}

export function formatScheduledSendStatus(status: ScheduledSendDto["status"]): string {
  switch (status) {
    case "scheduled":
      return "已定时";
    case "queued":
      return "等待发送";
    case "sending":
      return "发送中";
    case "sent":
      return "已发送";
    case "cancelled":
      return "已取消";
    case "failed":
      return "发送失败";
    case "dead_letter":
      return "需要处理";
  }
}

export function hermesReplyMemoryInput(
  selectedMail: MailItem | undefined,
): { memoryScope: string } {
  if (!selectedMail?.email) {
    return { memoryScope: "global" };
  }

  return {
    memoryScope: `recipient:${selectedMail.email}`,
  };
}

export function readerTranslationPreferenceSourceLanguage(
  translation: HermesMessageTranslationResult,
  selectedSourceLanguage: string,
): string | undefined {
  if (translation.sourceLanguage !== "auto") {
    return translation.sourceLanguage;
  }

  return selectedSourceLanguage !== "auto" ? selectedSourceLanguage : undefined;
}

export function UndoDoneNotice(props: { onUndoDone: () => void }) {
  return (
    <div className="backend-notice" role="status">
      已标记完成。
      <button type="button" aria-label="撤销完成" onClick={props.onUndoDone}>
        撤销
      </button>
    </div>
  );
}

export function aggregateMessageFilterForFolder(folderId: string): {
  mailboxRole?: string;
  quickFilters?: MailQuickFilter[];
  hasAttachment?: boolean;
} {
  if (
    folderId === "inbox" ||
    folderId === "drafts" ||
    folderId === "sent" ||
    folderId === "archive" ||
    folderId === "junk" ||
    folderId === "trash"
  ) {
    return { mailboxRole: folderId };
  }

  if (folderId === "flagged" || folderId === "starred") {
    return { quickFilters: ["starred"] };
  }

  if (folderId === "snoozed") {
    return { quickFilters: ["snoozed"] };
  }

  if (folderId === "attachments") {
    return { hasAttachment: true };
  }

  return {};
}

export function hermesSkillErrorNotice(
  error: unknown,
  input: {
    skillId: string;
    fallback: string;
    unavailable?: Record<string, string>;
  },
): string {
  if (error instanceof ApiRequestError) {
    if (error.code === "hermes_skill_disabled") {
      return hermesSkillDisabledNotice(
        error.skillId ?? input.skillId,
        error.requiredPermission,
      );
    }
    if (error.code === "hermes_runtime_not_configured") {
      return "Hermes 暂时不可用。";
    }
    const unavailableNotice = input.unavailable?.[error.code];
    if (unavailableNotice) {
      return unavailableNotice;
    }
  }

  return input.fallback;
}

export function hermesNoticeActionFromError(
  error: unknown,
): HermesNoticeAction | undefined {
  return error instanceof ApiRequestError &&
    error.code === "hermes_runtime_not_configured"
    ? "open_runtime_settings"
    : undefined;
}

export function hermesNoticeActionLabel(
  action: HermesNoticeAction | undefined,
): string | undefined {
  return action === "open_runtime_settings" ? "设置 Hermes" : undefined;
}

export function hermesDisabledSkillRequiredPermissionFromError(
  error: unknown,
): HermesSkillRequiredPermission | undefined {
  if (
    error instanceof ApiRequestError &&
    error.code === "hermes_skill_disabled"
  ) {
    return error.requiredPermission;
  }

  return undefined;
}

export function messageRecipientSummary(detail: MessageDetailDto | undefined): string {
  if (!detail) {
    return "收件人：我";
  }

  const parts = [
    `收件人：${formatAddressList(detail.to)}`,
  ];
  if (detail.cc.length > 0) {
    parts.push(`抄送：${formatAddressList(detail.cc)}`);
  }
  return parts.join(" · ");
}

function formatAddressList(addresses: string[]): string {
  if (addresses.length === 0) {
    return "无";
  }
  const visible = addresses.slice(0, 3);
  const suffix = addresses.length > visible.length ? ` 等 ${addresses.length} 人` : "";
  return `${visible.join("、")}${suffix}`;
}

export function messageReaderText(
  detail: MessageDetailDto | undefined,
  mail: MailItem,
): string {
  const bodyText = detail?.bodyText?.trim();
  if (bodyText) {
    return bodyText;
  }

  const bodyHtml = detail?.bodyHtml?.trim();
  if (bodyHtml) {
    return htmlToReadableText(bodyHtml);
  }

  return (detail?.snippet ?? mail.preview).trim();
}

function htmlToReadableText(html: string): string {
  if (typeof document !== "undefined") {
    const template = document.createElement("template");
    template.innerHTML = html;
    template.content
      .querySelectorAll("script, style, noscript, template")
      .forEach((node) => node.remove());
    return normalizeReaderText(template.content.textContent ?? "");
  }

  return normalizeReaderText(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, " ")
      .replace(/<[^>]*>/g, " "),
  );
}

function normalizeReaderText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatMailTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

export function formatMailDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}

export function parseComposeRecipients(value: string): Array<{ address: string; name?: string }> {
  return value
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const displayMatch = /^(.*?)<([^>]+)>$/.exec(part);
      if (displayMatch) {
        const name = displayMatch[1]?.trim().replace(/^"|"$/g, "");
        const address = displayMatch[2]?.trim() ?? "";
        return name ? { address, name } : { address };
      }

      return { address: part };
    })
    .filter((recipient) => recipient.address.includes("@"));
}

export function defaultScheduleDateTimeLocal(): string {
  return dateToDateTimeLocal(new Date(Date.now() + 60 * 60 * 1000));
}

export function parseDateTimeLocal(value: string): string | undefined {
  if (!value.trim()) {
    return undefined;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return date.toISOString();
}

export function isoToDateTimeLocal(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return dateToDateTimeLocal(date);
}

function dateToDateTimeLocal(date: Date): string {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function seedRescheduleTimes(
  current: Record<string, string>,
  items: ScheduledSendDto[],
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const item of items) {
    next[item.id] = current[item.id] ?? isoToDateTimeLocal(item.scheduledAt);
  }

  return next;
}

export function composeAttachmentFromSeed(
  attachment: MailComposeSeedAttachmentDto,
): MailDraftAttachmentDto {
  return {
    id: attachment.id,
    source: "message_attachment",
    attachmentId: attachment.id,
    filename: attachment.filename,
    contentType: attachment.contentType,
    byteSize: attachment.byteSize,
    inline: attachment.inline,
  };
}

export async function composeAttachmentFromFile(
  file: File,
  accountId: string,
): Promise<MailDraftAttachmentDto> {
  const contentBase64 = await fileToBase64(file);
  const attachmentId = `upload_${accountId}_${Date.now()}_${Math.random()
    .toString(16)
    .slice(2)}_${file.name}_${file.size}_${file.lastModified}`;
  return {
    id: attachmentId,
    source: "uploaded_file",
    attachmentId,
    filename: file.name || "attachment",
    contentType: file.type || "application/octet-stream",
    byteSize: file.size,
    inline: false,
    contentBase64,
  };
}

async function fileToBase64(file: File): Promise<string> {
  if (typeof file.arrayBuffer !== "function") {
    return fileToBase64WithReader(file);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  return btoa(binary);
}

function fileToBase64WithReader(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("file read failed"));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const marker = "base64,";
      const index = result.indexOf(marker);
      if (index < 0) {
        reject(new Error("file read failed"));
        return;
      }
      resolve(result.slice(index + marker.length));
    };
    reader.readAsDataURL(file);
  });
}

export function saveAttachmentDownload(
  download: AttachmentDownload,
  fallbackFilename: string,
): void {
  const objectUrl = URL.createObjectURL(download.blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = sanitizeDownloadFilename(download.filename, fallbackFilename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

function sanitizeDownloadFilename(filename: string, fallbackFilename: string): string {
  const safeName = (filename || fallbackFilename || "attachment")
    .replace(/[\\/\0\r\n]/g, "_")
    .trim();
  return safeName || "attachment";
}

export function formatAttachmentSize(byteSize: number): string {
  if (byteSize >= 1024 * 1024) {
    return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.ceil(byteSize / 1024))} KB`;
}

export function bucketLabel(bucket: string): string {
  if (bucket.includes("Urgent")) return "优先";
  if (bucket.includes("Important")) return "重要";
  if (bucket.includes("Feed")) return "动态";
  if (bucket.includes("Transactions")) return "通知";
  return "邮件";
}
