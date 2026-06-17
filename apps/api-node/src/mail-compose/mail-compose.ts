import { Buffer } from "node:buffer";

import type {
  AttachmentDto,
  MailReadStore,
  MessageDetailDto,
} from "../mail-read/mail-read-store.js";

export class InvalidMailComposeRequestError extends Error {
  readonly code = "invalid_mail_compose_request";

  constructor(message = "invalid mail compose request") {
    super(message);
  }
}

export interface HermesDraftFeedbackStore {
  recordDraftFeedback(input: {
    skillRunId: string;
    draftText: string;
    finalText: string;
    subject?: string;
    recipientEmail?: string;
  }): Promise<unknown>;
}

export interface MailAddress {
  address: string;
  name?: string;
}

export type MailSendIdentitySource =
  | "account"
  | "domain_alias"
  | "provider_native";
export type MailSendIdentityType =
  | "account"
  | "alias"
  | "shared_mailbox"
  | "send_on_behalf"
  | "group"
  | "unknown";

export interface MailSendIdentity {
  id: string;
  accountId: string;
  from: MailAddress;
  source: MailSendIdentitySource;
  isDefault: boolean;
  verified: boolean;
  provider?: string;
  providerIdentityId?: string;
  identityType?: MailSendIdentityType;
}

export type MailSendIdentityVerificationState =
  | "verified"
  | "pending"
  | "unverified"
  | "failed";

export interface MailSendIdentityCandidate extends MailSendIdentity {
  provider: string;
  providerIdentityId: string;
  identityType: MailSendIdentityType;
  verificationState: MailSendIdentityVerificationState;
  enabled: boolean;
  verificationRecipient: MailAddress;
  verificationError?: string;
  sendMailTargetMode?: "me" | "users";
  userSendMailEligible?: boolean;
  targetMailbox?: {
    userId?: string;
    userPrincipalName?: string;
  };
  sentItemsBehavior?: "signed_in_user" | "from_mailbox";
  userTargetVerificationError?: string;
}

export type MailSendIdentityDiagnosticStatus =
  | "ready"
  | "needs_from_verification"
  | "from_verification_failed"
  | "target_verification_recommended"
  | "target_verification_failed";

export type MailSendIdentityDiagnosticCheckStatus =
  | "pass"
  | "warning"
  | "fail"
  | "info";

export interface MailSendIdentityDiagnosticCheck {
  id: string;
  status: MailSendIdentityDiagnosticCheckStatus;
  title: string;
  detail: string;
  action?: string;
}

export interface MailSendIdentityDiagnostics {
  accountId: string;
  candidateId: string;
  provider: "graph";
  generatedAt: string;
  from: MailAddress;
  identityType: MailSendIdentityType;
  status: MailSendIdentityDiagnosticStatus;
  summary: string;
  sendPath: "unavailable" | "me" | "users";
  sentItemsBehavior: "unknown" | "signed_in_user" | "from_mailbox";
  discoverySupported: false;
  checks: MailSendIdentityDiagnosticCheck[];
  nextActions: string[];
  candidate: MailSendIdentityCandidate;
}

export type MailDraftStatus =
  | "draft"
  | "scheduled"
  | "sending"
  | "sent"
  | "failed";
export type MailDraftSource =
  | "manual"
  | "hermes_reply"
  | "reply"
  | "reply_all"
  | "forward";
export type MailComposeSeedMode = "reply" | "reply_all" | "forward";
export type MailThreadingAction = "reply" | "reply_all";
export type MailEngineProvider = "emailengine" | "native";
export type MailAccountSyncState = "syncing" | "reauth_required" | "paused";
export type ScheduledSendStatus =
  | "scheduled"
  | "queued"
  | "sending"
  | "sent"
  | "cancelled"
  | "failed"
  | "dead_letter";

const MAX_DRAFT_ATTACHMENTS = 20;
export const MAX_DRAFT_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export type MailDraftAttachmentSource = "message_attachment" | "uploaded_file";

export interface MailDraftAttachment {
  id: string;
  source: MailDraftAttachmentSource;
  attachmentId: string;
  storageKey?: string;
  filename: string;
  contentType: string;
  byteSize: number;
  inline: boolean;
  contentId?: string;
}

export interface MailDraftTransportAttachment extends MailDraftAttachment {
  providerAttachmentId?: string;
  contentBase64?: string;
}

export interface CreateMailDraftAttachmentInput {
  source?: MailDraftAttachmentSource;
  attachmentId: string;
  storageKey?: string;
  filename?: string;
  contentType?: string;
  byteSize?: number;
  inline?: boolean;
  contentId?: string;
  contentBase64?: string;
}

export interface MailSendAttachment {
  filename: string;
  contentType: string;
  byteSize: number;
  inline: boolean;
  contentId?: string;
  providerAttachmentId?: string;
  contentBase64?: string;
  storageKey?: string;
}

export interface MailDraft {
  id: string;
  accountId: string;
  from?: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  status: MailDraftStatus;
  source: MailDraftSource;
  replyToMessageId?: string;
  sourceMessageId?: string;
  attachments?: MailDraftAttachment[];
  threading?: MailThreading;
  hermesSkillRunId?: string;
  hermesDraftText?: string;
  providerQueueId?: string;
  providerMessageId?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
}

export interface MailDraftPage {
  accountId: string;
  items: MailDraft[];
}

export interface MailComposeAccount {
  accountId: string;
  email: string;
  syncState: MailAccountSyncState;
  engineProvider: MailEngineProvider;
}

export interface DraftWithAccount {
  draft: MailDraft;
  account: MailComposeAccount;
  transportAttachments?: MailDraftTransportAttachment[];
}

export interface ScheduledSend {
  id: string;
  accountId: string;
  draftId: string;
  scheduledAt: string;
  status: ScheduledSendStatus;
  attempts: number;
  maxAttempts: number;
  notBefore: string;
  canEdit: boolean;
  canSendNow: boolean;
  canDelete: boolean;
  providerQueueId?: string;
  providerMessageId?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
  cancelledAt?: string;
  completedAt?: string;
}

export interface ScheduledSendWithDraft {
  scheduledSend: ScheduledSend;
  draft: MailDraft;
  account: MailComposeAccount;
  transportAttachments?: MailDraftTransportAttachment[];
}

export interface ScheduledSendDraftDetail {
  scheduledSend: ScheduledSend;
  draft: MailDraft;
}

export interface CreateMailDraftInput {
  accountId: string;
  from?: MailAddress;
  to: MailAddress[];
  cc?: MailAddress[];
  bcc?: MailAddress[];
  subject?: string;
  bodyText?: string;
  bodyHtml?: string;
  source?: MailDraftSource;
  replyToMessageId?: string;
  sourceMessageId?: string;
  attachments?: CreateMailDraftAttachmentInput[];
  hermesSkillRunId?: string;
  hermesDraftText?: string;
}

export interface UpdateMailDraftInput extends CreateMailDraftInput {
  draftId: string;
}

export interface UpdateScheduledMailDraftInput extends CreateMailDraftInput {
  scheduledId: string;
}

export interface MailComposeSeedAttachment {
  id: string;
  filename: string;
  contentType: string;
  byteSize: number;
  inline: boolean;
}

export type MailComposePreviewWarning =
  | "missing_recipient"
  | "missing_body"
  | "missing_subject"
  | "large_body";

export interface MailComposeSeed {
  accountId: string;
  messageId: string;
  mode: MailComposeSeedMode;
  from?: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  source: MailDraftSource;
  replyToMessageId?: string;
  sourceMessageId: string;
  attachments: MailComposeSeedAttachment[];
  warnings: MailComposePreviewWarning[];
  generatedAt: string;
}

export interface MailComposePreview {
  accountId: string;
  from?: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  source: MailDraftSource;
  replyToMessageId?: string;
  sourceMessageId?: string;
  attachments?: MailDraftAttachment[];
  warnings: MailComposePreviewWarning[];
  estimatedSizeBytes: number;
  readyToSend: boolean;
  generatedAt: string;
}

export interface MailComposeSeedInput {
  accountId: string;
  messageId: string;
  mode: MailComposeSeedMode;
  from?: MailAddress;
}

export interface MailComposePreviewInput {
  accountId: string;
  from?: MailAddress;
  to?: MailAddress[];
  cc?: MailAddress[];
  bcc?: MailAddress[];
  subject?: string;
  bodyText?: string;
  bodyHtml?: string;
  source?: MailDraftSource;
  replyToMessageId?: string;
  sourceMessageId?: string;
  attachments?: CreateMailDraftAttachmentInput[];
}

export interface MailThreading {
  action: MailThreadingAction;
  inReplyTo?: string;
  references: string[];
  emailEngineMessageId?: string;
  gmailThreadId?: string;
  graphMessageId?: string;
}

