import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { registerAllTools } from "../../../src/tools/index";
import { verifyToken } from "../../../src/lib/auth";

const handler = createMcpHandler(
  (server) => {
    registerAllTools(server);
  },
  {
    serverInfo: {
      name: "Bolna",
      version: "0.1.0",
    },
  },
  {
    basePath: "/api",
    maxDuration: 60,
    verboseLogs: false,
  }
);

const authHandler = withMcpAuth(handler, verifyToken, {
  required: true,
  resourceMetadataPath: "/.well-known/oauth-protected-resource",
});

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

/**
 * The MCP SDK rejects malformed JSON-RPC bodies (HTTP 400, code -32700)
 * deep inside its transport layer, before mcp-handler or any tool code
 * runs — so neither our own logs nor mcp-handler's verboseLogs ever see
 * what actually sent them. This peeks at the body first so a malformed
 * request leaves a usable trace in `vercel logs`, then forwards the
 * request on unchanged (bytes and all) to the real handler.
 */
async function loggedPost(req: Request): Promise<Response> {
  const bodyText = await req.text();
  let valid = false;
  try {
    valid = isJsonRpcShaped(JSON.parse(bodyText));
  } catch {
    valid = false;
  }
  if (!valid) {
    console.warn("[mcp] malformed JSON-RPC request", {
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
  return authHandler(forwarded);
}

export { authHandler as GET, loggedPost as POST, authHandler as DELETE };
