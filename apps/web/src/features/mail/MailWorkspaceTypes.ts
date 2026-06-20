import type { HermesReaderCommandAction } from "../hermes/hermesCommandIntent";
import type { HermesSearchLaunchOptions } from "../hermes/hermesSearchLaunch";
import type { MailItem, Tone } from "./mail-items";
import type {
  HermesSkillRequiredPermission,
  MailDraftAttachmentDto,
  MailDraftDto,
  MailDraftSource,
  SmartInboxFeedbackAction,
} from "../../lib/emailHubApi";

export type MailDensity = "roomy" | "comfortable" | "compact";
export type TopSearchScope = "all" | "account" | "current";
export type ComposeAutosaveStatus =
  | "idle"
  | "pending"
  | "saving"
  | "saved"
  | "error";
export type ComposeSurface = "closed" | "floating" | "reader";
export type ReaderHermesBusy = "summary" | "translation" | "organize";
export type SmartInboxBusyAction = "" | "bulk_done" | SmartInboxFeedbackAction;
export type ReaderActionResult = boolean | Promise<boolean>;
export type HermesNoticeAction = "open_runtime_settings";

export interface ComposeAutosaveInFlight {
  accountId: string;
  draftId?: string;
  sessionId: number;
  signature: string;
  promise: Promise<MailDraftDto>;
}

export interface ComposeDraftSignatureInput {
  accountId: string;
  from?: { address: string; name?: string };
  to: Array<{ address: string; name?: string }>;
  cc: Array<{ address: string; name?: string }>;
  bcc: Array<{ address: string; name?: string }>;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  source: MailDraftSource;
  attachments?: MailDraftAttachmentDto[];
  replyToMessageId?: string;
  sourceMessageId?: string;
  hermesSkillRunId?: string;
  hermesDraftText?: string;
}

export interface SearchLaunch extends HermesSearchLaunchOptions {
  query: string;
  requestId: number;
}

export interface SearchMailboxScope {
  mailboxId?: string;
  mailboxRole?: string;
}

export interface FolderItem {
  id: string;
  label: string;
  count: number;
  role?: string;
  virtual?: boolean;
}

export interface ProviderGroup {
  id: string;
  label: string;
  count: number;
}

export interface QuickCategory {
  id: string;
  label: string;
  count: number;
  tone: Tone;
}

export interface LabelItem {
  id: string;
  accountId: string;
  label: string;
  count: number;
  tone: Tone;
}

export interface UndoToastState {
  accountId: string;
  messageId: string;
  undoToken: string;
  mail?: MailItem;
}

export interface HermesNoticeState {
  text: string;
  skillId?: string;
  requiredPermission?: HermesSkillRequiredPermission;
  action?: HermesNoticeAction;
}

export interface HermesDockReaderIntent {
  action: HermesReaderCommandAction;
  requestId: number;
}
