export function syncingAccountExistsClause(accountIdExpression: string): string {
  return `
              AND EXISTS (
                SELECT 1
                FROM connected_accounts
                WHERE connected_accounts.id = ${accountIdExpression}
                  AND connected_accounts.sync_state = 'syncing'
              )
  `;
}
