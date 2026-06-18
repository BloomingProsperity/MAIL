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
      aria-label="Hermes 当前邮箱"
    >
      <strong>当前邮箱</strong>
      <span>
        {props.accountId
          ? `Hermes 会根据 ${accountLabel} 的邮件上下文工作。`
          : "请选择或添加邮箱，Hermes 会在对应邮箱内工作。"}
      </span>
      {canSelectAccount ? (
        <select
          aria-label="选择 Hermes 当前邮箱"
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
