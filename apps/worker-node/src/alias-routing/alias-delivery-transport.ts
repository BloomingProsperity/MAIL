import type { AliasDeliveryTransport } from "./alias-delivery-runner.js";
import {
  PermanentAliasDeliveryError,
  TemporaryAliasDeliveryError,
} from "./alias-delivery-runner.js";

export { PermanentAliasDeliveryError, TemporaryAliasDeliveryError };

export interface HttpAliasDeliveryTransportOptions {
  endpointUrl: string;
  fetchImpl?: typeof fetch;
}

export function createHttpAliasDeliveryTransport(
  options: HttpAliasDeliveryTransportOptions,
): AliasDeliveryTransport {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async deliver(input) {
      const response = await fetchImpl(options.endpointUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });

      if (response.ok) {
        return parseSuccess(response);
      }

      const message = await responseErrorMessage(response);
      if (
        (response.status >= 400 && response.status < 500) ||
        response.status === 550
      ) {
        throw new PermanentAliasDeliveryError(message);
      }

      throw new TemporaryAliasDeliveryError(message);
    },
  };
}

export function createConfiguredAliasDeliveryTransport(input: {
  endpointUrl?: string;
}): AliasDeliveryTransport | undefined {
  return input.endpointUrl
    ? createHttpAliasDeliveryTransport({ endpointUrl: input.endpointUrl })
    : undefined;
}

async function parseSuccess(
  response: Response,
): Promise<{ providerMessageId?: string }> {
  const payload = await readJson(response);
  const providerMessageId =
    payload && typeof payload.providerMessageId === "string"
      ? payload.providerMessageId
      : undefined;

  return providerMessageId ? { providerMessageId } : {};
}

async function responseErrorMessage(response: Response): Promise<string> {
  const payload = await readJson(response);
  if (payload && typeof payload.error === "string" && payload.error.trim()) {
    return payload.error;
  }

  return `alias delivery transport returned HTTP ${response.status}`;
}

async function readJson(
  response: Response,
): Promise<Record<string, unknown> | undefined> {
  try {
    const payload = (await response.json()) as unknown;
    return payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
