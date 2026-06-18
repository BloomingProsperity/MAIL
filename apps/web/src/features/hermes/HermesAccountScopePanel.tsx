export interface HermesAccountScopeOption {
  id: string;
  label: string;
  email?: string;
}

export function HermesAccountScopePanel(props: {
  accountId?: string;
  accounts?: HermesAccountScopeOption[];
  onAccountChange?: (accountId: string) => void;
}) {
  const accounts = props.accounts ?? [];
  const selectedAccount = props.accounts?.find(
    (account) => account.id === props.accountId,
  );
  const accountLabel =
    selectedAccount?.label ?? selectedAccount?.email ?? props.accountId;
  const canSelectAccount =
    Boolean(props.onAccountChange) && accounts.length > 0;

  return (
    <section
      className="backend-notice compact"
      aria-label="Hermes account scope"
    >
      <strong>Hermes 账号作用域</strong>
      <span>
        {props.accountId
          ? `规则、学习记录和审计日志当前绑定到 ${accountLabel}。`
          : "请先选择或添加邮箱，规则、学习记录和审计日志不会请求后端。"}
      </span>
      {canSelectAccount ? (
        <select
          aria-label="Select Hermes settings account"
          value={props.accountId ?? ""}
          onChange={(event) => props.onAccountChange?.(event.target.value)}
        >
          <option value="">选择账号</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.email ? `${account.label} · ${account.email}` : account.label}
            </option>
          ))}
        </select>
      ) : null}
    </section>
  );
}
