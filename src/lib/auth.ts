import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

/**
 * Phase 2 auth (OAuth via Bolna's Supabase project). Two credential shapes
 * are accepted on the Authorization header, forwarded to api.bolna.ai
 * unchanged either way:
 *
 * 1. A Supabase-issued OAuth access token — verified by calling Supabase's
 *    own /oauth/userinfo endpoint (confirmed live 2026-07-17). This project's
 *    access tokens are signed HS256 (a shared secret), not RS256/ES256, so
 *    local JWKS-based signature verification (jose's createRemoteJWKSet)
 *    does NOT work here — JWKS only ever publishes asymmetric public keys.
 *    Calling /oauth/userinfo instead is a standard OAuth pattern (similar to
 *    RFC 7662 token introspection) and works regardless of signing
 *    algorithm. api.bolna.ai independently validates the same token against
 *    Supabase to resolve the account, so no user_id -> API key lookup
 *    exists or is needed in this server.
 * 2. A raw Bolna API key (`bn-...`) — passed through as before (phase 1),
 *    kept working for Claude Code/Cursor/etc. users who paste their own key
 *    directly rather than going through OAuth.
 *
 * For local development, set BOLNA_API_KEY and omit the Authorization
 * header entirely — this fallback only ever applies when no header is
 * present, so it never masks a real (even if invalid) caller-supplied
 * credential.
 */

const SUPABASE_ISSUER = "https://hbcyinehbjcanmnqywtg.supabase.co/auth/v1";

export async function verifyToken(
  _req: Request,
  bearerToken?: string
): Promise<AuthInfo | undefined> {
  if (!bearerToken) {
    const envKey = process.env.BOLNA_API_KEY;
    if (!envKey) return undefined;
    return { token: envKey, clientId: "local-dev", scopes: [] };
  }

  if (bearerToken.startsWith("bn-")) {
    return { token: bearerToken, clientId: "direct-api-key", scopes: [] };
  }

  try {
    const res = await fetch(`${SUPABASE_ISSUER}/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${bearerToken}` },
    });
    if (!res.ok) return undefined;

    const userinfo = await res.json();
    return {
      token: bearerToken,
      clientId:
        typeof userinfo.sub === "string" ? userinfo.sub : "supabase-user",
      scopes: [],
      extra: { sub: userinfo.sub, email: userinfo.email },
    };
  } catch {
    return undefined;
  }
}

export interface ToolExtra {
  authInfo?: AuthInfo;
}

export function getApiKey(extra: ToolExtra): string | undefined {
  return extra?.authInfo?.token || process.env.BOLNA_API_KEY || undefined;
}
