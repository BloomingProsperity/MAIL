export type ComposePreviewWarning =
  | "missing_recipient"
  | "missing_body"
  | "missing_subject"
  | "large_body"
  | "duplicate_recipient"
  | "possible_missing_attachment"
  | "external_recipient_warning";

export interface ComposePreviewAddress {
  address: string;
  name?: string;
}

export interface ComposePreviewWarningInput {
  from?: ComposePreviewAddress;
  to?: ComposePreviewAddress[];
  cc?: ComposePreviewAddress[];
  bcc?: ComposePreviewAddress[];
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  attachments?: unknown[];
}

export function buildComposePreviewWarnings(
  input: ComposePreviewWarningInput,
): ComposePreviewWarning[] {
  const warnings: ComposePreviewWarning[] = [];
  const to = input.to ?? [];
  const cc = input.cc ?? [];
  const bcc = input.bcc ?? [];

  if (to.length === 0) {
    warnings.push("missing_recipient");
  }
  if (!input.subject.trim()) {
    warnings.push("missing_subject");
  }
  if (!input.bodyText?.trim() && !input.bodyHtml?.trim()) {
    warnings.push("missing_body");
  }
  if (estimateComposeDraftSize(input) > 512_000) {
    warnings.push("large_body");
  }
  if (hasDuplicateRecipient([...to, ...cc, ...bcc])) {
    warnings.push("duplicate_recipient");
  }
  if (mentionsAttachment(input) && (input.attachments?.length ?? 0) === 0) {
    warnings.push("possible_missing_attachment");
  }
  if (hasExternalRecipient(input.from, [...to, ...cc, ...bcc])) {
    warnings.push("external_recipient_warning");
  }

  return warnings;
}

export function estimateComposeDraftSize(
  input: ComposePreviewWarningInput,
): number {
  return [
    input.subject,
    input.bodyText ?? "",
    input.bodyHtml ?? "",
    ...(input.to ?? []).map(formatAddress),
    ...(input.cc ?? []).map(formatAddress),
    ...(input.bcc ?? []).map(formatAddress),
  ].join("\n").length;
}

function hasDuplicateRecipient(recipients: ComposePreviewAddress[]): boolean {
  const seen = new Set<string>();
  for (const recipient of recipients) {
    const address = normalizeEmailAddress(recipient.address);
    if (!address) {
      continue;
    }
    if (seen.has(address)) {
      return true;
    }
    seen.add(address);
  }
  return false;
}

function mentionsAttachment(input: ComposePreviewWarningInput): boolean {
  const text = [input.subject, input.bodyText ?? "", input.bodyHtml ?? ""]
    .join("\n")
    .toLowerCase();
  return (
    /\battach(?:ed|ment|ments|ing)?\b/.test(text) ||
    /附件|随附|附上|见附件|請見附件|请见附件/.test(text)
  );
}

function hasExternalRecipient(
  from: ComposePreviewAddress | undefined,
  recipients: ComposePreviewAddress[],
): boolean {
  const fromDomain = emailDomain(from?.address);
  if (!fromDomain) {
    return false;
  }

  return recipients.some((recipient) => {
    const recipientDomain = emailDomain(recipient.address);
    return Boolean(recipientDomain && recipientDomain !== fromDomain);
  });
}

function emailDomain(value: string | undefined): string | undefined {
  const address = normalizeEmailAddress(value);
  const atIndex = address.lastIndexOf("@");
  if (atIndex <= 0 || atIndex >= address.length - 1) {
    return undefined;
  }
  return address.slice(atIndex + 1);
}

function normalizeEmailAddress(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function formatAddress(address: ComposePreviewAddress): string {
  return address.name ? `${address.name} <${address.address}>` : address.address;
}
