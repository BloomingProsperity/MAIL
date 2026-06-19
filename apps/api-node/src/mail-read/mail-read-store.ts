export interface MailboxDto {
  id: string;
  accountId: string;
  name: string;
  role: string;
  messageCount: number;
  unreadCount: number;
}

export interface MessageListItemDto {
  id: string;
  accountId: string;
  subject: string;
  from: {
    email: string;
    name?: string;
  };
  receivedAt: string;
  snippet?: string;
  unread: boolean;
  starred: boolean;
  mailboxIds: string[];
  attachmentCount: number;
  classification: MessageClassificationDto;
  searchPreview?: MessageSearchPreviewDto;
}

export interface MessageClassificationDto {
  bucket: string;
  priorityScore: number;
  reasons: string[];
}

export interface MessageSearchPreviewDto {
  source: "indexed_text";
  text: string;
}

export type MessageListSort = "time" | "smart";
export type MailQuickFilter = "unread" | "starred" | "attachments" | "labels";
export type MailSearchScope = "sender" | "recipients" | "subject" | "body";
export type MailTagMode = "any" | "all";

export interface AttachmentDto {
  id: string;
  filename: string;
  contentType: string;
  byteSize: number;
  contentId?: string;
  embedded: boolean;
  inline: boolean;
}

export interface AttachmentDownloadRef {
  id: string;
  accountId: string;
  providerAttachmentId: string;
  filename: string;
  contentType: string;
  byteSize: number;
}

export interface MessageDetailDto extends MessageListItemDto {
  to: string[];
  cc: string[];
  bodyText?: string;
  bodyHtml?: string;
  attachments: AttachmentDto[];
}

export interface ListMailboxesInput {
  accountId: string;
}

export interface ListMessagesInput {
  accountId?: string;
  mailboxId?: string;
  mailboxRole?: string;
  limit: number;
  cursor?: string;
  q?: string;
  sort?: MessageListSort;
  savedViewId?: string;
  quickFilters?: MailQuickFilter[];
  qScopes?: MailSearchScope[];
  labelIds?: string[];
  tagMode?: MailTagMode;
  senderQuery?: string;
  recipientQuery?: string;
  receivedAfter?: string;
  receivedBefore?: string;
  hasAttachment?: boolean;
}

export interface GetMessageInput {
  accountId: string;
  messageId: string;
}

export interface GetAttachmentDownloadInput {
  accountId: string;
  attachmentId: string;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

export interface MailReadStore {
  listMailboxes(input: ListMailboxesInput): Promise<Page<MailboxDto>>;
  listMessages(input: ListMessagesInput): Promise<Page<MessageListItemDto>>;
  getMessage(input: GetMessageInput): Promise<MessageDetailDto | undefined>;
  getAttachmentDownload(
    input: GetAttachmentDownloadInput,
  ): Promise<AttachmentDownloadRef | undefined>;
}
