export interface MailReadCursorPayload {
  v: 1;
  receivedAt: string;
  id: string;
  priorityScore?: number;
}

export class InvalidMailReadCursorError extends Error {
  constructor() {
    super("invalid mail read cursor");
  }
}

export function encodeMailReadCursor(payload: MailReadCursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeMailReadCursor(cursor: string): MailReadCursorPayload {
  try {
    const payload = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Partial<MailReadCursorPayload>;

    if (payload.v !== 1) {
      throw new InvalidMailReadCursorError();
    }
    if (typeof payload.id !== "string" || payload.id.trim().length === 0) {
      throw new InvalidMailReadCursorError();
    }
    if (
      typeof payload.receivedAt !== "string" ||
      Number.isNaN(Date.parse(payload.receivedAt))
    ) {
      throw new InvalidMailReadCursorError();
    }

    const priorityScore =
      payload.priorityScore === undefined
        ? undefined
        : parsePriorityScore(payload.priorityScore);

    return {
      v: 1,
      receivedAt: new Date(payload.receivedAt).toISOString(),
      id: payload.id,
      ...(priorityScore === undefined ? {} : { priorityScore }),
    };
  } catch (error) {
    if (error instanceof InvalidMailReadCursorError) {
      throw error;
    }

    throw new InvalidMailReadCursorError();
  }
}

function parsePriorityScore(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new InvalidMailReadCursorError();
  }

  return value;
}
