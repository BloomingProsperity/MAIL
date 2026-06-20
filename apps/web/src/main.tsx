import React from "react";
import ReactDOM from "react-dom/client";
import { EmailHubRoot } from "./EmailHubRoot";
import { createEmailHubApi } from "./lib/emailHubApi";
import "./styles.css";
import "./styles-panels.css";
import "./features/mail/MailMobileLayout.css";
import "./features/domain-alias/DomainAliasSettingsPanel.css";

const env = (import.meta as ImportMeta & {
  env?: Record<string, string | undefined>;
}).env;
const api = createEmailHubApi();
const defaultAccountId =
  env?.VITE_EMAILHUB_DEFAULT_ACCOUNT_ID?.trim() || undefined;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <EmailHubRoot
      api={api}
      defaultAccountId={defaultAccountId}
      restrictToDefaultAccount={Boolean(defaultAccountId)}
    />
  </React.StrictMode>
);
