/**
 * Domain-verification challenge for OpenAI's plugin directory.
 *
 * When connecting the MCP server in the OpenAI plugin portal, it shows a
 * challenge token and checks that this exact token is served as plain text at
 * https://<host>/.well-known/openai-apps-challenge (token only, no JSON).
 *
 * The token comes from the portal, so it lives in an env var rather than in
 * code: set OPENAI_APPS_CHALLENGE in Vercel, redeploy, then click Connect.
 * Until it is set this answers 404, so nothing is advertised by accident.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const token = process.env.OPENAI_APPS_CHALLENGE?.trim();
  if (!token) return new Response("Not found", { status: 404 });
  return new Response(token, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
