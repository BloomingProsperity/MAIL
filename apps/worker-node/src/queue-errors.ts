export class NonRetryableQueueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableQueueError";
  }
}

export function isNonRetryableQueueError(
  error: unknown,
): error is NonRetryableQueueError {
  return error instanceof NonRetryableQueueError;
}
