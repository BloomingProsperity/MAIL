import type { MailActionResult } from "../../lib/emailHubApi";

export type Tone = "coral" | "blue" | "green" | "yellow" | "purple";

export interface MailItem {
  id: string;
  accountId: string;
  receivedAt: string;
  sender: string;
  email: string;
  subject: string;
  preview: string;
  time: string;
  date: string;
  label: string;
  tone: Tone;
  unread: boolean;
  starred: boolean;
  attachmentCount: number;
  mailboxIds?: string[];
  labelIds?: string[];
  bucket: string;
  score: number;
  reasons: string[];
  searchPreview?: string;
}

export function mailItemKey(mail: Pick<MailItem, "accountId" | "id">): string {
  return `${mail.accountId}:${mail.id}`;
}

export function dedupeMailItems(items: MailItem[]): MailItem[] {
  const seen = new Set<string>();
  const result: MailItem[] = [];
  for (const item of items) {
    const key = mailItemKey(item);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

export function applyMailActionStateToMailItem(
  item: MailItem,
  result: MailActionResult,
): MailItem {
  return {
    ...item,
    unread: result.state.unread,
    starred: result.state.starred,
    mailboxIds: result.state.mailboxIds,
    labelIds: result.state.labelIds,
  };
}
