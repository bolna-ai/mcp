/**
 * RFC 9728 protected resource metadata, shared by both MCP surfaces.
 *
 * The `resource` field must exactly match the URL the client actually
 * connects to (Claude enforces this), so it cannot be a single hardcoded
 * string once there is more than one surface: a client connecting to
 * /api/connector/mcp that is handed `resource: ".../api/mcp"` fails the
 * check and never reaches the consent screen.
 *
 * Origin is always derived from the incoming request rather than
 * configured, so this works in local dev (http://localhost:3000/...) and
 * in production (https://mcp.bolna.ai/...) without separate config.
 */

const SUPABASE_ISSUER = "https://hbcyinehbjcanmnqywtg.supabase.co/auth/v1";

/**
 * The transport paths this server will vend metadata for. Anything else
 * 404s rather than being echoed back, so the endpoint can't be used to
 * advertise an arbitrary URL on this origin as an OAuth-protected resource.
 *
 * Both surfaces are listed with their SSE aliases because mcp-handler
 * derives /mcp, /sse and /message from a single basePath, and an older
 * client may still connect over SSE.
 */
export const KNOWN_RESOURCE_PATHS: ReadonlySet<string> = new Set([
  "/api/mcp",
  "/api/sse",
  "/api/connector/mcp",
  "/api/connector/sse",
]);

// scopes_supported is set to just "email": without it, Claude falls back to
// requesting every scope Supabase's authorization server advertises
// (openid/profile/email/phone — confirmed via its discovery document),
// none of which this server reads besides email (used to identify the
// account via /oauth/userinfo). Confirmed live: the consent screen showed
// "profile" and "phone" as requested access before this was set.
export function protectedResourceMetadata(resource: string) {
  return {
    resource,
    authorization_servers: [SUPABASE_ISSUER],
    scopes_supported: ["email"],
  };
}
