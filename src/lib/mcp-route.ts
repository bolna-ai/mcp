import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools } from "../tools/index";
import { SERVER_INSTRUCTIONS } from "../tools/prompts";
import { verifyToken } from "./auth";

export interface McpRouteOptions {
  /** URL prefix the transport is mounted under, e.g. "/api" -> /api/mcp. */
  basePath: string;
  /** Extra registration step, e.g. restricting to the directory surface. */
  configureServer?: (server: McpServer) => void;
  /**
   * Where this surface's RFC 9728 metadata lives. It ends up in the
   * WWW-Authenticate header on a 401, and the document it points at has to
   * declare a `resource` equal to the URL the client actually connected to
   * — Claude compares the two and refuses on a mismatch. So each surface
   * needs its own, and the default is only right for /api/mcp.
   */
  resourceMetadataPath?: string;
  /** Server-level `instructions`, trimmed to match a restricted surface. */
  instructions?: string;
}

// A lone JSON-RPC request, or a batch (array) of them.
function isJsonRpcShaped(value: unknown): boolean {
  const isEnvelope = (v: unknown): boolean =>
    !!v &&
    typeof v === "object" &&
    (v as Record<string, unknown>).jsonrpc === "2.0" &&
    typeof (v as Record<string, unknown>).method === "string";
  return Array.isArray(value) ? value.length > 0 && value.every(isEnvelope) : isEnvelope(value);
}

// Redacts the credential itself; keeps only enough to tell what kind of
// caller this was (main key vs sub-account key vs OAuth) for debugging.
function describeAuth(header: string | null): string {
  if (!header) return "none";
  const token = header.replace(/^Bearer\s+/i, "");
  if (token.startsWith("bn-")) return "api-key(main)";
  if (token.startsWith("sa-")) return "api-key(sub-account)";
  return "oauth-token";
}

// Pulls the JSON-RPC result/error out of a streamable-HTTP SSE response
// body (lines like "data: {...}"), or a bare JSON response body.
function parseRpcResponseBody(text: string): { result?: unknown; error?: unknown } | null {
  const dataLine = text.split("\n").find((line) => line.startsWith("data: "));
  const jsonText = dataLine ? dataLine.slice("data: ".length) : text;
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

export function createBolnaMcpRoute({
  basePath,
  configureServer,
  resourceMetadataPath = "/.well-known/oauth-protected-resource",
  instructions = SERVER_INSTRUCTIONS,
}: McpRouteOptions) {
  const handler = createMcpHandler(
    (server) => {
      configureServer?.(server);
      registerAllTools(server);
    },
    {
      serverInfo: { name: "Bolna", version: "0.1.0" },
      instructions,
    },
    { basePath, maxDuration: 60, verboseLogs: false }
  );

  const authHandler = withMcpAuth(handler, verifyToken, {
    required: true,
    resourceMetadataPath,
  });

  /**
   * The MCP SDK rejects malformed JSON-RPC bodies (HTTP 400, code -32700)
   * deep inside its transport layer, before mcp-handler or any tool code
   * runs — so neither our own logs nor mcp-handler's verboseLogs ever see
   * what actually sent them. This peeks at the body first so a malformed
   * request leaves a usable trace in `vercel logs`, then forwards the
   * request on unchanged (bytes and all) to the real handler.
   *
   * For a well-formed `tools/call`, it also logs which tool ran, how long
   * it took, and whether it errored — the thing `vercel logs` can't show
   * on its own, since every tool shares the same route/method.
   */
  async function loggedPost(req: Request): Promise<Response> {
    const bodyText = await req.text();
    let parsedBody: unknown;
    let valid = false;
    try {
      parsedBody = JSON.parse(bodyText);
      valid = isJsonRpcShaped(parsedBody);
    } catch {
      valid = false;
    }
    if (!valid) {
      console.warn("[mcp] malformed JSON-RPC request", {
        surface: basePath,
        userAgent: req.headers.get("user-agent"),
        contentType: req.headers.get("content-type"),
        accept: req.headers.get("accept"),
        auth: describeAuth(req.headers.get("authorization")),
        ip: req.headers.get("x-forwarded-for"),
        bodyPreview: bodyText.slice(0, 500),
      });
    }

    const forwarded = new Request(req.url, {
      method: req.method,
      headers: req.headers,
      body: bodyText,
      signal: req.signal,
    });

    const rpcBody = parsedBody as Record<string, unknown> | undefined;
    const toolName =
      valid && !Array.isArray(rpcBody) && rpcBody?.method === "tools/call"
        ? ((rpcBody.params as Record<string, unknown> | undefined)?.name as string | undefined)
        : undefined;

    if (!toolName) {
      return authHandler(forwarded);
    }

    const start = Date.now();
    const response = await authHandler(forwarded);
    const durationMs = Date.now() - start;

    // Response bodies here are small JSON tool results, so buffering the
    // clone to inspect it costs single-digit milliseconds — worth paying
    // to guarantee the log line is written before a serverless function
    // freezes, rather than racing a fire-and-forget background read.
    let toolError: boolean | null = null;
    try {
      const rpc = parseRpcResponseBody(await response.clone().text());
      if (rpc?.error) toolError = true;
      else if (rpc?.result && typeof rpc.result === "object") {
        toolError = (rpc.result as Record<string, unknown>).isError === true;
      }
    } catch {
      // Leave toolError as null — inspecting the response is best-effort.
    }

    console.log("[mcp] tool_call", {
      surface: basePath,
      tool: toolName,
      httpStatus: response.status,
      error: toolError,
      durationMs,
      auth: describeAuth(req.headers.get("authorization")),
    });

    return response;
  }

  return { GET: authHandler, POST: loggedPost, DELETE: authHandler };
}
