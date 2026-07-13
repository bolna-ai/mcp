import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

/**
 * Phase 1 auth (see bolna-mcp-tool-design.md §6): the Bolna API key is the
 * bearer token supplied by the caller in the Authorization header. When no
 * bearer token is present (e.g. local MCP Inspector runs), fall back to
 * BOLNA_API_KEY from the environment.
 */
export async function verifyToken(
  _req: Request,
  bearerToken?: string
): Promise<AuthInfo | undefined> {
  const token = bearerToken || process.env.BOLNA_API_KEY;
  if (!token) return undefined;

  return {
    token,
    clientId: "bolna-mcp",
    scopes: [],
  };
}

export interface ToolExtra {
  authInfo?: AuthInfo;
}

export function getApiKey(extra: ToolExtra): string | undefined {
  return extra?.authInfo?.token || process.env.BOLNA_API_KEY || undefined;
}
