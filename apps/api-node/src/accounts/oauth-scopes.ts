export const GMAIL_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://mail.google.com/",
] as const;

export const MICROSOFT_GRAPH_MAIL_SCOPES = [
  "offline_access",
  "https://graph.microsoft.com/Mail.ReadWrite",
  "https://graph.microsoft.com/Mail.Send",
  "https://graph.microsoft.com/Mail.Send.Shared",
] as const;

export const MICROSOFT_OUTLOOK_IMAP_SMTP_SCOPES = [
  "offline_access",
  "https://outlook.office.com/IMAP.AccessAsUser.All",
  "https://outlook.office.com/SMTP.Send",
] as const;

export const OUTLOOK_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  ...MICROSOFT_OUTLOOK_IMAP_SMTP_SCOPES,
] as const;

export const MICROSOFT_GRAPH_MAIL_SCOPE =
  MICROSOFT_GRAPH_MAIL_SCOPES.join(" ");

export const MICROSOFT_OUTLOOK_IMAP_SMTP_SCOPE =
  MICROSOFT_OUTLOOK_IMAP_SMTP_SCOPES.join(" ");