export interface MailComposeStore {
  createDraft(
    input: Required<Pick<CreateMailDraftInput, "accountId" | "to">> & {
      id: string;
      from?: MailAddress;
      cc: MailAddress[];
      bcc: MailAddress[];
      subject: string;
      bodyText?: string;
      bodyHtml?: string;
      source: MailDraftSource;
      replyToMessageId?: string;
      sourceMessageId?: string;
      attachments?: MailDraftTransportAttachment[];
      threading?: MailThreading;
      hermesSkillRunId?: string;
      hermesDraftText?: string;
      now: string;
    },
  ): Promise<MailDraft>;
  listDrafts(input: {
    accountId: string;
    limit: number;
  }): Promise<MailDraft[]>;
  updateDraft(
    input: Required<Pick<UpdateMailDraftInput, "accountId" | "draftId" | "to">> & {
      from?: MailAddress;
      cc: MailAddress[];
      bcc: MailAddress[];
      subject: string;
      bodyText?: string;
      bodyHtml?: string;
      source: MailDraftSource;
      replyToMessageId?: string;
      sourceMessageId?: string;
      attachments?: MailDraftTransportAttachment[];
      threading?: MailThreading;
      hermesSkillRunId?: string;
      hermesDraftText?: string;
      now: string;
    },
  ): Promise<MailDraft | undefined>;
  getDraftWithAccount(input: {
    accountId: string;
    draftId: string;
  }): Promise<DraftWithAccount | undefined>;
  claimDraftForSend(input: {
    accountId: string;
    draftId: string;
    leaseOwner: string;
    leaseExpiresAt: string;
    now: string;
  }): Promise<DraftWithAccount | undefined>;
  markDraftSent(input: {
    accountId: string;
    draftId: string;
    providerQueueId?: string;
    providerMessageId?: string;
    sentAt: string;
  }): Promise<MailDraft>;
  markDraftFailed(input: {
    accountId: string;
    draftId: string;
    errorMessage: string;
  }): Promise<MailDraft | undefined>;
  createScheduledSend(input: {
    id: string;
    accountId: string;
    draftId: string;
    scheduledAt: string;
    notBefore: string;
    status: Extract<ScheduledSendStatus, "scheduled" | "queued">;
    idempotencyKey: string;
    now: string;
  }): Promise<ScheduledSend | undefined>;
  listScheduledSends(input: {
    accountId: string;
    limit: number;
  }): Promise<ScheduledSend[]>;
  getScheduledDraft(input: {
    accountId: string;
    scheduledId: string;
  }): Promise<ScheduledSendWithDraft | undefined>;
  updateScheduledDraft(
    input: Required<
      Pick<UpdateScheduledMailDraftInput, "accountId" | "scheduledId" | "to">
    > & {
      from?: MailAddress;
      cc: MailAddress[];
      bcc: MailAddress[];
      subject: string;
      bodyText?: string;
      bodyHtml?: string;
      source: MailDraftSource;
      replyToMessageId?: string;
      sourceMessageId?: string;
      attachments?: MailDraftTransportAttachment[];
      threading?: MailThreading;
      hermesSkillRunId?: string;
      hermesDraftText?: string;
      now: string;
    },
  ): Promise<ScheduledSendWithDraft | undefined>;
  rescheduleScheduledSend(input: {
    accountId: string;
    scheduledId: string;
    scheduledAt: string;
    notBefore: string;
    now: string;
  }): Promise<ScheduledSend | undefined>;
  queueScheduledSendNow(input: {
    accountId: string;
    scheduledId: string;
    scheduledAt: string;
    notBefore: string;
    now: string;
  }): Promise<ScheduledSend | undefined>;
  cancelScheduledSend(input: {
    accountId: string;
    scheduledId: string;
    now: string;
  }): Promise<ScheduledSend | undefined>;
  claimScheduledSendForSubmit(input: {
    accountId: string;
    scheduledId: string;
    leaseOwner: string;
    leaseExpiresAt: string;
    now: string;
  }): Promise<ScheduledSendWithDraft | undefined>;
  markScheduledSendSent(input: {
    accountId: string;
    scheduledId: string;
    draftId: string;
    providerQueueId?: string;
    providerMessageId?: string;
    sentAt: string;
  }): Promise<ScheduledSend>;
  markScheduledSendFailed(input: {
    accountId: string;
    scheduledId: string;
    draftId: string;
    errorMessage: string;
    now: string;
  }): Promise<ScheduledSend | undefined>;
}

export interface MailSendIdentityStore {
  listSendIdentities(input: { accountId: string }): Promise<MailSendIdentity[]>;
  listProviderSendIdentityCandidates?(input: {
    accountId: string;
  }): Promise<MailSendIdentityCandidate[]>;
  upsertProviderSendIdentityCandidate?(input: {
    accountId: string;
    provider: "graph";
    from: MailAddress;
    identityType: Extract<
      MailSendIdentityType,
      "shared_mailbox" | "send_on_behalf" | "unknown"
    >;
    now: string;
  }): Promise<MailSendIdentityCandidate>;
  getProviderSendIdentityCandidate?(input: {
    accountId: string;
    candidateId: string;
  }): Promise<MailSendIdentityCandidate | undefined>;
  markProviderSendIdentityCandidateVerification?(input: {
    accountId: string;
    candidateId: string;
    verificationState: Extract<
      MailSendIdentityVerificationState,
      "verified" | "failed"
    >;
    enabled: boolean;
    verificationError?: string;
    now: string;
  }): Promise<MailSendIdentityCandidate | undefined>;
  markProviderSendIdentityCandidateUserTargetVerification?(input: {
    accountId: string;
    candidateId: string;
    targetMailbox: string;
    verified: boolean;
    verificationError?: string;
    now: string;
  }): Promise<MailSendIdentityCandidate | undefined>;
}

export interface MailThreadingMetadataStore {
  getThreadingMetadata(input: {
    accountId: string;
    messageId: string;
    action: MailThreadingAction;
  }): Promise<MailThreading | undefined>;
}

export interface MailAttachmentContentStore {
  downloadAttachment(input: {
    accountId: string;
    providerAttachmentId: string;
    maxBytes: number;
  }): Promise<{
    bytes: Uint8Array;
    contentType?: string;
  }>;
}

export interface MailAttachmentBlobStore {
  getUploadedAttachment(input: {
    accountId: string;
    storageKey: string;
    attachmentId?: string;
  }): Promise<MailDraftTransportAttachment>;
  loadUploadedAttachmentContent(input: {
    accountId: string;
    storageKey: string;
    maxBytes: number;
  }): Promise<{ contentBase64: string; byteSize: number }>;
}

export interface MailSendTransport {
  submitMessage(input: {
    accountId: string;
    draftId: string;
    idempotencyKey: string;
    from?: MailAddress;
    to: MailAddress[];
    cc: MailAddress[];
    bcc: MailAddress[];
    subject: string;
    bodyText?: string;
    bodyHtml?: string;
    attachments?: MailSendAttachment[];
    threading?: MailThreading;
  }): Promise<{
    queueId?: string;
    messageId?: string;
    sendAt?: string;
  }>;
}

export interface GraphSendIdentityVerifier {
  sendVerification(input: {
    accountId: string;
    from: MailAddress;
    to: MailAddress;
    now: string;
  }): Promise<void>;
  sendUserTargetVerification?(input: {
    accountId: string;
    from: MailAddress;
    to: MailAddress;
    targetMailbox: string;
    now: string;
  }): Promise<void>;
}

export interface MailComposeService {
  listSendIdentities(input: {
    accountId: string;
  }): Promise<{
    accountId: string;
    items: MailSendIdentity[];
    candidates?: MailSendIdentityCandidate[];
  }>;
  addProviderSendIdentityCandidate(input: {
    accountId: string;
    provider: "graph";
    from: MailAddress;
    identityType: "shared_mailbox" | "send_on_behalf" | "unknown";
  }): Promise<MailSendIdentityCandidate>;
  verifyProviderSendIdentityCandidate(input: {
    accountId: string;
    candidateId: string;
  }): Promise<{
    accountId: string;
    candidate: MailSendIdentityCandidate;
    verified: boolean;
    errorCode?: string;
  }>;
  verifyProviderSendIdentityUserTarget(input: {
    accountId: string;
    candidateId: string;
    targetMailbox: string;
  }): Promise<{
    accountId: string;
    candidate: MailSendIdentityCandidate;
    verified: boolean;
    errorCode?: string;
  }>;
  diagnoseProviderSendIdentityCandidate(input: {
    accountId: string;
    candidateId: string;
  }): Promise<MailSendIdentityDiagnostics>;
  createComposeSeed(input: MailComposeSeedInput): Promise<MailComposeSeed>;
  previewDraft(input: MailComposePreviewInput): Promise<MailComposePreview>;
  createDraft(input: CreateMailDraftInput): Promise<MailDraft>;
  listDrafts(input: {
    accountId: string;
    limit?: number;
  }): Promise<MailDraftPage>;
  updateDraft(input: UpdateMailDraftInput): Promise<MailDraft>;
  sendDraft(input: { accountId: string; draftId: string }): Promise<{
    accountId: string;
    draftId: string;
    action: "draft_send_queued";
    draft: MailDraft;
  }>;
  scheduleDraft(input: {
    accountId: string;
    draftId: string;
    scheduledAt: string;
  }): Promise<ScheduledSend>;
  listOutbox(input: {
    accountId: string;
    limit?: number;
  }): Promise<{ accountId: string; items: ScheduledSend[] }>;
  getScheduledDraft(input: {
    accountId: string;
    scheduledId: string;
  }): Promise<ScheduledSendDraftDetail>;
  updateScheduledDraft(
    input: UpdateScheduledMailDraftInput,
  ): Promise<ScheduledSendDraftDetail>;
  rescheduleScheduledSend(input: {
    accountId: string;
    scheduledId: string;
    scheduledAt: string;
  }): Promise<ScheduledSend>;
  cancelScheduledSend(input: {
    accountId: string;
    scheduledId: string;
  }): Promise<ScheduledSend>;
  sendScheduledNow(input: {
    accountId: string;
    scheduledId: string;
  }): Promise<ScheduledSend>;
}

