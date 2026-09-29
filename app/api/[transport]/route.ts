import { createBolnaMcpRoute } from "../../../src/lib/mcp-route";

/**
 * The full server at /api/mcp: every tool, for users who connect this URL
 * themselves from Claude Code, Cursor, Windsurf and the rest.
 *
 * The smaller surface listed in Claude's connector directory is a separate
 * route, /api/connector/mcp.
 */
const route = createBolnaMcpRoute({ basePath: "/api" });

export const { GET, POST, DELETE } = route;
