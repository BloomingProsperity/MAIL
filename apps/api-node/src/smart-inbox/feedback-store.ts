export type SmartInboxFeedbackAction =
  | "mark_important"
  | "mark_not_important"
  | "move_to_personal"
  | "move_to_notifications"
  | "move_to_newsletters"
  | "move_to_feed"
  | "always_important_sender"
  | "mute_sender";

export interface SmartInboxClassificationDto {
  bucket: string;
  priorityScore: number;
  reasons: string[];
}

export interface SmartInboxFeedbackInput {
  accountId: string;
  messageId: string;
  action: SmartInboxFeedbackAction;
}

export interface SmartInboxFeedbackResult {
  feedbackEventId: string;
  accountId: string;
  messageId: string;
  classification: SmartInboxClassificationDto;
}

export interface SmartInboxFeedbackStore {
  recordFeedback(
    input: SmartInboxFeedbackInput,
  ): Promise<SmartInboxFeedbackResult | undefined>;
}
