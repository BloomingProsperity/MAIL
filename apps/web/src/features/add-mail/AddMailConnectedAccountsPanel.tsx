import { ShieldCheck } from "lucide-react";

import type { SyncCenterAccountDto } from "../../lib/emailHubApi";
import { SyncCenterAccountNextAction } from "../sync-center/SyncCenterAccountNextAction";
import { SyncCenterLatestJobSummary } from "../sync-center/SyncCenterLatestJobSummary";
import { formatProviderLabel, formatSyncStateLabel } from "./addMailFormatters";

export function AddMailConnectedAccountsPanel(props: {
  accounts: SyncCenterAccountDto[];
}) {
  return (
    <section className="page-panel" aria-label="已添加邮箱账号">
      <div className="custom-server-heading">
        <div>
          <h2>已添加邮箱账号</h2>
        </div>
      </div>
      {props.accounts.map((account) => (
        <div className="task-row" key={account.accountId}>
          <ShieldCheck size={19} />
          <div>
            <strong>{account.email}</strong>
            <span>
              {formatProviderLabel(account.provider)} ·{" "}
              {formatSyncStateLabel(account.syncState)}
            </span>
            <SyncCenterAccountNextAction account={account} />
            <SyncCenterLatestJobSummary account={account} />
          </div>
        </div>
      ))}
    </section>
  );
}
