import { KNOWN_RESOURCE_PATHS, protectedResourceMetadata } from "../../../../src/lib/oauth-metadata";

/**
 * RFC 9728 §3.1 path insertion: metadata for the resource
 * https://host/api/connector/mcp lives at
 * https://host/.well-known/oauth-protected-resource/api/connector/mcp.
 *
 * Serving this per-path is what lets each surface declare its own
 * `resource`. The path is checked against a known set rather than echoed,
 * so an arbitrary URL on this origin can't be advertised as protected.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ resource: string[] }> }
) {
  const { resource } = await params;
  const path = `/${resource.join("/")}`;
  if (!KNOWN_RESOURCE_PATHS.has(path)) {
    return new Response("Not found", { status: 404 });
  }
  const { origin } = new URL(req.url);
  return Response.json(protectedResourceMetadata(`${origin}${path}`));
}