export function createMailComposeService(options: {
  store: MailComposeStore;
  transports: Partial<Record<MailEngineProvider, MailSendTransport>>;
  createId: () => string;
  sendIdentityStore?: MailSendIdentityStore;
  graphSendIdentityVerifier?: GraphSendIdentityVerifier;
  threadingStore?: MailThreadingMetadataStore;
  mailReadStore?: Pick<MailReadStore, "getMessage"> &
    Partial<Pick<MailReadStore, "getAttachmentDownload">>;
  attachmentContentStore?: MailAttachmentContentStore;
  attachmentBlobStore?: MailAttachmentBlobStore;
  hermesDraftFeedbackStore?: HermesDraftFeedbackStore;
  now?: () => Date;
}): MailComposeService {
  return {
    async listSendIdentities(input) {
      assertNonEmpty(input.accountId);
      const candidates = await listProviderSendIdentityCandidates(
        options.sendIdentityStore,
        input.accountId,
      );
      return {
        accountId: input.accountId,
        items: await listSendIdentities(options.sendIdentityStore, input.accountId),
        ...(candidates.length > 0 ? { candidates } : {}),
      };
    },

    async addProviderSendIdentityCandidate(input) {
      assertNonEmpty(input.accountId);
      const from = normalizeAddress(input.from);
      const identityType = normalizeGraphCandidateIdentityType(input.identityType);
      if (!options.sendIdentityStore?.upsertProviderSendIdentityCandidate) {
        throw new InvalidMailComposeRequestError(
          "provider send identity candidates are unavailable",
        );
      }

      try {
        return await options.sendIdentityStore.upsertProviderSendIdentityCandidate({
          accountId: input.accountId,
          provider: "graph",
          from,
          identityType,
          now: isoNow(options.now),
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "Graph native account was not found"
        ) {
          throw new InvalidMailComposeRequestError(
            "Graph native account was not found",
          );
        }
        throw error;
      }
    },

    async verifyProviderSendIdentityCandidate(input) {
      assertNonEmpty(input.accountId);
      assertNonEmpty(input.candidateId);
      if (
        !options.sendIdentityStore?.getProviderSendIdentityCandidate ||
        !options.sendIdentityStore.markProviderSendIdentityCandidateVerification
      ) {
        throw new InvalidMailComposeRequestError(
          "provider send identity candidates are unavailable",
        );
      }
      if (!options.graphSendIdentityVerifier) {
        throw new InvalidMailComposeRequestError(
          "Graph send identity verification is unavailable",
        );
      }

      const candidate =
        await options.sendIdentityStore.getProviderSendIdentityCandidate({
          accountId: input.accountId,
          candidateId: input.candidateId,
        });
      if (!candidate || candidate.provider !== "graph") {
        throw new InvalidMailComposeRequestError("send identity candidate not found");
      }
      if (candidate.verificationState === "verified" && candidate.enabled) {
        return {
          accountId: input.accountId,
          candidate,
          verified: true,
        };
      }

      const now = isoNow(options.now);
      try {
        await options.graphSendIdentityVerifier.sendVerification({
          accountId: input.accountId,
          from: candidate.from,
          to: candidate.verificationRecipient,
          now,
        });
      } catch (error) {
        const failed =
          await options.sendIdentityStore.markProviderSendIdentityCandidateVerification({
            accountId: input.accountId,
            candidateId: input.candidateId,
            verificationState: "failed",
            enabled: false,
            verificationError: providerVerificationErrorCode(error),
            now,
          });
        if (!failed) {
          throw new InvalidMailComposeRequestError(
            "send identity candidate not found",
          );
        }
        return {
          accountId: input.accountId,
          candidate: failed,
          verified: false,
          ...(failed.verificationError
            ? { errorCode: failed.verificationError }
            : {}),
        };
      }

      const verified =
        await options.sendIdentityStore.markProviderSendIdentityCandidateVerification({
          accountId: input.accountId,
          candidateId: input.candidateId,
          verificationState: "verified",
          enabled: true,
          now,
        });
      if (!verified) {
        throw new InvalidMailComposeRequestError("send identity candidate not found");
      }

      return {
        accountId: input.accountId,
        candidate: verified,
        verified: true,
      };
    },

    async verifyProviderSendIdentityUserTarget(input) {
      assertNonEmpty(input.accountId);
      assertNonEmpty(input.candidateId);
      const targetMailbox = normalizeGraphTargetMailbox(input.targetMailbox);
      if (
        !options.sendIdentityStore?.getProviderSendIdentityCandidate ||
        !options.sendIdentityStore
          .markProviderSendIdentityCandidateUserTargetVerification
      ) {
        throw new InvalidMailComposeRequestError(
          "provider send identity candidates are unavailable",
        );
      }
      if (!options.graphSendIdentityVerifier?.sendUserTargetVerification) {
        throw new InvalidMailComposeRequestError(
          "Graph shared mailbox target verification is unavailable",
        );
      }

      const candidate =
        await options.sendIdentityStore.getProviderSendIdentityCandidate({
          accountId: input.accountId,
          candidateId: input.candidateId,
        });
      if (!candidate || candidate.provider !== "graph") {
        throw new InvalidMailComposeRequestError("send identity candidate not found");
      }
      if (candidate.verificationState !== "verified" || !candidate.enabled) {
        throw new InvalidMailComposeRequestError(
          "send identity candidate must be verified first",
        );
      }
      if (
        candidate.userSendMailEligible &&
        candidate.sendMailTargetMode === "users" &&
        graphTargetMailboxMatches(candidate, targetMailbox)
      ) {
        return {
          accountId: input.accountId,
          candidate,
          verified: true,
        };
      }

      const now = isoNow(options.now);
      try {
        await options.graphSendIdentityVerifier.sendUserTargetVerification({
          accountId: input.accountId,
          from: candidate.from,
          to: candidate.verificationRecipient,
          targetMailbox,
          now,
        });
      } catch (error) {
        const failed =
          await options.sendIdentityStore
            .markProviderSendIdentityCandidateUserTargetVerification({
              accountId: input.accountId,
              candidateId: input.candidateId,
              targetMailbox,
              verified: false,
              verificationError: providerVerificationErrorCode(error),
              now,
            });
        if (!failed) {
          throw new InvalidMailComposeRequestError(
            "send identity candidate not found",
          );
        }
        return {
          accountId: input.accountId,
          candidate: failed,
          verified: false,
          ...(failed.userTargetVerificationError
            ? { errorCode: failed.userTargetVerificationError }
            : {}),
        };
      }

      const verified =
        await options.sendIdentityStore
          .markProviderSendIdentityCandidateUserTargetVerification({
            accountId: input.accountId,
            candidateId: input.candidateId,
            targetMailbox,
            verified: true,
            now,
          });
      if (!verified) {
        throw new InvalidMailComposeRequestError("send identity candidate not found");
      }

      return {
        accountId: input.accountId,
        candidate: verified,
        verified: true,
      };
    },

    async diagnoseProviderSendIdentityCandidate(input) {
      assertNonEmpty(input.accountId);
      assertNonEmpty(input.candidateId);
      if (!options.sendIdentityStore?.getProviderSendIdentityCandidate) {
        throw new InvalidMailComposeRequestError(
          "provider send identity candidates are unavailable",
        );
      }

      const candidate =
        await options.sendIdentityStore.getProviderSendIdentityCandidate({
          accountId: input.accountId,
          candidateId: input.candidateId,
        });
      if (!candidate || candidate.provider !== "graph") {
        throw new InvalidMailComposeRequestError("send identity candidate not found");
      }

      return buildGraphSendIdentityDiagnostics(
        input.accountId,
        candidate,
        currentIso(options.now),
      );
    },

    async createComposeSeed(input) {
      assertNonEmpty(input.accountId);
      assertNonEmpty(input.messageId);
      const mode = normalizeComposeSeedMode(input.mode);
      const from = normalizeOptionalSender(input.from);
      await ensureAllowedSender(
        options.sendIdentityStore,
        input.accountId,
        from,
      );
      const message = await loadComposeSeedMessage(
        options.mailReadStore,
        input.accountId,
        input.messageId,
      );
      const selfAddresses = await listSelfAddresses(
        options.sendIdentityStore,
        input.accountId,
        from,
      );

      return buildComposeSeed({
        accountId: input.accountId.trim(),
        message,
        mode,
        from,
        selfAddresses,
        generatedAt: currentIso(options.now),
      });
    },

    async previewDraft(input) {
      const normalized = normalizePreviewInput(input);
      await ensureAllowedSender(
        options.sendIdentityStore,
        normalized.accountId,
        normalized.from,
      );

      return buildPreview(normalized, currentIso(options.now));
    },

    async createDraft(input) {
      const normalized = normalizeDraftInput(input);
      await ensureAllowedSender(
        options.sendIdentityStore,
        normalized.accountId,
        normalized.from,
      );
      const attachments = await resolveDraftAttachments(
        options.mailReadStore,
        options.attachmentContentStore,
        options.attachmentBlobStore,
        normalized.accountId,
        normalized.attachments,
      );
      const threading = await resolveThreading(
        options.threadingStore,
        normalized,
      );
      const { attachments: _attachmentInputs, ...draftInput } = normalized;
      const draft = await options.store.createDraft({
        ...draftInput,
        ...(attachments.length > 0 ? { attachments } : {}),
        ...(threading ? { threading } : {}),
        id: options.createId(),
        now: currentIso(options.now),
      });

      await recordHermesDraftFeedback(options.hermesDraftFeedbackStore, draft);

      return draft;
    },

    async listDrafts(input) {
      assertNonEmpty(input.accountId);
      return {
        accountId: input.accountId,
        items: await options.store.listDrafts({
          accountId: input.accountId,
          limit: normalizeDraftListLimit(input.limit),
        }),
      };
    },

    async updateDraft(input) {
      assertNonEmpty(input.draftId);
      const attachmentsRequested = input.attachments !== undefined;
      const existing = attachmentsRequested
        ? await options.store.getDraftWithAccount({
            accountId: input.accountId,
            draftId: input.draftId,
          })
        : undefined;
      if (attachmentsRequested && !existing) {
        throw new InvalidMailComposeRequestError("draft was not found");
      }
      const normalized = normalizeDraftInput({
        ...input,
        ...(attachmentsRequested
          ? {
              attachments: hydrateExistingDraftAttachmentInputs(
                input.attachments ?? [],
                existing?.transportAttachments ?? [],
              ),
            }
          : {}),
      });
      await ensureAllowedSender(
        options.sendIdentityStore,
        normalized.accountId,
        normalized.from,
      );
      const attachments = await resolveDraftAttachments(
        options.mailReadStore,
        options.attachmentContentStore,
        options.attachmentBlobStore,
        normalized.accountId,
        normalized.attachments,
      );
      const threading = await resolveThreading(
        options.threadingStore,
        normalized,
      );
      const { attachments: _attachmentInputs, ...draftInput } = normalized;
      const draft = await options.store.updateDraft({
        ...draftInput,
        draftId: input.draftId.trim(),
        ...(attachmentsRequested ? { attachments } : {}),
        ...(threading ? { threading } : {}),
        now: currentIso(options.now),
      });
      if (!draft) {
        throw new InvalidMailComposeRequestError("draft was not found");
      }

      await recordHermesDraftFeedback(options.hermesDraftFeedbackStore, draft);

      return draft;
    },

    async sendDraft(input) {
      assertNonEmpty(input.accountId);
      assertNonEmpty(input.draftId);

      const loaded = await options.store.getDraftWithAccount({
        accountId: input.accountId,
        draftId: input.draftId,
      });
      if (!loaded) {
        throw new InvalidMailComposeRequestError("draft was not found");
      }
      ensureDraftCanSend(loaded);
      await ensureAllowedSender(
        options.sendIdentityStore,
        loaded.account.accountId,
        loaded.draft.from,
      );
      ensureSendTransportAvailable(options.transports, loaded.account);

      const now = currentIso(options.now);
      const scheduledSend = await options.store.createScheduledSend({
        id: options.createId(),
        accountId: input.accountId,
        draftId: input.draftId,
        scheduledAt: now,
        notBefore: now,
        status: "queued",
        idempotencyKey: `compose:${input.draftId}:send-now`,
        now,
      });
      if (!scheduledSend) {
        throw new InvalidMailComposeRequestError("draft is not sendable");
      }

      const queuedDraft = { ...loaded.draft };
      delete queuedDraft.errorMessage;
      return {
        accountId: input.accountId,
        draftId: input.draftId,
        action: "draft_send_queued",
        draft: {
          ...queuedDraft,
          status: "scheduled",
          updatedAt: scheduledSend.updatedAt,
        },
      };
    },

    async scheduleDraft(input) {
      assertNonEmpty(input.accountId);
      assertNonEmpty(input.draftId);
      const scheduledAt = normalizeScheduledAt(input.scheduledAt, options.now);

      const loaded = await options.store.getDraftWithAccount({
        accountId: input.accountId,
        draftId: input.draftId,
      });
      if (!loaded) {
        throw new InvalidMailComposeRequestError("draft was not found");
      }
      ensureDraftCanSchedule(loaded);
      await ensureAllowedSender(
        options.sendIdentityStore,
        loaded.account.accountId,
        loaded.draft.from,
      );

      const now = currentIso(options.now);
      const scheduledSend = await options.store.createScheduledSend({
        id: options.createId(),
        accountId: input.accountId,
        draftId: input.draftId,
        scheduledAt,
        notBefore: scheduledAt,
        status: "scheduled",
        idempotencyKey: `compose:${input.draftId}:schedule:${scheduledAt}`,
        now,
      });
      if (!scheduledSend) {
        throw new InvalidMailComposeRequestError("draft is not schedulable");
      }

      return scheduledSend;
    },

    async listOutbox(input) {
      assertNonEmpty(input.accountId);
      return {
        accountId: input.accountId,
        items: await options.store.listScheduledSends({
          accountId: input.accountId,
          limit: normalizeOutboxLimit(input.limit),
        }),
      };
    },

    async getScheduledDraft(input) {
      assertNonEmpty(input.accountId);
      assertNonEmpty(input.scheduledId);
      const loaded = await options.store.getScheduledDraft({
        accountId: input.accountId,
        scheduledId: input.scheduledId,
      });
      if (!loaded) {
        throw new InvalidMailComposeRequestError("scheduled draft was not found");
      }

      return {
        scheduledSend: loaded.scheduledSend,
        draft: loaded.draft,
      };
    },

    async updateScheduledDraft(input) {
      assertNonEmpty(input.scheduledId);
      const attachmentsRequested = input.attachments !== undefined;
      const existing = attachmentsRequested
        ? await options.store.getScheduledDraft({
            accountId: input.accountId,
            scheduledId: input.scheduledId,
          })
        : undefined;
      if (attachmentsRequested && !existing) {
        throw new InvalidMailComposeRequestError("scheduled draft was not found");
      }
      const normalized = normalizeDraftInput({
        ...input,
        ...(attachmentsRequested
          ? {
              attachments: hydrateExistingDraftAttachmentInputs(
                input.attachments ?? [],
                existing?.transportAttachments ?? [],
              ),
            }
          : {}),
      });
      await ensureAllowedSender(
        options.sendIdentityStore,
        normalized.accountId,
        normalized.from,
      );
      const attachments = await resolveDraftAttachments(
        options.mailReadStore,
        options.attachmentContentStore,
        options.attachmentBlobStore,
        normalized.accountId,
        normalized.attachments,
      );
      const threading = await resolveThreading(
        options.threadingStore,
        normalized,
      );
      const { attachments: _attachmentInputs, ...draftInput } = normalized;
      const loaded = await options.store.updateScheduledDraft({
        ...draftInput,
        scheduledId: input.scheduledId.trim(),
        ...(attachmentsRequested ? { attachments } : {}),
        ...(threading ? { threading } : {}),
        now: currentIso(options.now),
      });
      if (!loaded) {
        throw new InvalidMailComposeRequestError("scheduled draft was not found");
      }

      await recordHermesDraftFeedback(
        options.hermesDraftFeedbackStore,
        loaded.draft,
      );

      return {
        scheduledSend: loaded.scheduledSend,
        draft: loaded.draft,
      };
    },

    async rescheduleScheduledSend(input) {
      assertNonEmpty(input.accountId);
      assertNonEmpty(input.scheduledId);
      const scheduledAt = normalizeScheduledAt(input.scheduledAt, options.now);
      const result = await options.store.rescheduleScheduledSend({
        accountId: input.accountId,
        scheduledId: input.scheduledId,
        scheduledAt,
        notBefore: scheduledAt,
        now: currentIso(options.now),
      });
      if (!result) {
        throw new InvalidMailComposeRequestError("scheduled send was not found");
      }

      return result;
    },

    async cancelScheduledSend(input) {
      assertNonEmpty(input.accountId);
      assertNonEmpty(input.scheduledId);
      const result = await options.store.cancelScheduledSend({
        accountId: input.accountId,
        scheduledId: input.scheduledId,
        now: currentIso(options.now),
      });
      if (!result) {
        throw new InvalidMailComposeRequestError("scheduled send was not found");
      }

      return result;
    },

    async sendScheduledNow(input) {
      assertNonEmpty(input.accountId);
      assertNonEmpty(input.scheduledId);
      const now = currentIso(options.now);
      const loaded = await options.store.getScheduledDraft({
        accountId: input.accountId,
        scheduledId: input.scheduledId,
      });
      if (!loaded) {
        throw new InvalidMailComposeRequestError("scheduled send is not sendable");
      }
      ensureAccountCanSend(loaded.account);
      await ensureAllowedSender(
        options.sendIdentityStore,
        loaded.account.accountId,
        loaded.draft.from,
      );
      ensureSendTransportAvailable(options.transports, loaded.account);

      const scheduledSend = await options.store.queueScheduledSendNow({
        accountId: input.accountId,
        scheduledId: input.scheduledId,
        scheduledAt: now,
        notBefore: now,
        now,
      });
      if (!scheduledSend) {
        throw new InvalidMailComposeRequestError("scheduled send is not sendable");
      }
      return scheduledSend;
    },
  };
}

function normalizeDraftInput(input: CreateMailDraftInput): {
  accountId: string;
  from?: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  source: MailDraftSource;
  replyToMessageId?: string;
  sourceMessageId?: string;
  attachments?: CreateMailDraftAttachmentInput[];
  hermesSkillRunId?: string;
  hermesDraftText?: string;
} {
  assertNonEmpty(input.accountId);
  const from = normalizeOptionalSender(input.from);
  const to = normalizeAddresses(input.to);
  const cc = normalizeAddresses(input.cc ?? []);
  const bcc = normalizeAddresses(input.bcc ?? []);
  const bodyText = optionalTrimmed(input.bodyText);
  const bodyHtml = optionalTrimmed(input.bodyHtml);
  const replyToMessageId = optionalTrimmed(input.replyToMessageId);
  const sourceMessageId =
    optionalTrimmed(input.sourceMessageId) ?? replyToMessageId;
  const attachments = normalizeAttachmentInputs(input.attachments);

  if (to.length === 0) {
    throw new InvalidMailComposeRequestError("recipient is required");
  }
  if (!bodyText && !bodyHtml) {
    throw new InvalidMailComposeRequestError("message body is required");
  }

  return {
    accountId: input.accountId.trim(),
    ...(from ? { from } : {}),
    to,
    cc,
    bcc,
    subject: input.subject?.trim() ?? "",
    ...(bodyText ? { bodyText } : {}),
    ...(bodyHtml ? { bodyHtml } : {}),
    source: normalizeDraftSource(input.source),
    ...(replyToMessageId ? { replyToMessageId } : {}),
    ...(sourceMessageId ? { sourceMessageId } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(optionalTrimmed(input.hermesSkillRunId)
      ? { hermesSkillRunId: optionalTrimmed(input.hermesSkillRunId) }
      : {}),
    ...(optionalTrimmed(input.hermesDraftText)
      ? { hermesDraftText: optionalTrimmed(input.hermesDraftText) }
      : {}),
  };
}

function normalizePreviewInput(input: MailComposePreviewInput): {
  accountId: string;
  from?: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  source: MailDraftSource;
  replyToMessageId?: string;
  sourceMessageId?: string;
  attachments?: CreateMailDraftAttachmentInput[];
} {
  assertNonEmpty(input.accountId);
  const from = normalizeOptionalSender(input.from);
  const to = normalizeAddresses(input.to ?? []);
  const cc = normalizeAddresses(input.cc ?? []);
  const bcc = normalizeAddresses(input.bcc ?? []);
  const bodyText = optionalTrimmed(input.bodyText);
  const bodyHtml = optionalTrimmed(input.bodyHtml);
  const replyToMessageId = optionalTrimmed(input.replyToMessageId);
  const sourceMessageId =
    optionalTrimmed(input.sourceMessageId) ?? replyToMessageId;
  const attachments = normalizeAttachmentInputs(input.attachments);

  return {
    accountId: input.accountId.trim(),
    ...(from ? { from } : {}),
    to,
    cc,
    bcc,
    subject: input.subject?.trim() ?? "",
    ...(bodyText ? { bodyText } : {}),
    ...(bodyHtml ? { bodyHtml } : {}),
    source: normalizeDraftSource(input.source),
    ...(replyToMessageId ? { replyToMessageId } : {}),
    ...(sourceMessageId ? { sourceMessageId } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}

function buildPreview(
  input: ReturnType<typeof normalizePreviewInput>,
  generatedAt: string,
): MailComposePreview {
  const warnings = previewWarnings(input);
  return {
    accountId: input.accountId,
    ...(input.from ? { from: input.from } : {}),
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    ...(input.bodyText ? { bodyText: input.bodyText } : {}),
    ...(input.bodyHtml ? { bodyHtml: input.bodyHtml } : {}),
    source: input.source,
    ...(input.replyToMessageId
      ? { replyToMessageId: input.replyToMessageId }
      : {}),
    ...(input.sourceMessageId
      ? { sourceMessageId: input.sourceMessageId }
      : {}),
    ...(input.attachments && input.attachments.length > 0
      ? { attachments: input.attachments.map(publicDraftAttachmentFromInput) }
      : {}),
    warnings,
    estimatedSizeBytes: estimateDraftSize(input),
    readyToSend: warnings.length === 0,
    generatedAt,
  };
}

async function loadComposeSeedMessage(
  store: Pick<MailReadStore, "getMessage"> | undefined,
  accountId: string,
  messageId: string,
): Promise<MessageDetailDto> {
  if (!store) {
    throw new InvalidMailComposeRequestError("mail read store is unavailable");
  }

  const message = await store.getMessage({ accountId, messageId });
  if (!message) {
    throw new InvalidMailComposeRequestError("source message was not found");
  }

  return message;
}

function buildComposeSeed(input: {
  accountId: string;
  message: MessageDetailDto;
  mode: MailComposeSeedMode;
  from?: MailAddress;
  selfAddresses: Set<string>;
  generatedAt: string;
}): MailComposeSeed {
  const source = input.mode;
  const recipients =
    input.mode === "forward"
      ? { to: [], cc: [] }
      : replyRecipients(input.message, input.mode, input.selfAddresses);
  const bodyText =
    input.mode === "forward"
      ? forwardBodyText(input.message)
      : replyBodyText(input.message);
  const normalized = {
    accountId: input.accountId,
    ...(input.from ? { from: input.from } : {}),
    to: recipients.to,
    cc: recipients.cc,
    bcc: [],
    subject:
      input.mode === "forward"
        ? forwardSubject(input.message.subject)
        : replySubject(input.message.subject),
    bodyText,
    source,
    ...(input.mode === "forward"
      ? {}
      : { replyToMessageId: input.message.id }),
    sourceMessageId: input.message.id,
  };

  return {
    ...normalized,
    messageId: input.message.id,
    mode: input.mode,
    attachments:
      input.mode === "forward"
        ? input.message.attachments.map(seedAttachment)
        : [],
    warnings: previewWarnings(normalized),
    generatedAt: input.generatedAt,
  };
}

function replyRecipients(
  message: MessageDetailDto,
  mode: Exclude<MailComposeSeedMode, "forward">,
  selfAddresses: Set<string>,
): { to: MailAddress[]; cc: MailAddress[] } {
  const originalFrom = normalizeMessageAddress({
    address: message.from.email,
    name: message.from.name,
  });
  const originalTo = parseMessageAddressList(message.to);
  const originalCc = parseMessageAddressList(message.cc);
  const to = uniqueAddresses(
    originalFrom && !selfAddresses.has(originalFrom.address)
      ? [originalFrom]
      : originalTo,
    selfAddresses,
  );
  const cc =
    mode === "reply_all"
      ? uniqueAddresses([...originalTo, ...originalCc], addressSet([...to], selfAddresses))
      : [];

  return { to, cc };
}

function replyBodyText(message: MessageDetailDto): string {
  return [
    "",
    "",
    `On ${formatMessageDate(message.receivedAt)}, ${formatMessageSender(message)} wrote:`,
    quoteOriginalText(originalMessageText(message)),
  ].join("\n");
}

function forwardBodyText(message: MessageDetailDto): string {
  const header = [
    "",
    "",
    "---------- Forwarded message ---------",
    `From: ${formatMessageSender(message)}`,
    `Date: ${formatMessageDate(message.receivedAt)}`,
    `Subject: ${message.subject}`,
    ...(message.to.length > 0 ? [`To: ${message.to.join(", ")}`] : []),
    ...(message.cc.length > 0 ? [`Cc: ${message.cc.join(", ")}`] : []),
    "",
  ];
  return [...header, originalMessageText(message)].join("\n");
}

function replySubject(subject: string): string {
  const trimmed = subject.trim();
  return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

function forwardSubject(subject: string): string {
  const trimmed = subject.trim();
  return /^fwd:/i.test(trimmed) || /^fw:/i.test(trimmed)
    ? trimmed
    : `Fwd: ${trimmed}`;
}

async function listSelfAddresses(
  store: MailSendIdentityStore | undefined,
  accountId: string,
  from: MailAddress | undefined,
): Promise<Set<string>> {
  const addresses = new Set<string>();
  if (from) {
    addresses.add(from.address);
  }
  if (!store) {
    return addresses;
  }

  for (const identity of await store.listSendIdentities({ accountId })) {
    if (identity.verified) {
      addresses.add(identity.from.address.toLowerCase());
    }
  }

  return addresses;
}

async function resolveThreading(
  store: MailThreadingMetadataStore | undefined,
  input: {
    accountId: string;
    source: MailDraftSource;
    replyToMessageId?: string;
  },
): Promise<MailThreading | undefined> {
  const action = threadingActionForSource(input.source);
  if (!action || !input.replyToMessageId) {
    return undefined;
  }
  if (!store) {
    return undefined;
  }

  const threading = await store.getThreadingMetadata({
    accountId: input.accountId,
    messageId: input.replyToMessageId,
    action,
  });
  if (!threading) {
    throw new InvalidMailComposeRequestError(
      "reply source message was not found",
    );
  }

  return threading;
}

async function resolveDraftAttachments(
  store: Partial<Pick<MailReadStore, "getAttachmentDownload">> | undefined,
  contentStore: MailAttachmentContentStore | undefined,
  blobStore: MailAttachmentBlobStore | undefined,
  accountId: string,
  attachments: CreateMailDraftAttachmentInput[] | undefined,
): Promise<MailDraftTransportAttachment[]> {
  const normalized = normalizeAttachmentInputs(attachments);
  if (normalized.length === 0) {
    return [];
  }
  if (!store?.getAttachmentDownload) {
    if (
      normalized.some((attachment) => attachment.source === "message_attachment")
    ) {
      throw new InvalidMailComposeRequestError("attachment store is unavailable");
    }
  }

  const resolved: MailDraftTransportAttachment[] = [];
  for (const attachment of normalized) {
    if (attachment.source === "uploaded_file") {
      resolved.push(
        await uploadedDraftAttachment({
          attachment,
          blobStore,
          accountId,
        }),
      );
      enforceAttachmentLimits(resolved);
      continue;
    }

    if (!store?.getAttachmentDownload) {
      throw new InvalidMailComposeRequestError("attachment store is unavailable");
    }
    const download = await store.getAttachmentDownload({
      accountId,
      attachmentId: attachment.attachmentId,
    });
    if (!download) {
      throw new InvalidMailComposeRequestError("attachment was not found");
    }
    if (!contentStore) {
      throw new InvalidMailComposeRequestError(
        "attachment download is unavailable",
      );
    }
    if (!optionalTrimmed(download.providerAttachmentId)) {
      throw new InvalidMailComposeRequestError("attachment download failed");
    }
    if (download.byteSize > MAX_DRAFT_ATTACHMENT_BYTES) {
      throw new InvalidMailComposeRequestError("attachments are too large");
    }

    const content = await downloadMessageAttachmentContent({
      contentStore,
      accountId,
      providerAttachmentId: download.providerAttachmentId,
    });

    const contentId = optionalTrimmed(attachment.contentId);
    resolved.push({
      id: download.id,
      source: "message_attachment",
      attachmentId: download.id,
      filename: sanitizeFilename(download.filename),
      contentType: sanitizeContentType(download.contentType),
      byteSize: content.byteSize,
      inline: Boolean(attachment.inline),
      ...(contentId ? { contentId: sanitizeContentId(contentId) } : {}),
      providerAttachmentId: download.providerAttachmentId,
      contentBase64: content.contentBase64,
    });
    enforceAttachmentLimits(resolved);
  }

  return enforceAttachmentLimits(resolved);
}

function hydrateExistingDraftAttachmentInputs(
  attachments: CreateMailDraftAttachmentInput[],
  existingAttachments: MailDraftTransportAttachment[],
): CreateMailDraftAttachmentInput[] {
  if (attachments.length === 0 || existingAttachments.length === 0) {
    return attachments;
  }

  return attachments.map((attachment) => {
    const source = attachment.source ?? "message_attachment";
    if (source !== "uploaded_file" || optionalTrimmed(attachment.contentBase64)) {
      return attachment;
    }

    const existing = existingAttachments.find(
      (item) =>
        item.source === "uploaded_file" &&
        item.attachmentId === attachment.attachmentId &&
        (optionalTrimmed(item.contentBase64) ||
          optionalTrimmed(item.storageKey)),
    );
    if (!existing) {
      return attachment;
    }
    const existingContentBase64 = optionalTrimmed(existing.contentBase64);
    const existingStorageKey = optionalTrimmed(existing.storageKey);

    return {
      ...attachment,
      filename: attachment.filename ?? existing.filename,
      contentType: attachment.contentType ?? existing.contentType,
      byteSize: attachment.byteSize ?? existing.byteSize,
      inline: attachment.inline ?? existing.inline,
      ...(existingContentBase64
        ? { contentBase64: existingContentBase64 }
        : {}),
      ...(attachment.storageKey || existingStorageKey
        ? { storageKey: attachment.storageKey ?? existingStorageKey }
        : {}),
    };
  });
}

async function downloadMessageAttachmentContent(input: {
  contentStore: MailAttachmentContentStore;
  accountId: string;
  providerAttachmentId: string;
}): Promise<{ contentBase64: string; byteSize: number }> {
  try {
    const download = await input.contentStore.downloadAttachment({
      accountId: input.accountId,
      providerAttachmentId: input.providerAttachmentId,
      maxBytes: MAX_DRAFT_ATTACHMENT_BYTES,
    });
    const bytes = Buffer.from(download.bytes);
    if (bytes.byteLength > MAX_DRAFT_ATTACHMENT_BYTES) {
      throw new InvalidMailComposeRequestError("attachments are too large");
    }
    return normalizeAttachmentContentBase64(bytes.toString("base64"));
  } catch (error) {
    if (error instanceof InvalidMailComposeRequestError) {
      throw error;
    }
    if (error instanceof Error && error.message === "attachments are too large") {
      throw new InvalidMailComposeRequestError("attachments are too large");
    }
    throw new InvalidMailComposeRequestError("attachment download failed");
  }
}

async function uploadedDraftAttachment(input: {
  attachment: CreateMailDraftAttachmentInput;
  blobStore: MailAttachmentBlobStore | undefined;
  accountId: string;
}): Promise<MailDraftTransportAttachment> {
  const { attachment } = input;
  const filename = sanitizeFilename(attachment.filename ?? "attachment");
  const contentType = sanitizeContentType(
    attachment.contentType ?? "application/octet-stream",
  );
  const contentId = optionalTrimmed(attachment.contentId);
  const storageKey = optionalTrimmed(attachment.storageKey);
  if (storageKey) {
    if (!input.blobStore) {
      throw new InvalidMailComposeRequestError(
        "attachment object storage is unavailable",
      );
    }
    try {
      const stored = await input.blobStore.getUploadedAttachment({
        accountId: input.accountId,
        storageKey,
        attachmentId: attachment.attachmentId,
      });
      return {
        ...stored,
        filename: attachment.filename ? filename : stored.filename,
        contentType: attachment.contentType ? contentType : stored.contentType,
        inline: Boolean(attachment.inline),
        ...(contentId ? { contentId: sanitizeContentId(contentId) } : {}),
      };
    } catch (error) {
      if (error instanceof InvalidMailComposeRequestError) {
        throw error;
      }
      throw new InvalidMailComposeRequestError("attachment was not found");
    }
  }

  const content = normalizeAttachmentContentBase64(attachment.contentBase64);
  return {
    id: attachment.attachmentId,
    source: "uploaded_file",
    attachmentId: attachment.attachmentId,
    filename,
    contentType,
    byteSize: content.byteSize,
    inline: Boolean(attachment.inline),
    ...(contentId ? { contentId: sanitizeContentId(contentId) } : {}),
    contentBase64: content.contentBase64,
  };
}

function normalizeAttachmentInputs(
  attachments: CreateMailDraftAttachmentInput[] | undefined,
): CreateMailDraftAttachmentInput[] {
  if (!attachments || attachments.length === 0) {
    return [];
  }
  if (attachments.length > MAX_DRAFT_ATTACHMENTS) {
    throw new InvalidMailComposeRequestError("too many attachments");
  }

  const seen = new Set<string>();
  const normalized: CreateMailDraftAttachmentInput[] = [];
  for (const attachment of attachments) {
    if (!attachment) {
      throw new InvalidMailComposeRequestError("attachment is invalid");
    }

    const source = attachment.source ?? "message_attachment";
    if (source === "message_attachment" || source === "uploaded_file") {
      const attachmentId = optionalTrimmed(attachment?.attachmentId);
      if (!attachmentId || /[\u0000-\u001f]/.test(attachmentId)) {
        throw new InvalidMailComposeRequestError("attachment id is invalid");
      }
      if (seen.has(attachmentId)) {
        continue;
      }
      seen.add(attachmentId);
      const filename = optionalTrimmed(attachment?.filename);
      const contentType = optionalTrimmed(attachment?.contentType);
      const contentId = optionalTrimmed(attachment?.contentId);
      const storageKey = optionalTrimmed(attachment?.storageKey);
      const contentBase64 =
        source === "uploaded_file"
          ? optionalTrimmed(attachment.contentBase64)
          : undefined;
      if (source === "uploaded_file" && !contentBase64 && !storageKey) {
        throw new InvalidMailComposeRequestError("attachment content is required");
      }
      const normalizedAttachment: CreateMailDraftAttachmentInput = {
        source,
        attachmentId,
        ...(filename ? { filename: sanitizeFilename(filename) } : {}),
        ...(contentType ? { contentType: sanitizeContentType(contentType) } : {}),
        ...(typeof attachment?.byteSize === "number" &&
        Number.isFinite(attachment.byteSize)
          ? { byteSize: Math.max(0, Math.floor(attachment.byteSize)) }
          : {}),
        inline: Boolean(attachment?.inline),
        ...(contentId ? { contentId: sanitizeContentId(contentId) } : {}),
        ...(storageKey ? { storageKey: sanitizeStorageKey(storageKey) } : {}),
        ...(source === "uploaded_file" && contentBase64
          ? {
              contentBase64: normalizeAttachmentContentBase64(
                contentBase64,
              ).contentBase64,
            }
          : {}),
      };
      normalized.push(normalizedAttachment);
      continue;
    }

    throw new InvalidMailComposeRequestError("attachment source is unsupported");
  }

  return enforceAttachmentInputLimits(normalized);
}

function enforceAttachmentInputLimits(
  attachments: CreateMailDraftAttachmentInput[],
): CreateMailDraftAttachmentInput[] {
  const knownTotal = attachments.reduce(
    (sum, attachment) => sum + (attachment.byteSize ?? 0),
    0,
  );
  if (knownTotal > MAX_DRAFT_ATTACHMENT_BYTES) {
    throw new InvalidMailComposeRequestError("attachments are too large");
  }
  const uploadedTotal = attachments.reduce((sum, attachment) => {
    if (attachment.source !== "uploaded_file") {
      return sum;
    }
    if (attachment.storageKey && !attachment.contentBase64) {
      return sum;
    }
    return (
      sum +
      normalizeAttachmentContentBase64(attachment.contentBase64).byteSize
    );
  }, 0);
  if (uploadedTotal > MAX_DRAFT_ATTACHMENT_BYTES) {
    throw new InvalidMailComposeRequestError("attachments are too large");
  }
  return attachments;
}

function enforceAttachmentLimits<T extends { byteSize: number }>(
  attachments: T[],
): T[] {
  const total = attachments.reduce(
    (sum, attachment) => sum + attachment.byteSize,
    0,
  );
  if (total > MAX_DRAFT_ATTACHMENT_BYTES) {
    throw new InvalidMailComposeRequestError("attachments are too large");
  }
  return attachments;
}

function publicDraftAttachmentFromInput(
  attachment: CreateMailDraftAttachmentInput,
): MailDraftAttachment {
  const attachmentId = optionalTrimmed(attachment.attachmentId) ?? "attachment";
  const contentId = optionalTrimmed(attachment.contentId);
  const byteSize =
    attachment.source === "uploaded_file" && attachment.contentBase64
      ? normalizeAttachmentContentBase64(attachment.contentBase64).byteSize
      : (attachment.byteSize ?? 0);
  return {
    id: attachmentId,
    source: attachment.source ?? "message_attachment",
    attachmentId,
    ...(attachment.storageKey ? { storageKey: attachment.storageKey } : {}),
    filename: sanitizeFilename(attachment.filename ?? "attachment"),
    contentType: sanitizeContentType(
      attachment.contentType ?? "application/octet-stream",
    ),
    byteSize,
    inline: Boolean(attachment.inline),
    ...(contentId ? { contentId: sanitizeContentId(contentId) } : {}),
  };
}

function normalizeAttachmentContentBase64(
  value: string | undefined,
): { contentBase64: string; byteSize: number } {
  const compact = value?.replace(/\s+/g, "") ?? "";
  if (!compact) {
    throw new InvalidMailComposeRequestError("attachment content is required");
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 === 1) {
    throw new InvalidMailComposeRequestError("attachment content is invalid");
  }

  const buffer = Buffer.from(compact, "base64");
  const canonical = buffer.toString("base64");
  if (canonical.replace(/=+$/g, "") !== compact.replace(/=+$/g, "")) {
    throw new InvalidMailComposeRequestError("attachment content is invalid");
  }
  if (buffer.byteLength > MAX_DRAFT_ATTACHMENT_BYTES) {
    throw new InvalidMailComposeRequestError("attachments are too large");
  }

  return {
    contentBase64: canonical,
    byteSize: buffer.byteLength,
  };
}

function sanitizeStorageKey(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9-]{32,64}$/.test(normalized)) {
    throw new InvalidMailComposeRequestError("attachment storage key is invalid");
  }
  return normalized;
}

function threadingActionForSource(
  source: MailDraftSource,
): MailThreadingAction | undefined {
  if (source === "reply_all") {
    return "reply_all";
  }
  if (source === "reply" || source === "hermes_reply") {
    return "reply";
  }
  return undefined;
}

function previewWarnings(input: {
  to: MailAddress[];
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
}): MailComposePreviewWarning[] {
  const warnings: MailComposePreviewWarning[] = [];
  if (input.to.length === 0) {
    warnings.push("missing_recipient");
  }
  if (!input.subject.trim()) {
    warnings.push("missing_subject");
  }
  if (!input.bodyText?.trim() && !input.bodyHtml?.trim()) {
    warnings.push("missing_body");
  }
  if (estimateDraftSize(input) > 512_000) {
    warnings.push("large_body");
  }
  return warnings;
}

function estimateDraftSize(input: {
  to?: MailAddress[];
  cc?: MailAddress[];
  bcc?: MailAddress[];
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
}): number {
  return [
    input.subject,
    input.bodyText ?? "",
    input.bodyHtml ?? "",
    ...(input.to ?? []).map(formatAddress),
    ...(input.cc ?? []).map(formatAddress),
    ...(input.bcc ?? []).map(formatAddress),
  ].join("\n").length;
}

function originalMessageText(message: MessageDetailDto): string {
  const raw =
    optionalTrimmed(message.bodyText) ??
    (message.bodyHtml ? stripHtml(message.bodyHtml) : undefined) ??
    optionalTrimmed(message.snippet) ??
    "";
  const maxChars = 32_000;
  if (raw.length <= maxChars) {
    return raw;
  }
  return `${raw.slice(0, maxChars)}\n[Original message truncated for compose preview]`;
}

function quoteOriginalText(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function seedAttachment(attachment: AttachmentDto): MailComposeSeedAttachment {
  return {
    id: attachment.id,
    filename: sanitizeFilename(attachment.filename),
    contentType: sanitizeContentType(attachment.contentType),
    byteSize: attachment.byteSize,
    inline: attachment.inline,
  };
}

function sanitizeFilename(value: string): string {
  const sanitized = value.replace(/[\r\n\u0000]+/g, " ").trim();
  return sanitized.length > 0 ? sanitized.slice(0, 255) : "attachment";
}

function sanitizeContentType(value: string): string {
  const sanitized = value.replace(/[\r\n\u0000]+/g, "").trim().toLowerCase();
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(sanitized)
    ? sanitized
    : "application/octet-stream";
}

function sanitizeContentId(value: string): string {
  return value.replace(/[\r\n<> \u0000]+/g, "").trim().slice(0, 255);
}

function parseMessageAddressList(values: string[]): MailAddress[] {
  return values
    .map(parseMessageAddress)
    .filter((address): address is MailAddress => Boolean(address));
}

function parseMessageAddress(value: string): MailAddress | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const angleMatch = /^(.*?)<([^<>\s]+@[^<>\s]+\.[^<>\s]+)>$/.exec(trimmed);
  if (angleMatch) {
    return normalizeMessageAddress({
      address: angleMatch[2],
      name: angleMatch[1].replace(/^"|"$/g, "").trim(),
    });
  }

  const emailMatch = /([^@\s<>,]+@[^@\s<>,]+\.[^@\s<>,]+)/.exec(trimmed);
  if (!emailMatch) {
    return undefined;
  }

  return normalizeMessageAddress({ address: emailMatch[1] });
}

function normalizeMessageAddress(input: MailAddress): MailAddress | undefined {
  try {
    return normalizeAddress(input);
  } catch {
    return undefined;
  }
}

function uniqueAddresses(
  values: MailAddress[],
  exclude = new Set<string>(),
): MailAddress[] {
  const seen = new Set(exclude);
  const result: MailAddress[] = [];
  for (const value of values) {
    const key = value.address.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }
  return result;
}

function addressSet(
  values: MailAddress[],
  seed = new Set<string>(),
): Set<string> {
  const result = new Set(seed);
  for (const value of values) {
    result.add(value.address.toLowerCase());
  }
  return result;
}

function formatMessageDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toUTCString();
}

function formatMessageSender(message: MessageDetailDto): string {
  return formatAddress({
    address: message.from.email,
    ...(message.from.name ? { name: message.from.name } : {}),
  });
}

function formatAddress(address: MailAddress): string {
  return address.name ? `${address.name} <${address.address}>` : address.address;
}

function normalizeComposeSeedMode(value: MailComposeSeedMode): MailComposeSeedMode {
  if (value === "reply" || value === "reply_all" || value === "forward") {
    return value;
  }
  throw new InvalidMailComposeRequestError();
}

function normalizeDraftSource(value: MailDraftSource | undefined): MailDraftSource {
  if (
    value === "manual" ||
    value === "hermes_reply" ||
    value === "reply" ||
    value === "reply_all" ||
    value === "forward"
  ) {
    return value;
  }
  return "manual";
}

async function listSendIdentities(
  store: MailSendIdentityStore | undefined,
  accountId: string,
): Promise<MailSendIdentity[]> {
  if (!store) {
    return [];
  }

  return store.listSendIdentities({ accountId });
}

async function listProviderSendIdentityCandidates(
  store: MailSendIdentityStore | undefined,
  accountId: string,
): Promise<MailSendIdentityCandidate[]> {
  if (!store?.listProviderSendIdentityCandidates) {
    return [];
  }

  return store.listProviderSendIdentityCandidates({ accountId });
}

function normalizeGraphCandidateIdentityType(
  value: "shared_mailbox" | "send_on_behalf" | "unknown",
): "shared_mailbox" | "send_on_behalf" | "unknown" {
  if (
    value === "shared_mailbox" ||
    value === "send_on_behalf" ||
    value === "unknown"
  ) {
    return value;
  }

  throw new InvalidMailComposeRequestError("send identity type is invalid");
}

function normalizeGraphTargetMailbox(value: string): string {
  if (typeof value !== "string") {
    throw new InvalidMailComposeRequestError("Graph target mailbox is required");
  }

  const trimmed = value.trim();
  if (!trimmed || /[\r\n]/.test(trimmed)) {
    throw new InvalidMailComposeRequestError("Graph target mailbox is required");
  }

  return trimmed.includes("@") ? trimmed.toLowerCase() : trimmed;
}

function graphTargetMailboxMatches(
  candidate: MailSendIdentityCandidate,
  targetMailbox: string,
): boolean {
  const existing =
    candidate.targetMailbox?.userId ??
    candidate.targetMailbox?.userPrincipalName;
  if (!existing) {
    return false;
  }

  return existing.toLowerCase() === targetMailbox.toLowerCase();
}

function buildGraphSendIdentityDiagnostics(
  accountId: string,
  candidate: MailSendIdentityCandidate,
  generatedAt: string,
): MailSendIdentityDiagnostics {
  const fromVerified =
    candidate.verificationState === "verified" && candidate.enabled;
  const targetVerified =
    fromVerified &&
    candidate.sendMailTargetMode === "users" &&
    candidate.userSendMailEligible === true &&
    Boolean(targetMailboxLabel(candidate));
  const sendPath: MailSendIdentityDiagnostics["sendPath"] = !fromVerified
    ? "unavailable"
    : targetVerified
      ? "users"
      : "me";
  const sentItemsBehavior: MailSendIdentityDiagnostics["sentItemsBehavior"] =
    !fromVerified
      ? "unknown"
      : targetVerified
        ? "from_mailbox"
        : "signed_in_user";
  const status = graphDiagnosticStatus(candidate, fromVerified, targetVerified);
  const checks = graphDiagnosticChecks(candidate, fromVerified, targetVerified);
  const nextActions = graphDiagnosticNextActions(
    candidate,
    fromVerified,
    targetVerified,
  );

  return {
    accountId,
    candidateId: candidate.id,
    provider: "graph",
    generatedAt,
    from: candidate.from,
    identityType: candidate.identityType,
    status,
    summary: graphDiagnosticSummary(candidate, status),
    sendPath,
    sentItemsBehavior,
    discoverySupported: false,
    checks,
    nextActions,
    candidate,
  };
}

function graphDiagnosticStatus(
  candidate: MailSendIdentityCandidate,
  fromVerified: boolean,
  targetVerified: boolean,
): MailSendIdentityDiagnosticStatus {
  if (!fromVerified) {
    return candidate.verificationState === "failed"
      ? "from_verification_failed"
      : "needs_from_verification";
  }
  if (targetVerified) {
    return "ready";
  }
  if (candidate.userTargetVerificationError) {
    return "target_verification_failed";
  }
  return "target_verification_recommended";
}

function graphDiagnosticSummary(
  candidate: MailSendIdentityCandidate,
  status: MailSendIdentityDiagnosticStatus,
): string {
  switch (status) {
    case "ready":
      return "共享发件人和共享邮箱 Sent Items 路径都已验证。";
    case "from_verification_failed":
      return `共享发件人验证失败：${safeGraphErrorLabel(
        candidate.verificationError,
      )}。`;
    case "needs_from_verification":
      return "共享发件人还未验证，暂时不能作为 From 使用。";
    case "target_verification_failed":
      return `From 可用，但共享邮箱 Sent Items 路径验证失败：${safeGraphErrorLabel(
        candidate.userTargetVerificationError,
      )}。`;
    case "target_verification_recommended":
      return "From 可用；如果需要邮件进入共享邮箱 Sent Items，请继续验证目标邮箱。";
  }
}

function graphDiagnosticChecks(
  candidate: MailSendIdentityCandidate,
  fromVerified: boolean,
  targetVerified: boolean,
): MailSendIdentityDiagnosticCheck[] {
  return [
    {
      id: "explicit_candidate",
      status: "info",
      title: "显式共享发件人",
      detail:
        "Microsoft Graph 不能可靠枚举当前用户可用的共享邮箱，本候选项由用户显式添加。",
    },
    {
      id: "from_permission",
      status: fromVerified
        ? "pass"
        : candidate.verificationState === "failed"
          ? "fail"
          : "warning",
      title: "From 权限",
      detail: fromVerified
        ? "Graph 已接受 /me/sendMail 携带该 From 地址。"
        : candidate.verificationState === "failed"
          ? `Graph 拒绝该 From 地址：${safeGraphErrorLabel(
              candidate.verificationError,
            )}。`
          : "需要先运行 From 验证，确认 Send As 或代表发送权限。",
      ...(!fromVerified ? { action: "运行 From 验证" } : {}),
    },
    {
      id: "sent_items_target",
      status: targetVerified
        ? "pass"
        : candidate.userTargetVerificationError
          ? "fail"
          : fromVerified
            ? "warning"
            : "info",
      title: "共享邮箱 Sent Items",
      detail: targetVerified
        ? `Graph 已接受 /users/${targetMailboxLabel(
            candidate,
          )}/sendMail，发送副本会进入共享邮箱。`
        : candidate.userTargetVerificationError
          ? `Graph 未接受共享邮箱目标路径：${safeGraphErrorLabel(
              candidate.userTargetVerificationError,
            )}。`
          : fromVerified
            ? "当前会走 /me/sendMail，发送副本保存在登录账号 Sent Items；可继续验证共享邮箱目标路径。"
            : "From 验证完成后才能验证共享邮箱目标路径。",
      ...(targetVerified ? {} : { action: "验证共享邮箱目标路径" }),
    },
  ];
}

function graphDiagnosticNextActions(
  candidate: MailSendIdentityCandidate,
  fromVerified: boolean,
  targetVerified: boolean,
): string[] {
  if (!fromVerified) {
    return candidate.verificationState === "failed"
      ? [
          "在 Microsoft 365 中确认 Send As 或代表发送权限。",
          "等待权限生效后重新运行 From 验证。",
        ]
      : ["运行 From 验证。"];
  }
  if (targetVerified) {
    return ["保持当前配置；发送时会优先使用已验证的共享邮箱目标路径。"];
  }
  if (candidate.userTargetVerificationError) {
    return [
      "确认用户对共享邮箱具备 Full Access 或可用的 /users/{mailbox}/sendMail 权限。",
      "修正目标邮箱地址后重新验证共享邮箱目标路径。",
    ];
  }
  return ["如需共享邮箱 Sent Items 归档，输入目标邮箱并运行共享邮箱目标验证。"];
}

function targetMailboxLabel(candidate: MailSendIdentityCandidate): string | undefined {
  return candidate.targetMailbox?.userPrincipalName ?? candidate.targetMailbox?.userId;
}

function safeGraphErrorLabel(errorCode: string | undefined): string {
  if (!errorCode) {
    return "unknown_error";
  }
  const normalized = errorCode.trim();
  return /^[A-Za-z0-9_.:-]{1,80}$/.test(normalized)
    ? normalized
    : "provider_rejected";
}

function isoNow(now: (() => Date) | undefined): string {
  return (now?.() ?? new Date()).toISOString();
}

function providerVerificationErrorCode(error: unknown): string {
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.code === "string" && record.code.trim()) {
      return record.code.trim();
    }
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message.trim().slice(0, 160);
    }
  }

  return "unknown_error";
}

