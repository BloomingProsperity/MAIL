export function createApiFetch(
  fetchImpl: typeof fetch,
  apiToken?: string,
): typeof fetch {
  const token = apiToken?.trim();
  return ((input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = normalizeHeaders(init.headers);
    if (token) {
      headers.authorization = `Bearer ${token}`;
    }

    return fetchImpl(input, {
      ...init,
      credentials: init.credentials ?? "same-origin",
      headers,
    });
  }) as typeof fetch;
}

function normalizeHeaders(
  headers: HeadersInit | undefined,
): Record<string, string> {
  if (!headers) {
    return {};
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }

  return { ...headers };
}
