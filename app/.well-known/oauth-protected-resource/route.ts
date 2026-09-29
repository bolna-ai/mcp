import { protectedResourceMetadata } from "../../../src/lib/oauth-metadata";

/**
 * The bare metadata path, kept pointing at /api/mcp.
 *
 * This is the URL every already-connected /api/mcp client was handed in a
 * WWW-Authenticate header, so it keeps answering for that surface
 * unchanged. New surfaces use the RFC 9728 path-insertion form served by
 * the [...resource] route next to this one.
 */
export async function GET(req: Request) {
  const { origin } = new URL(req.url);
  return Response.json(protectedResourceMetadata(`${origin}/api/mcp`));
}