async function ensureAllowedSender(
  store: MailSendIdentityStore | undefined,
  accountId: string,
  from: MailAddress | undefined,
): Promise<void> {
  if (!from) {
    return;
  }
  if (!store) {
    throw new InvalidMailComposeRequestError(
      "send identity verification is unavailable",
    );
  }

  const identities = await store.listSendIdentities({ accountId });
  const normalized = from.address.toLowerCase();
  const allowed = identities.some(
    (identity) =>
      identity.verified && identity.from.address.toLowerCase() === normalized,
  );
  if (!allowed) {
    throw new InvalidMailComposeRequestError("from address is not allowed");
  }
}

async function recordHermesDraftFeedback(
  store: HermesDraftFeedbackStore | undefined,
  draft: MailDraft,
): Promise<void> {
  if (
    !store ||
    !draft.hermesSkillRunId ||
    !draft.hermesDraftText ||
    !draft.bodyText
  ) {
    return;
  }

  await store.recordDraftFeedback({
    skillRunId: draft.hermesSkillRunId,
    draftText: draft.hermesDraftText,
    finalText: draft.bodyText,
    ...(draft.subject ? { subject: draft.subject } : {}),
    ...(draft.to[0]?.address ? { recipientEmail: draft.to[0].address } : {}),
  });
}

