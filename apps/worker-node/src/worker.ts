export interface WorkerDescription {
  name: "email-hub-worker";
  lanes: Array<
    | "sync"
    | "mirror"
    | "commands"
    | "hermes"
    | "import"
    | "alias_delivery"
    | "scheduled_send"
    | "follow_up_reminder"
    | "attachment_text_extraction"
  >;
  ready: boolean;
}

export function describeWorker(): WorkerDescription {
  return {
    name: "email-hub-worker",
    lanes: [
      "sync",
      "mirror",
      "commands",
      "hermes",
      "import",
      "alias_delivery",
      "scheduled_send",
      "follow_up_reminder",
      "attachment_text_extraction",
    ],
    ready: true,
  };
}
