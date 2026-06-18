export const GMAIL_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.settings.basic",
] as const;

export const MICROSOFT_GRAPH_MAIL_SCOPES = [
  "offline_access",
  "https://graph.microsoft.com/Mail.ReadWrite",
  "https://graph.microsoft.com/Mail.Send",
  "https://graph.microsoft.com/Mail.Send.Shared",
] as const;

export const OUTLOOK_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  ...MICROSOFT_GRAPH_MAIL_SCOPES,
] as const;

export const MICROSOFT_GRAPH_MAIL_SCOPE =
  MICROSOFT_GRAPH_MAIL_SCOPES.join(" ");