function ensureDraftCanSend(input: DraftWithAccount): void {
  if (
    input.draft.status !== "draft" &&
    input.draft.status !== "scheduled" &&
    input.draft.status !== "sending"
  ) {
    throw new InvalidMailComposeRequestError("draft is not sendable");
  }
  ensureAccountCanSend(input.account);
}

function ensureDraftCanSchedule(input: DraftWithAccount): void {
  if (input.draft.status !== "draft") {
    throw new InvalidMailComposeRequestError("draft is not schedulable");
  }
  ensureAccountCanSend(input.account);
}

function ensureAccountCanSend(input: MailComposeAccount): void {
  if (input.syncState === "paused") {
    throw new InvalidMailComposeRequestError("account sync is paused");
  }
  if (input.syncState === "reauth_required") {
    throw new InvalidMailComposeRequestError("account requires reauthorization");
  }
}

function ensureSendTransportAvailable(
  transports: Partial<Record<MailEngineProvider, MailSendTransport>>,
  account: MailComposeAccount,
): void {
  if (!transports[account.engineProvider]) {
    throw new InvalidMailComposeRequestError(
      `${account.engineProvider} send transport is not configured`,
    );
  }
}

function normalizeAddresses(addresses: MailAddress[]): MailAddress[] {
  return addresses.map(normalizeAddress).filter((address) => address.address);
}

