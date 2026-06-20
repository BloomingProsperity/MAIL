import type { MailSearchScope } from "../../lib/emailHubApi";

export const mailSearchScopeOptions: Array<{
  scope: MailSearchScope;
  label: string;
  ariaLabel: string;
}> = [
  { scope: "sender", label: "发件人", ariaLabel: "搜索发件人范围" },
  { scope: "recipients", label: "收件人", ariaLabel: "搜索收件人范围" },
  { scope: "subject", label: "主题", ariaLabel: "搜索主题范围" },
  { scope: "body", label: "正文/附件", ariaLabel: "搜索正文和附件" },
];

const defaultScopeOrder = mailSearchScopeOptions.map((option) => option.scope);

export function defaultMailSearchScopes(): MailSearchScope[] {
  return [...defaultScopeOrder];
}

export function normalizeMailSearchScopes(
  scopes: MailSearchScope[] | undefined,
): MailSearchScope[] {
  const normalized = uniqueSearchScopes(scopes ?? []);
  return normalized.length > 0 ? normalized : defaultMailSearchScopes();
}

export function toggleMailSearchScope(
  current: MailSearchScope[],
  scope: MailSearchScope,
): MailSearchScope[] {
  const normalized = normalizeMailSearchScopes(current);
  if (!normalized.includes(scope)) {
    return [...normalized, scope];
  }

  return normalized.length === 1
    ? normalized
    : normalized.filter((item) => item !== scope);
}

function uniqueSearchScopes(scopes: MailSearchScope[]): MailSearchScope[] {
  const allowed = new Set(defaultScopeOrder);
  const seen = new Set<MailSearchScope>();
  return scopes.filter((scope) => {
    if (!allowed.has(scope) || seen.has(scope)) {
      return false;
    }
    seen.add(scope);
    return true;
  });
}
