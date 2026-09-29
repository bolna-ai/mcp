import { createBolnaMcpRoute } from "../../../../src/lib/mcp-route";
import { CONNECTOR_INSTRUCTIONS } from "../../../../src/tools/prompts";
import { DIRECTORY_TOOLS, restrictToDirectorySurface } from "../../../../src/tools/directory-surface";

/**
 * The surface listed in Claude's connector directory, at
 * /api/connector/mcp. Ten read and agent-management tools. Kept separate
 * from /api/mcp so the reviewed surface stays small and fixed while the
 * full server keeps growing.
 *
 * resourceMetadataPath is the RFC 9728 path-insertion form for this URL:
 * the document it points at declares `resource` as .../api/connector/mcp,
 * matching what the client connected to. Without it the client is handed
 * /api/mcp's metadata and rejects the mismatch before signing in.
 */
const route = createBolnaMcpRoute({
  basePath: "/api/connector",
  instructions: CONNECTOR_INSTRUCTIONS,
  resourceMetadataPath: "/.well-known/oauth-protected-resource/api/connector/mcp",
  configureServer: (server) => restrictToDirectorySurface(server, DIRECTORY_TOOLS),
});

export const { GET, POST, DELETE } = route;
