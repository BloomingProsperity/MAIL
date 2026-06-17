import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { createEmailHubApi } from "./lib/emailHubApi";
import "./styles.css";

const env = (import.meta as ImportMeta & {
  env?: Record<string, string | undefined>;
}).env;
const api = createEmailHubApi({
  apiToken: env?.VITE_EMAILHUB_API_TOKEN,
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App api={api} />
  </React.StrictMode>
);
