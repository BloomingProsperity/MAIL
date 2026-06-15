export type SenderScreeningStatus = "unknown" | "accepted" | "blocked";

export interface GatekeeperSenderDto {
  senderId: string;
  email: string;
  domain: string;
  status: SenderScreeningStatus;
  messageCount: number;
  latestMessageId?: string;
  latestReceivedAt?: string;
  bulkAvailable: boolean;
}

export interface GatekeeperSenderPage {
  items: GatekeeperSenderDto[];
}

export interface SenderScreeningDecisionResult {
  senderId: string;
  email?: string;
  domain: string;
  status: "accepted" | "blocked";
  action: "accept" | "block_sender" | "block_domain";
  eventId: string;
}

export type SenderScreeningBulkAction = "accept" | "block";

export interface SenderScreeningBulkResult {
  items: SenderScreeningDecisionResult[];
  missingSenderIds: string[];
}

export interface SenderScreeningStore {
  listSenders(input: {
    accountId: string;
    status?: SenderScreeningStatus;
  }): Promise<GatekeeperSenderPage>;
  acceptSender(input: {
    accountId: string;
    senderId: string;
  }): Promise<SenderScreeningDecisionResult | undefined>;
  blockSender(input: {
    accountId: string;
    senderId: string;
  }): Promise<SenderScreeningDecisionResult | undefined>;
  bulkDecideSenders(input: {
    accountId: string;
    senderIds: string[];
    action: SenderScreeningBulkAction;
  }): Promise<SenderScreeningBulkResult>;
  blockDomain(input: {
    accountId: string;
    domain: string;
  }): Promise<SenderScreeningDecisionResult>;
}

export class InvalidSenderScreeningRequestError extends Error {
  readonly code = "invalid_sender_screening_request";

  constructor(message = "invalid sender screening request") {
    super(message);
  }
}