function normalizeOptionalSender(address: MailAddress | undefined): MailAddress | undefined {
  return address ? normalizeAddress(address) : undefined;
}

function normalizeAddress(address: MailAddress): MailAddress {
  const normalized = address.address.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
    throw new InvalidMailComposeRequestError("recipient email is invalid");
  }
  const name = optionalTrimmed(address.name);
  if (name && /[\r\n]/.test(name)) {
    throw new InvalidMailComposeRequestError("address name is invalid");
  }
  return {
    address: normalized,
    ...(name ? { name } : {}),
  };
}

function assertNonEmpty(value: string): void {
  if (!value.trim()) {
    throw new InvalidMailComposeRequestError();
  }
}

function optionalTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function currentIso(now: (() => Date) | undefined): string {
  return (now?.() ?? new Date()).toISOString();
}

function normalizeScheduledAt(value: string, now: (() => Date) | undefined): string {
  const scheduledAt = new Date(value);
  if (Number.isNaN(scheduledAt.getTime())) {
    throw new InvalidMailComposeRequestError("scheduled time is invalid");
  }

  const current = now?.() ?? new Date();
  if (scheduledAt.getTime() <= current.getTime()) {
    throw new InvalidMailComposeRequestError("scheduled time must be future");
  }

  const maxFutureMs = 365 * 24 * 60 * 60 * 1000;
  if (scheduledAt.getTime() > current.getTime() + maxFutureMs) {
    throw new InvalidMailComposeRequestError("scheduled time is too far");
  }

  return scheduledAt.toISOString();
}

function normalizeOutboxLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return 50;
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new InvalidMailComposeRequestError("outbox limit is invalid");
  }

  return limit;
}

function normalizeDraftListLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return 50;
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new InvalidMailComposeRequestError("draft list limit is invalid");
  }

  return limit;
}
