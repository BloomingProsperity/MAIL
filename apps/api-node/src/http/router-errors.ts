export class InvalidImapSmtpAccountError extends Error {
  constructor(
    readonly code:
      | "invalid_imap_smtp_account"
      | "invalid_imap_smtp_connection_test" = "invalid_imap_smtp_account",
    message?: string,
  ) {
    super(message);
  }
}

export class InvalidOAuthRequestError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(code);
  }
}

export class InvalidMailReadRequestError extends Error {
  readonly code = "invalid_mail_read_request";
  readonly statusCode = 400;

  constructor() {
    super("invalid_mail_read_request");
  }
}

export class InvalidSmartInboxFeedbackError extends Error {
  readonly code = "invalid_smart_inbox_feedback";

  constructor() {
    super("invalid_smart_inbox_feedback");
  }
}

export class InvalidHermesMemoryRequestError extends Error {
  readonly code = "invalid_hermes_memory_request";

  constructor() {
    super("invalid_hermes_memory_request");
  }
}

export class InvalidHermesDraftFeedbackRequestError extends Error {
  readonly code = "invalid_draft_feedback_request";

  constructor() {
    super("invalid_draft_feedback_request");
  }
}

export class InvalidComposeAttachmentMaintenanceRequestError extends Error {
  readonly code = "invalid_compose_attachment_maintenance_request";

  constructor() {
    super("invalid_compose_attachment_maintenance_request");
  }
}

export class InvalidHermesRetentionMaintenanceRequestError extends Error {
  readonly code = "invalid_hermes_retention_maintenance_request";

  constructor() {
    super("invalid_hermes_retention_maintenance_request");
  }
}

export class RequestBodyTooLargeError extends Error {
  readonly code = "request_body_too_large";

  constructor() {
    super("request_body_too_large");
  }
}
