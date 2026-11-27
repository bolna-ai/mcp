import { BolnaApiError, MissingApiKeyError } from "./errors";

const BOLNA_BASE_URL = process.env.BOLNA_BASE_URL || "https://api.bolna.ai";

// Below the route's 60s maxDuration, so a hung request comes back as a tool
// error instead of the platform killing the function mid-call.
const UPSTREAM_TIMEOUT_MS = 50_000;

interface BolnaRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** When set, body is sent as multipart/form-data instead of JSON (e.g. batch creation, which takes a CSV file). */
  form?: FormData;
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

  // For multipart requests, fetch must set its own Content-Type (with the
  // boundary) — setting it manually here would omit the boundary and break
  // the upload, so the header is only added for the JSON path.
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
  if (!options.form) headers["Content-Type"] = "application/json";

  let res: Response;
  let text: string;
  try {
    res = await fetch(buildUrl(path, options.query), {
      method: options.method ?? "GET",
      headers,
      body: options.form ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    text = await res.text();
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new Error(`no response after ${UPSTREAM_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  }
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
