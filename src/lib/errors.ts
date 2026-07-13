/**
 * Error handling per bolna-mcp-tool-design.md §5:
 * - never return a bare "Internal Server Error"
 * - pass through the Bolna error body's message plus HTTP status
 * - map 401 / 404 / 422 / 429 to actionable messages
 */

export class MissingApiKeyError extends Error {
  constructor() {
    super(
      "No Bolna API key was provided. Pass it as a Bearer token in the " +
        "Authorization header when calling this MCP server, or set " +
        "BOLNA_API_KEY in the environment for local development."
    );
    this.name = "MissingApiKeyError";
  }
}

export class BolnaApiError extends Error {
  status: number;
  bolnaMessage: string;
  retryAfter?: string;

  constructor(status: number, body: unknown, retryAfter?: string) {
    const bolnaMessage = extractMessage(body);
    super(`Bolna API error (HTTP ${status}): ${bolnaMessage}`);
    this.name = "BolnaApiError";
    this.status = status;
    this.bolnaMessage = bolnaMessage;
    this.retryAfter = retryAfter;
  }
}

function extractMessage(body: unknown): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (typeof record.message === "string" && record.message.length > 0) {
      return record.message;
    }
    // Auth-related errors (e.g. invalid API key) come back as {"detail": "..."}
    // rather than {"message": "..."} — confirmed against the live API.
    if (typeof record.detail === "string" && record.detail.length > 0) {
      return record.detail;
    }
    if (typeof record.error === "string" && record.error.length > 0) {
      return record.error;
    }
  }
  if (typeof body === "string" && body.length > 0) return body;
  return "no further details were returned by the Bolna API";
}

export interface ToolErrorContext {
  agentId?: string;
  executionId?: string;
}

/** Shapes any thrown error into an MCP CallToolResult with isError: true. */
export function toErrorResult(err: unknown, context: ToolErrorContext = {}) {
  return {
    content: [{ type: "text" as const, text: describeError(err, context) }],
    isError: true as const,
  };
}

function describeError(err: unknown, context: ToolErrorContext): string {
  if (err instanceof MissingApiKeyError) {
    return err.message;
  }

  if (err instanceof BolnaApiError) {
    switch (err.status) {
      case 401:
      case 403:
        // The live API returns 403 (not 401) for an invalid/expired key.
        return "Bolna API key invalid or expired. Provide a valid Bolna API key.";
      case 404: {
        if (context.agentId) {
          return (
            `Agent '${context.agentId}' not found (HTTP 404: ${err.bolnaMessage}). ` +
            "Call list_agents to see valid agent IDs."
          );
        }
        if (context.executionId) {
          return (
            `Execution '${context.executionId}' not found (HTTP 404: ${err.bolnaMessage}). ` +
            "Call list_agent_executions to see valid execution IDs."
          );
        }
        return `Not found (HTTP 404): ${err.bolnaMessage}`;
      }
      case 422:
        return `Validation error (HTTP 422): ${err.bolnaMessage}`;
      case 429: {
        const retry = err.retryAfter
          ? ` Retry after ${err.retryAfter} seconds.`
          : "";
        return `Rate limited by the Bolna API (HTTP 429): ${err.bolnaMessage}.${retry}`;
      }
      default:
        return err.message;
    }
  }

  if (err instanceof Error) {
    return `Failed to reach the Bolna API: ${err.message}`;
  }

  return `Failed to reach the Bolna API: ${String(err)}`;
}
