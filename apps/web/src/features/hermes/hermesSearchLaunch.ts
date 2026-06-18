import type {
  HermesEmailSearchQaResult,
  MailQuickFilter,
  MailSearchScope,
  MailTagMode,
} from "../../lib/emailHubApi";

export interface HermesSearchLaunchOptions {
  quickFilters?: MailQuickFilter[];
  qScopes?: MailSearchScope[];
  senderQuery?: string;
  recipientQuery?: string;
  receivedAfter?: string;
  receivedBefore?: string;
  hasAttachment?: boolean;
  labelIds?: string[];
  tagMode?: MailTagMode;
  savedView?: string;
  accountId?: string;
}

export function searchLaunchFromHermesResult(
  result: HermesEmailSearchQaResult,
  accountId?: string,
): HermesSearchLaunchOptions {
  const planInput = result.searchPlan.listMessagesInput as
    typeof result.searchPlan.listMessagesInput & {
      savedView?: string;
    };
  return {
    ...(accountId ? { accountId } : {}),
    ...(planInput.quickFilters ? { quickFilters: planInput.quickFilters } : {}),
    ...(planInput.qScopes ? { qScopes: planInput.qScopes } : {}),
    ...(planInput.senderQuery ? { senderQuery: planInput.senderQuery } : {}),
    ...(planInput.recipientQuery
      ? { recipientQuery: planInput.recipientQuery }
      : {}),
    ...(planInput.receivedAfter
      ? { receivedAfter: planInput.receivedAfter }
      : {}),
    ...(planInput.receivedBefore
      ? { receivedBefore: planInput.receivedBefore }
      : {}),
    ...(typeof planInput.hasAttachment === "boolean"
      ? { hasAttachment: planInput.hasAttachment }
      : {}),
    ...(planInput.labelIds ? { labelIds: planInput.labelIds } : {}),
    ...(planInput.tagMode ? { tagMode: planInput.tagMode } : {}),
    ...(planInput.savedView ? { savedView: planInput.savedView } : {}),
  };
}
