import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Search } from "lucide-react";

import { mailItemKey } from "../mail/mail-items";
import type { MailItem, Tone } from "../mail/mail-items";
import type {
  EmailHubApi,
  MessageListItemDto,
} from "../../lib/emailHubApi";
import type {
  LabelItem,
  QuickCategory,
  SearchLaunch,
} from "../mail/MailWorkspaceTypes";
import {
  formatMailDate,
} from "../mail/mailWorkspaceUtils";

type MessageListSearchInput = Parameters<EmailHubApi["listMessages"]>[0];

function mapMessageDtoToMailItem(message: MessageListItemDto): MailItem {
  return {
    id: message.id,
    accountId: message.accountId,
    receivedAt: message.receivedAt,
    sender: message.from.name ?? message.from.email,
    email: message.from.email,
    subject: message.subject,
    preview: message.snippet ?? "",
    time: formatMailTime(message.receivedAt),
    date: formatMailDate(message.receivedAt),
    label: bucketLabel(message.classification.bucket),
    tone: toneForBucket(message.classification.bucket),
    unread: message.unread,
    starred: message.starred,
    attachmentCount: message.attachmentCount,
    mailboxIds: message.mailboxIds,
    bucket: message.classification.bucket,
    score: message.classification.priorityScore,
    reasons: userFacingClassificationReasons(message.classification.reasons),
    searchPreview: message.searchPreview?.text,
  };
}

function formatMailTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function bucketLabel(bucket: string): string {
  if (bucket.includes("Urgent")) return "优先";
  if (bucket.includes("Important")) return "重要";
  if (bucket.includes("Feed")) return "动态";
  if (bucket.includes("Transactions")) return "通知";
  return "邮件";
}

function toneForBucket(bucket: string): Tone {
  if (bucket.includes("Urgent")) return "coral";
  if (bucket.includes("Important")) return "green";
  if (bucket.includes("Feed")) return "purple";
  if (bucket.includes("Transactions")) return "blue";
  return "yellow";
}

function userFacingClassificationReasons(reasons: string[]): string[] {
  return reasons.map(formatClassificationReason).filter(Boolean);
}

function formatClassificationReason(reason: string): string {
  const normalized = reason.trim();
  const movedMatch = normalized.match(
    /^User moved(?: .+)? to (Newsletters|Feed|Notifications|Personal|Important)$/i,
  );
  if (movedMatch) {
    const targetLabels: Record<string, string> = {
      newsletters: "订阅",
      feed: "动态",
      notifications: "通知",
      personal: "个人",
      important: "重要",
    };
    return `已归入${targetLabels[movedMatch[1].toLowerCase()] ?? "邮件"}`;
  }
  return normalized;
}

function normalizeAggregateSearchQuery(value: string): string {
  const trimmed = value.trim();
  const cleaned = trimmed
    .replace(/(帮我|找一下|找一找|找找|查找|搜索|找到|找|邮件|封邮件)/gi, " ")
    .replace(/(发件人|收件人|联系人|主题|正文|内容|附件|有哪些|在哪里|哪个|哪里|在哪)/gi, " ")
    .replace(/[?？,，。；;:：]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || trimmed;
}

function compactListMessagesInput(
  input: MessageListSearchInput,
): MessageListSearchInput {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => {
      if (Array.isArray(value)) {
        return value.length > 0;
      }
      return value !== undefined && value !== "";
    }),
  ) as MessageListSearchInput;
}

function searchInputFromLaunch(
  launchOverride?: Omit<SearchLaunch, "query" | "requestId">,
): MessageListSearchInput {
  if (!launchOverride) {
    return {};
  }

  return compactListMessagesInput({
    mailboxId: launchOverride.mailboxId,
    mailboxRole: launchOverride.mailboxRole,
    savedView: launchOverride.savedView,
    quickFilters: launchOverride.quickFilters,
    qScopes: launchOverride.qScopes,
    labelIds: launchOverride.labelIds,
    tagMode: launchOverride.tagMode,
    senderQuery: launchOverride.senderQuery,
    recipientQuery: launchOverride.recipientQuery,
    receivedAfter: launchOverride.receivedAfter,
    receivedBefore: launchOverride.receivedBefore,
    hasAttachment: launchOverride.hasAttachment,
  });
}

