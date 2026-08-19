// The HTTP half of the platform layer: one request helper with retries, one that follows OData
// paging, and a bounded-concurrency map. Tokens come from `auth.ts`, which signs in on its own.
//
// Nothing here spawns a process any more. The Azure CLI carried every token until 2026-08-19 and is
// now gone from the package entirely — see auth.ts for what replaced it and why there are two
// first-party clients rather than one.
export const RESOURCE = {
  flow: 'https://service.flow.microsoft.com/',
  powerapps: 'https://service.powerapps.com/',
} as const;

export class ApiError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(status: number, url: string, body?: string) {
    super(`HTTP ${status} — ${shortUrl(url)}${body ? `: ${body.slice(0, 300)}` : ''}`);
    this.name = 'ApiError';
    this.status = status;
    this.url = url;
  }
}

function shortUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.host + parsed.pathname;
  } catch {
    return url;
  }
}

export interface RequestOptions {
  accept?: string;
  headers?: Record<string, string>;
}

/** GET one JSON document, with a couple of retries on throttling and transient failures. */
export async function apiGet<T>(url: string, token: string, options: RequestOptions = {}): Promise<T> {
  const { accept = 'application/json', headers = {} } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: accept, ...headers },
        // Far above any real answer, so it only ever fires on a socket the other end abandoned.
        signal: AbortSignal.timeout(120_000),
      });
    } catch (error) {
      lastError = error;
      await sleep(500 * (attempt + 1));
      continue;
    }
    if (response.status === 429 || response.status >= 500) {
      const retryAfter = Number(response.headers.get('retry-after')) || attempt + 1;
      lastError = new ApiError(response.status, url, await safeText(response));
      await sleep(Math.min(retryAfter, 10) * 1000);
      continue;
    }
    if (response.status === 401) {
      // A stepped-up token is being demanded (continuous access evaluation). We deliberately do not
      // satisfy it: doing so means threading a claims challenge from here back into the token layer
      // and re-acquiring, for a case that is rare inside a run of a minute or two. Naming it is what
      // turns an unexplainable 401 into an instruction.
      const challenge = response.headers.get('www-authenticate') ?? '';
      if (/insufficient_claims|claims=/i.test(challenge)) {
        throw new ApiError(401, url, 'the service demands a stepped-up token (conditional access) — '
          + 'run ppgraph --logout and sign in again');
      }
    }
    if (!response.ok) throw new ApiError(response.status, url, await safeText(response));
    return (await response.json()) as T;
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

interface PagedBody<T> {
  value?: T[];
  '@odata.nextLink'?: string;
  nextLink?: string;
}

/** GET a paged OData/ARM collection and concatenate every page. */
export async function apiGetAll<T>(
  url: string,
  token: string,
  options: RequestOptions & { maxPages?: number } = {},
): Promise<T[]> {
  const { maxPages = 25, ...request } = options;
  const items: T[] = [];
  let next: string | undefined = url;

  for (let page = 0; page < maxPages && next; page++) {
    const body: PagedBody<T> = await apiGet<PagedBody<T>>(next, token, request);
    if (Array.isArray(body.value)) items.push(...body.value);
    else if (Array.isArray(body)) items.push(...(body as T[]));
    next = body['@odata.nextLink'] ?? body.nextLink;
  }
  return items;
}

function safeText(response: Response): Promise<string> {
  return response.text().catch(() => '');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/** Run tasks with a bounded concurrency — fast enough, polite enough not to get throttled. */
export async function pooled<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await worker(item, index);
    }
  });

  await Promise.all(runners);
  return results;
}
