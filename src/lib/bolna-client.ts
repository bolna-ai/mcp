import { BolnaApiError, MissingApiKeyError } from "./errors";

const BOLNA_BASE_URL = process.env.BOLNA_BASE_URL || "https://api.bolna.ai";

interface BolnaRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

function buildUrl(path: string, query?: BolnaRequestOptions["query"]): string {
  const url = new URL(path, BOLNA_BASE_URL);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/**
 * Fetches a Bolna API endpoint using the caller-supplied API key.
 * Logs only tool metadata elsewhere (never arguments) per §5's
 * no-conversation-data-collection rule; this function itself does no logging.
 */
export async function bolnaFetch<T = unknown>(
  path: string,
  apiKey: string | undefined,
  options: BolnaRequestOptions = {}
): Promise<T> {
  if (!apiKey) throw new MissingApiKeyError();

  const res = await fetch(buildUrl(path, options.query), {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    throw new BolnaApiError(
      res.status,
      parsed,
      res.headers.get("retry-after") ?? undefined
    );
  }

  return parsed as T;
}
