export function createApiTokenFetch(
  fetchImpl: typeof fetch,
  apiToken?: string,
): typeof fetch {
  const token = apiToken?.trim();
  if (!token) {
    return fetchImpl;
  }

  return ((input: RequestInfo | URL, init: RequestInit = {}) =>
    fetchImpl(input, {
      ...init,
      headers: {
        ...normalizeHeaders(init.headers),
        authorization: `Bearer ${token}`,
      },
    })) as typeof fetch;
}

function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
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
