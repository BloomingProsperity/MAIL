import { createPortal } from "react-dom";
import type { Dispatch, KeyboardEvent, SetStateAction } from "react";
import {
  Bold,
  Clock3,
  FileText,
  Italic,
  Link2,
  List,
  Paperclip,
  Quote,
  Send,
  X,
} from "lucide-react";

import { composeBodyHtmlForPayload } from "../compose/rich-text";
import type { ComposeBodyFormat } from "../compose/rich-text";
import { ComposeReview } from "../compose/ComposeReview";
import { formatComposeWarnings } from "../compose/composeWarnings";
import { HermesComposeDraftTools } from "../hermes/HermesComposeAssistPanel";
import { HermesNotice } from "../hermes/HermesNotice";
import type { ComposeSurface, HermesNoticeState } from "./MailWorkspaceTypes";
import type {
  MailComposePreviewDto,
  MailDraftAttachmentDto,
  MailDraftDto,
  MailSendIdentityCandidateDto,
  MailSendIdentityDiagnosticsDto,
  MailSendIdentityDto,
  ScheduledSendDto,
} from "../../lib/emailHubApi";
import {
  candidateTargetMailboxValue,
  formatAttachmentSize,
  formatComposeAddressList,
  formatGraphDiagnosticsStatus,
  formatMailDate,
  formatScheduledSendStatus,
  formatSendIdentity,
  formatSendIdentityCandidateState,
  formatSendIdentityTargetState,
  hermesNoticeActionLabel,
  isoToDateTimeLocal,
} from "./mailWorkspaceUtils";

interface ComposeTemplate {
  id: string;
  label: string;
  subject: string;
  bodyText: string;
}

interface MailComposePanelsProps {
  composeSurface: ComposeSurface;
  composePortalTarget: Element | DocumentFragment | null;
  composeSurfaceClass: string;
  composeTitle: string;
  composeStatusParts: string[];
  composeNotice: string;
  composeNoticeState: HermesNoticeState;
  onOpenHermesRuntimeSettings: () => void;
  handleComposeWindowKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  closeComposeSurface: () => void;
  composeFrom: string;
  setComposeFrom: (value: string) => void;
  sendIdentities: MailSendIdentityDto[];
  setComposePreview: (value: MailComposePreviewDto | undefined) => void;
  composeAdvancedSenderOpen: boolean;
  setComposeAdvancedSenderOpen: Dispatch<SetStateAction<boolean>>;
  sendIdentityCandidates: MailSendIdentityCandidateDto[];
  graphCandidateAddress: string;
  setGraphCandidateAddress: (value: string) => void;
  graphCandidateName: string;
  setGraphCandidateName: (value: string) => void;
  graphCandidateType: "shared_mailbox" | "send_on_behalf" | "unknown";
  setGraphCandidateType: (value: "shared_mailbox" | "send_on_behalf" | "unknown") => void;
  composeBusy: boolean;
  addGraphSendIdentityCandidate: () => Promise<void>;
  graphDiagnosticsByCandidate: Record<string, MailSendIdentityDiagnosticsDto>;
  graphTargetMailboxes: Record<string, string>;
  setGraphTargetMailboxes: Dispatch<SetStateAction<Record<string, string>>>;
  verifyGraphSendIdentityCandidate: (candidate: MailSendIdentityCandidateDto) => Promise<void>;
  verifyGraphSendIdentityUserTarget: (candidate: MailSendIdentityCandidateDto) => Promise<void>;
  diagnoseGraphSendIdentityCandidate: (candidate: MailSendIdentityCandidateDto) => Promise<void>;
  composeTo: string;
  setComposeTo: (value: string) => void;
  composeCc: string;
  setComposeCc: (value: string) => void;
  composeBcc: string;
  setComposeBcc: (value: string) => void;
  composeSubject: string;
  setComposeSubject: (value: string) => void;
  composeTemplates: readonly ComposeTemplate[];
  insertComposeTemplate: (template: ComposeTemplate) => void;
  applyComposeBodyFormat: (format: ComposeBodyFormat) => void;
  composeBody: string;
  setComposeBody: (value: string) => void;
  invalidateComposeMessageRequest: () => void;
  addComposeAttachments: (files: FileList | null) => Promise<void>;
  composeAttachments: MailDraftAttachmentDto[];
  setComposeAttachments: Dispatch<SetStateAction<MailDraftAttachmentDto[]>>;
  composeTranslationSource: string;
  setComposeTranslationSource: (value: string) => void;
  composeTranslationTarget: string;
  setComposeTranslationTarget: (value: string) => void;
  translateComposedMail: () => Promise<void>;
  polishComposedMail: () => Promise<void>;
  previewComposedMail: () => Promise<void>;
  composePreview: MailComposePreviewDto | undefined;
  composeRichHtmlEnabled: boolean;
  composeScheduledAt: string;
  setComposeScheduledAt: (value: string) => void;
  submitComposedMail: (action: "save" | "send" | "schedule") => Promise<void>;
  mailDrafts: MailDraftDto[];
  draftsNotice: string;
  editMailDraft: (draft: MailDraftDto) => void;
  outboxItems: ScheduledSendDto[];
  outboxNotice: string;
  outboxBusyId: string | undefined;
  rescheduleTimes: Record<string, string>;
  setRescheduleTimes: Dispatch<SetStateAction<Record<string, string>>>;
  editOutboxItem: (item: ScheduledSendDto) => Promise<void>;
  rescheduleOutboxItem: (item: ScheduledSendDto) => Promise<void>;
  sendOutboxItemNow: (item: ScheduledSendDto) => Promise<void>;
  cancelOutboxItem: (item: ScheduledSendDto) => Promise<void>;
}

