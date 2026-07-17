// RFC 9728 protected resource metadata. Points Claude (or any MCP client)
// at Bolna's Supabase project as the OAuth 2.1 authorization server for
// this MCP server.
//
// The `resource` field must exactly match the URL the client actually
// connects to (Claude enforces this). It's derived from the incoming
// request's own origin rather than hardcoded, so this works correctly
// both in local dev (http://localhost:3000/api/mcp) and in production
// (https://mcp.bolna.ai/api/mcp) without needing separate config.
export async function GET(req: Request) {
  const { origin } = new URL(req.url);
  return Response.json({
    resource: `${origin}/api/mcp`,
    authorization_servers: ["https://hbcyinehbjcanmnqywtg.supabase.co/auth/v1"],
  });
}
