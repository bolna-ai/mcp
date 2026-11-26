/**
 * Domain-verification challenge for OpenAI's plugin directory.
 *
 * The plugin portal gives a challenge token and checks that this exact token
 * is served as plain text at https://<host>/.well-known/openai-apps-challenge
 * (token only, no JSON). The token is served publicly by design, so it is not
 * a secret and is safe to keep in code.
 *
 * OPENAI_APPS_CHALLENGE, when set, overrides the built-in token. Keep the
 * token in place after verification: OpenAI re-checks it on rescans.
 */
export const dynamic = "force-dynamic";

const DEFAULT_CHALLENGE = "JtsHATcQLG849D9TtWNleqZhnk-v8dvT6Jri6JKiAlo";

export async function GET() {
  const token = process.env.OPENAI_APPS_CHALLENGE?.trim() || DEFAULT_CHALLENGE;
  return new Response(token, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