export function SearchPage(props: {
  api?: EmailHubApi;
  accountId: string;
  restrictToAccount?: boolean;
  labels: LabelItem[];
  quickCategories: QuickCategory[];
  launch?: SearchLaunch;
  previewMail: MailItem;
  onOpenResult: (mail: MailItem) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MailItem[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [notice, setNotice] = useState("");
  const [searchAllAccounts, setSearchAllAccounts] = useState(
    () => !props.restrictToAccount,
  );
  const searchRequestRef = useRef(0);

  function startSearchRequest(): number {
    searchRequestRef.current += 1;
    return searchRequestRef.current;
  }

  async function executeSearch(
    rawQuery: string,
    launchOverride?: Omit<SearchLaunch, "query" | "requestId">,
    isParentRequestCurrent: () => boolean = () => true,
  ) {
    const searchRequestId = startSearchRequest();
    const isCurrentRequest = () =>
      searchRequestRef.current === searchRequestId && isParentRequestCurrent();
    const trimmedQuery = normalizeAggregateSearchQuery(rawQuery);

    if (!trimmedQuery) {
      setResults([]);
      setHasSearched(false);
      setNotice("");
      return false;
    }

    if (!props.api) {
      setResults([
        {
          ...props.previewMail,
          subject: "关于 Q2 合作方案的确认",
          preview: "命中：合同、附件、客户标签",
        },
      ]);
      setHasSearched(true);
      setNotice("邮箱服务未连接。");
      return true;
    }

    const hasLaunchOverride = launchOverride !== undefined;
    const effectiveSearchAllAccounts = props.restrictToAccount
      ? false
      : hasLaunchOverride
        ? !launchOverride?.accountId
        : searchAllAccounts;
    const effectiveAccountId = launchOverride?.accountId ?? props.accountId;

    if (!effectiveSearchAllAccounts && !effectiveAccountId) {
      setResults([]);
      setHasSearched(true);
      setNotice("未选择邮箱。");
      return false;
    }

    return executeListMessagesSearch(
      compactListMessagesInput({
        ...(effectiveSearchAllAccounts ? {} : { accountId: effectiveAccountId }),
        ...searchInputFromLaunch(launchOverride),
        limit: 50,
        q: trimmedQuery,
        sort: "time",
      }),
      effectiveSearchAllAccounts,
      isCurrentRequest,
    );
  }

  async function executeListMessagesSearch(
    input: MessageListSearchInput,
    isAllAccounts: boolean,
    isCurrentRequest: () => boolean,
  ) {
    if (!props.api) {
      setResults([
        {
          ...props.previewMail,
          subject: "关于 Q2 合作方案的确认",
          preview: "命中：合同、附件、客户标签",
        },
      ]);
      setHasSearched(true);
      setNotice("邮箱服务未连接。");
      return true;
    }

    setNotice("");
    try {
      const page = await props.api.listMessages(input);
      if (!isCurrentRequest()) {
        return false;
      }
      const mappedResults = page.items.map(mapMessageDtoToMailItem);
      setResults(mappedResults);
      setHasSearched(true);
      setNotice(
        mappedResults.length > 0
          ? isAllAccounts
            ? "已搜索所有邮箱。"
            : "已搜索当前邮箱。"
          : "没有找到匹配邮件。",
      );
      return true;
    } catch {
      if (!isCurrentRequest()) {
        return false;
      }
      setResults([]);
      setHasSearched(true);
      setNotice("搜索暂时不可用。");
      return false;
    }
  }

  async function runSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await executeSearch(query);
  }

  useEffect(() => {
    if (!props.launch?.query) {
      return;
    }

    setQuery(props.launch.query);
    setSearchAllAccounts(
      props.restrictToAccount ? false : !props.launch.accountId,
    );
    void executeSearch(props.launch.query, props.launch);
  }, [props.launch?.requestId]);

  useEffect(() => {
    if (props.restrictToAccount) {
      setSearchAllAccounts(false);
    }
  }, [props.accountId, props.restrictToAccount]);

  return (
    <section className="workspace-page page-scroll search-page">
      <header className="topbar single">
        <div>
          <h1>搜索</h1>
        </div>
      </header>
      <section className="page-panel search-panel">
          <form className="search-form" onSubmit={runSearch}>
            <label className="large-search">
              <Search size={21} />
            <input
              aria-label="搜索邮件"
              placeholder="搜索邮件、联系人、主题或附件"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
            <button className="primary-button" type="submit">
              执行搜索
            </button>
          </form>
          <div className="filter-row">
            <button
              className={searchAllAccounts ? "active" : ""}
              type="button"
              aria-label="搜索全部账号"
              disabled={props.restrictToAccount}
              onClick={() => {
                if (!props.restrictToAccount) {
                  setSearchAllAccounts(true);
                }
              }}
            >
              全部账号
            </button>
            <button
              className={!searchAllAccounts ? "active" : ""}
              type="button"
              aria-label="搜索当前账号"
              onClick={() => {
                setSearchAllAccounts(false);
              }}
            >
              当前账号
            </button>
          </div>
          {notice ? (
            <div className="backend-notice" role="status">
              <span>{notice}</span>
            </div>
          ) : null}
        {results.length > 0
          ? results.map((mail) => (
              <button
                className="search-result"
                key={mailItemKey(mail)}
                type="button"
                aria-label={`Open search result ${mail.subject}`}
                onClick={() => props.onOpenResult(mail)}
              >
                <strong>{mail.subject}</strong>
                <span>
                  {mail.searchPreview ?? mail.preview} · {mail.sender} · {mail.date}{" "}
                  {mail.time}
                </span>
              </button>
            ))
          : null}
        {hasSearched && results.length === 0 ? (
          <div className="empty-search">没有匹配邮件。</div>
        ) : null}
      </section>
    </section>
  );
}
