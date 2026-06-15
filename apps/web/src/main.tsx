import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { createEmailHubApi } from "./lib/emailHubApi";
import "./styles.css";

const api = createEmailHubApi();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App api={api} />
  </React.StrictMode>
);