export function MailComposePanels(props: MailComposePanelsProps) {
  const {
    composeSurface,
    composePortalTarget,
    composeSurfaceClass,
    composeTitle,
    composeStatusParts,
    composeNotice,
    composeNoticeState,
    onOpenHermesRuntimeSettings,
    handleComposeWindowKeyDown,
    closeComposeSurface,
    composeFrom,
    setComposeFrom,
    sendIdentities,
    setComposePreview,
    composeAdvancedSenderOpen,
    setComposeAdvancedSenderOpen,
    sendIdentityCandidates,
    graphCandidateAddress,
    setGraphCandidateAddress,
    graphCandidateName,
    setGraphCandidateName,
    graphCandidateType,
    setGraphCandidateType,
    composeBusy,
    addGraphSendIdentityCandidate,
    graphDiagnosticsByCandidate,
    graphTargetMailboxes,
    setGraphTargetMailboxes,
    verifyGraphSendIdentityCandidate,
    verifyGraphSendIdentityUserTarget,
    diagnoseGraphSendIdentityCandidate,
    composeTo,
    setComposeTo,
    composeCc,
    setComposeCc,
    composeBcc,
    setComposeBcc,
    composeSubject,
    setComposeSubject,
    composeTemplates,
    insertComposeTemplate,
    applyComposeBodyFormat,
    composeBody,
    setComposeBody,
    invalidateComposeMessageRequest,
    addComposeAttachments,
    composeAttachments,
    setComposeAttachments,
    composeTranslationSource,
    setComposeTranslationSource,
    composeTranslationTarget,
    setComposeTranslationTarget,
    translateComposedMail,
    polishComposedMail,
    previewComposedMail,
    composePreview,
    composeRichHtmlEnabled,
    composeScheduledAt,
    setComposeScheduledAt,
    submitComposedMail,
    mailDrafts,
    draftsNotice,
    editMailDraft,
    outboxItems,
    outboxNotice,
    outboxBusyId,
    rescheduleTimes,
    setRescheduleTimes,
    editOutboxItem,
    rescheduleOutboxItem,
    sendOutboxItemNow,
    cancelOutboxItem,
  } = props;

  return (
    <>
      {composeSurface !== "closed" && composePortalTarget
        ? createPortal(
          <section
            className={composeSurfaceClass}
            aria-label={`${composeTitle}窗口`}
            role={composeSurface === "floating" ? "dialog" : "region"}
            onKeyDown={handleComposeWindowKeyDown}
          >
        <div className="compose-panel" aria-label="写邮件面板">
          <div className="compose-panel-head">
            <div>
              <strong>{composeTitle}</strong>
              <span>{composeStatusParts.join(" · ") || "当前账号"}</span>
            </div>
            <div className="compose-window-actions">
              <Send size={18} />
              <button
                className="icon-button"
                type="button"
                aria-label="关闭写信窗口"
                onClick={closeComposeSurface}
              >
                <X size={16} />
              </button>
            </div>
          </div>
          {composeNotice ? (
            <HermesNotice
              notice={composeNotice}
              actionLabel={hermesNoticeActionLabel(composeNoticeState.action)}
              onAction={
                composeNoticeState.action === "open_runtime_settings"
                  ? onOpenHermesRuntimeSettings
                  : undefined
              }
              compact
            />
          ) : null}
          <div className="compose-sender-row">
            <label className="compose-from-field">
              <span>发件人</span>
              <select
                aria-label="Compose from identity"
                value={composeFrom}
                disabled={sendIdentities.length === 0}
                onChange={(event) => {
                  setComposeFrom(event.target.value);
                  setComposePreview(undefined);
                }}
              >
                {sendIdentities.length === 0 ? (
                  <option value="">当前账号</option>
                ) : (
                  sendIdentities.map((identity) => (
                    <option key={identity.id} value={identity.id}>
                      {formatSendIdentity(identity)}
                    </option>
                  ))
                )}
              </select>
            </label>
            <button
              className="tiny-button compose-sender-toggle"
              type="button"
              aria-label="管理发件身份"
              aria-expanded={composeAdvancedSenderOpen}
              onClick={() => setComposeAdvancedSenderOpen((current) => !current)}
            >
              发件身份
              {sendIdentityCandidates.length > 0 ? (
                <strong>{sendIdentityCandidates.length}</strong>
              ) : null}
            </button>
          </div>
          {composeAdvancedSenderOpen ? (
          <div
            className="provider-candidate-box"
            aria-label="Outlook shared sender candidates"
          >
            <div className="provider-candidate-entry">
              <label>
                <span>Outlook 共享发件人</span>
                <input
                  aria-label="Outlook shared sender address"
                  value={graphCandidateAddress}
                  onChange={(event) => setGraphCandidateAddress(event.target.value)}
                  placeholder="shared@example.com"
                />
              </label>
              <label>
                <span>名称</span>
                <input
                  aria-label="Outlook shared sender name"
                  value={graphCandidateName}
                  onChange={(event) => setGraphCandidateName(event.target.value)}
                  placeholder="Team Inbox"
                />
              </label>
              <label>
                <span>类型</span>
                <select
                  aria-label="Outlook shared sender type"
                  value={graphCandidateType}
                  onChange={(event) =>
                    setGraphCandidateType(
                      event.target.value as typeof graphCandidateType,
                    )
                  }
                >
                  <option value="shared_mailbox">共享邮箱</option>
                  <option value="send_on_behalf">代表发送</option>
                  <option value="unknown">未知</option>
                </select>
              </label>
              <button
                className="tiny-button"
                type="button"
                aria-label="Add Outlook shared sender candidate"
                disabled={composeBusy}
                onClick={() => void addGraphSendIdentityCandidate()}
              >
                添加
              </button>
            </div>
            {sendIdentityCandidates.length > 0 ? (
              <div className="provider-candidate-list">
                {sendIdentityCandidates.map((candidate) => {
                  const diagnostics = graphDiagnosticsByCandidate[candidate.id];

                  return (
                    <div className="provider-candidate-row" key={candidate.id}>
                      <div className="provider-candidate-main">
                        <span>
                          {candidate.from.name
                            ? `${candidate.from.name} <${candidate.from.address}>`
                            : candidate.from.address}
                        </span>
                        <strong>{formatSendIdentityCandidateState(candidate)}</strong>
                      </div>
                      <label className="provider-target-field">
                        <span>目标邮箱</span>
                        <input
                          aria-label={`Outlook shared mailbox target ${candidate.from.address}`}
                          value={
                            graphTargetMailboxes[candidate.id] ??
                            candidateTargetMailboxValue(candidate)
                          }
                          disabled={
                            composeBusy ||
                            candidate.verificationState !== "verified" ||
                            !candidate.enabled
                          }
                          onChange={(event) =>
                            setGraphTargetMailboxes((current) => ({
                              ...current,
                              [candidate.id]: event.target.value,
                            }))
                          }
                          placeholder={candidate.from.address}
                        />
                      </label>
                      <strong>{formatSendIdentityTargetState(candidate)}</strong>
                      <div className="provider-candidate-actions">
                        <button
                          className="tiny-button"
                          type="button"
                          aria-label={`Verify Outlook shared sender ${candidate.from.address}`}
                          disabled={
                            composeBusy ||
                            (candidate.verificationState === "verified" &&
                              candidate.enabled)
                          }
                          onClick={() =>
                            void verifyGraphSendIdentityCandidate(candidate)
                          }
                        >
                          验证发件人
                        </button>
                        <button
                          className="tiny-button"
                          type="button"
                          aria-label={`Verify Outlook shared mailbox target ${candidate.from.address}`}
                          disabled={
                            composeBusy ||
                            candidate.verificationState !== "verified" ||
                            !candidate.enabled
                          }
                          onClick={() =>
                            void verifyGraphSendIdentityUserTarget(candidate)
                          }
                        >
                          验证共享箱
                        </button>
                        <button
                          className="tiny-button"
                          type="button"
                          aria-label={`Diagnose Outlook shared sender ${candidate.from.address}`}
                          disabled={composeBusy}
                          onClick={() =>
                            void diagnoseGraphSendIdentityCandidate(candidate)
                          }
                        >
                          诊断
                        </button>
                      </div>
                      {diagnostics ? (
                        <div
                          className="graph-diagnostics-box"
                          aria-label={`Outlook shared sender diagnostics ${candidate.from.address}`}
                        >
                          <strong>
                            {formatGraphDiagnosticsStatus(diagnostics.status)}
                          </strong>
                          <p>{diagnostics.summary}</p>
                          <div className="graph-diagnostic-checks">
                            {diagnostics.checks.map((check) => (
                              <span
                                key={check.id}
                                className={`diagnostic-${check.status}`}
                              >
                                {check.title}：{check.detail}
                              </span>
                            ))}
                          </div>
                          <ul>
                            {diagnostics.nextActions.map((action) => (
                              <li key={action}>{action}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
          ) : null}
          <div className="compose-recipient-grid">
            <label>
              <span>收件人</span>
              <input
                id="compose-recipients"
                aria-label="Compose recipients"
                value={composeTo}
                onChange={(event) => {
                  setComposeTo(event.target.value);
                  setComposePreview(undefined);
                }}
                placeholder="client@example.com, team@example.com"
              />
            </label>
            <label>
              <span>抄送</span>
              <input
                aria-label="Compose cc"
                value={composeCc}
                onChange={(event) => {
                  setComposeCc(event.target.value);
                  setComposePreview(undefined);
                }}
                placeholder="copy@example.com"
              />
            </label>
            <label>
              <span>密送</span>
              <input
                aria-label="Compose bcc"
                value={composeBcc}
                onChange={(event) => {
                  setComposeBcc(event.target.value);
                  setComposePreview(undefined);
                }}
                placeholder="audit@example.com"
              />
            </label>
          </div>
          <label>
            <span>主题</span>
            <input
              aria-label="Compose subject"
              value={composeSubject}
              onChange={(event) => {
                setComposeSubject(event.target.value);
                setComposePreview(undefined);
              }}
              placeholder="输入邮件主题"
            />
          </label>
          <div className="compose-editor-tools" aria-label="Compose editor tools">
            <div className="compose-template-row" aria-label="Compose templates">
              {composeTemplates.map((template) => (
                <button
                  className="tiny-button"
                  type="button"
                  key={template.id}
                  aria-label={`Insert compose template ${template.label}`}
                  disabled={composeBusy}
                  onClick={() => insertComposeTemplate(template)}
                >
                  {template.label}
                </button>
              ))}
            </div>
            <div className="compose-format-toolbar" aria-label="Compose format toolbar">
              <button
                className="tiny-icon-button"
                type="button"
                aria-label="Bold selected compose text"
                disabled={composeBusy}
                onClick={() => applyComposeBodyFormat("bold")}
              >
                <Bold size={14} />
              </button>
              <button
                className="tiny-icon-button"
                type="button"
                aria-label="Italic selected compose text"
                disabled={composeBusy}
                onClick={() => applyComposeBodyFormat("italic")}
              >
                <Italic size={14} />
              </button>
              <button
                className="tiny-icon-button"
                type="button"
                aria-label="List selected compose text"
                disabled={composeBusy}
                onClick={() => applyComposeBodyFormat("list")}
              >
                <List size={14} />
              </button>
              <button
                className="tiny-icon-button"
                type="button"
                aria-label="Link selected compose text"
                title="插入链接"
                disabled={composeBusy}
                onClick={() => applyComposeBodyFormat("link")}
              >
                <Link2 size={14} />
              </button>
              <button
                className="tiny-icon-button"
                type="button"
                aria-label="Quote selected compose text"
                title="引用"
                disabled={composeBusy}
                onClick={() => applyComposeBodyFormat("quote")}
              >
                <Quote size={14} />
              </button>
            </div>
          </div>
          <textarea
            id="compose-body"
            aria-label="Compose body"
            value={composeBody}
            onChange={(event) => {
              invalidateComposeMessageRequest();
              setComposeBody(event.target.value);
              setComposePreview(undefined);
            }}
            placeholder="写邮件正文，或先在右侧用 Hermes 生成回复草稿"
          />
          <label className="compose-file-button">
            <Paperclip size={15} />
            <span>添加附件</span>
            <input
              aria-label="Attach files to compose"
              type="file"
              multiple
              disabled={composeBusy}
              onChange={(event) => {
                void addComposeAttachments(event.currentTarget.files);
                event.currentTarget.value = "";
              }}
            />
          </label>
          {composeAttachments.length > 0 ? (
            <div className="compose-attachment-list" aria-label="Compose attachments">
              {composeAttachments.map((attachment) => (
                <div className="compose-attachment-row" key={attachment.attachmentId}>
                  <Paperclip size={15} />
                  <div>
                    <strong>{attachment.filename}</strong>
                    <span>
                      {formatAttachmentSize(attachment.byteSize)}
                      {attachment.inline ? " · 内联" : ""}
                    </span>
                  </div>
                  <button
                    className="tiny-button"
                    type="button"
                    aria-label={`Remove attachment ${attachment.filename}`}
                    disabled={composeBusy}
                    onClick={() => {
                      setComposeAttachments((current) =>
                        current.filter((item) => item.attachmentId !== attachment.attachmentId),
                      );
                      setComposePreview(undefined);
                    }}
                  >
                    移除
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <HermesComposeDraftTools
            sourceLanguage={composeTranslationSource}
            targetLanguage={composeTranslationTarget}
            busy={composeBusy}
            onSourceLanguageChange={setComposeTranslationSource}
            onTargetLanguageChange={setComposeTranslationTarget}
            onTranslate={() => void translateComposedMail()}
            onPolish={() => void polishComposedMail()}
            onPreview={() => void previewComposedMail()}
          />
          {composePreview ? (
            <ComposeReview
              preview={composePreview}
              bodyText={composeBody}
              controlledBodyHtml={composeBodyHtmlForPayload(
                composeBody,
                composeRichHtmlEnabled,
              )}
              attachments={composeAttachments}
              warningsText={formatComposeWarnings(composePreview.warnings)}
            />
          ) : null}
          <div className="compose-schedule-row">
            <label>
              <span>发送时间</span>
              <input
                aria-label="Compose scheduled time"
                type="datetime-local"
                value={composeScheduledAt}
                onChange={(event) => setComposeScheduledAt(event.target.value)}
              />
            </label>
          </div>
          <div className="composer-actions">
            <button
              className="ghost-button"
              type="button"
              aria-label="Save composed draft"
              disabled={composeBusy}
              onClick={() => void submitComposedMail("save")}
            >
              保存草稿
            </button>
            <button
              className="ghost-button"
              type="button"
              aria-label="Schedule composed draft"
              disabled={composeBusy}
              onClick={() => void submitComposedMail("schedule")}
            >
              定时发送
            </button>
            <button
              className="primary-button"
              type="button"
              aria-label="Send composed draft now"
              disabled={composeBusy}
              onClick={() => void submitComposedMail("send")}
            >
              立即发送
            </button>
          </div>
        </div>

        <div className="drafts-panel" aria-label="草稿列表">
          <div className="compose-panel-head">
            <div>
              <strong>草稿</strong>
              <span>{mailDrafts.length} 封可编辑</span>
            </div>
            <FileText size={18} />
          </div>
          {draftsNotice ? (
            <div className="backend-notice compact" role="status">
              {draftsNotice}
            </div>
          ) : null}
          {mailDrafts.length === 0 ? (
            <div className="empty-drafts">
              {draftsNotice ? "无法读取保存草稿。" : "当前没有保存草稿。"}
            </div>
          ) : (
            <div className="draft-list">
              {mailDrafts.map((draft) => {
                const recipients = formatComposeAddressList(draft.to);
                const attachmentCount = draft.attachments?.length ?? 0;
                return (
                  <div className="draft-row" key={draft.id}>
                    <div>
                      <strong>{draft.subject || "无主题草稿"}</strong>
                      <span>
                        {recipients || "未填写收件人"} · {formatMailDate(draft.updatedAt)}
                      </span>
                      {attachmentCount > 0 ? (
                        <em>{attachmentCount} 个附件</em>
                      ) : null}
                    </div>
                    <button
                      className="tiny-button"
                      type="button"
                      aria-label={`编辑草稿 ${draft.subject || "无主题草稿"}`}
                      disabled={composeBusy}
                      onClick={() => editMailDraft(draft)}
                    >
                      编辑
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="outbox-panel" aria-label="待发队列">
          <div className="compose-panel-head">
            <div>
              <strong>待发队列</strong>
              <span>{outboxItems.length} 封待处理</span>
            </div>
            <Clock3 size={18} />
          </div>
          {outboxNotice ? (
            <div className="backend-notice compact" role="status">
              {outboxNotice}
            </div>
          ) : null}
          {outboxItems.length === 0 ? (
            <div className="empty-outbox">当前没有待发邮件。</div>
          ) : (
            <div className="outbox-list">
              {outboxItems.map((item) => (
                <div className="outbox-row" key={item.id}>
                  <div>
                    <strong>定时邮件</strong>
                    <span>
                      {formatScheduledSendStatus(item.status)} ·{" "}
                      {formatMailDate(item.scheduledAt)}
                    </span>
                    {item.lastError ? <em>{item.lastError}</em> : null}
                  </div>
                  <input
                    aria-label="调整发送时间"
                    type="datetime-local"
                    value={rescheduleTimes[item.id] ?? isoToDateTimeLocal(item.scheduledAt)}
                    disabled={!item.canEdit || outboxBusyId === item.id}
                    onChange={(event) =>
                      setRescheduleTimes((current) => ({
                        ...current,
                        [item.id]: event.target.value,
                      }))
                    }
                  />
                  <div className="outbox-actions">
                    <button
                      className="tiny-button"
                      type="button"
                      aria-label="编辑待发邮件"
                      disabled={!item.canEdit || outboxBusyId === item.id}
                      onClick={() => void editOutboxItem(item)}
                    >
                      编辑
                    </button>
                    <button
                      className="tiny-button"
                      type="button"
                      aria-label="调整待发时间"
                      disabled={!item.canEdit || outboxBusyId === item.id}
                      onClick={() => void rescheduleOutboxItem(item)}
                    >
                      改时间
                    </button>
                    <button
                      className="tiny-button"
                      type="button"
                      aria-label="立即发送待发邮件"
                      disabled={!item.canSendNow || outboxBusyId === item.id}
                      onClick={() => void sendOutboxItemNow(item)}
                    >
                      立即发送
                    </button>
                    <button
                      className="tiny-button danger"
                      type="button"
                      aria-label="取消待发邮件"
                      disabled={!item.canDelete || outboxBusyId === item.id}
                      onClick={() => void cancelOutboxItem(item)}
                    >
                      取消
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
          </section>,
          composePortalTarget,
        )
        : null}
    </>
  );
}
