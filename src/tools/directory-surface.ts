import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * The tool surface listed in Claude's connector directory.
 *
 * Deliberately a small, fixed subset of what the full server exposes: a
 * directory listing is reviewed as a whole, so every tool on it is surface
 * area to justify. This is the set originally submitted, minus
 * start_outbound_call — the tool the MCP Directory review rejected for
 * being able to dial a third party in one step. Nothing on this list makes
 * a phone ring.
 *
 * Adding a name here means adding it to what Anthropic reviews, so do it
 * deliberately. Users who want the full surface connect to /api/mcp
 * directly, which is unrestricted.
 */
export const DIRECTORY_TOOLS: ReadonlySet<string> = new Set([
  "create_agent",
  "delete_agent",
  "get_agent",
  "get_execution",
  "get_user_info",
  "list_agent_executions",
  "list_agents",
  "list_batches",
  "list_phone_numbers",
  "update_agent",
]);

/**
 * The per-call account override every tool on the full server accepts.
 * Stripped here, so the connector always acts as the OAuth-authenticated
 * user: `getApiKey` then falls through to the connection's own token.
 */
const API_KEY_ARG = "api_key";

/**
 * Drops `api_key` from a tool's declared inputSchema, leaving the rest as-is.
 *
 * For the two tools whose only parameter was `api_key` (get_user_info,
 * list_phone_numbers) this leaves an empty shape, and the SDK renders that
 * as its canonical no-parameter schema `{type: "object", properties: {}}`
 * — without the `additionalProperties: false` the other eight carry. That
 * is the SDK's own representation of "takes no arguments", not a gap:
 * unknown keys are still stripped by Zod before the handler sees them.
 */
function withoutApiKeyParam(config: unknown): unknown {
  const c = config as Record<string, unknown> | undefined;
  const schema = c?.inputSchema as Record<string, unknown> | undefined;
  if (!schema || !(API_KEY_ARG in schema)) return config;
  const { [API_KEY_ARG]: _omitted, ...keptParams } = schema;
  return { ...c, inputSchema: keptParams };
}

/**
 * Belt-and-braces against an `api_key` that arrives anyway. Zod already
 * strips keys the (now shorter) schema doesn't declare, so this is the
 * second of two independent reasons the override can't reach a tool.
 */
function withoutApiKeyArg(cb: unknown): unknown {
  if (typeof cb !== "function") return cb;
  return (args: unknown, extra: unknown) => {
    if (args && typeof args === "object" && API_KEY_ARG in args) {
      const { [API_KEY_ARG]: _omitted, ...keptArgs } = args as Record<string, unknown>;
      return (cb as Function)(keptArgs, extra);
    }
    return (cb as Function)(args, extra);
  };
}

/**
 * Filters registration rather than threading an allowlist through all
 * twenty register* functions: wraps registerTool so anything outside the
 * set is silently skipped, and strips the `api_key` override from whatever
 * survives. Tools not on the list are absent from the client's tool list
 * entirely, not present-and-refusing — they never enter the server's
 * registry, so they can't be called by name either.
 *
 * Prompts are dropped wholesale. The directory listing declares no prompts,
 * and the declaration should stay true without anyone having to remember to
 * update it when a prompt is added.
 *
 * Both edits are confined to this wrapper: the tool implementations are the
 * same ones /api/mcp registers, unmodified, and /api/mcp doesn't apply it.
 */
export function restrictToDirectorySurface(server: McpServer, allowed: ReadonlySet<string>) {
  const register = server.registerTool.bind(server);
  (server as unknown as Record<string, unknown>).registerTool = (
    name: string,
    config: unknown,
    cb: unknown,
    ...rest: unknown[]
  ) =>
    allowed.has(name)
      ? (register as any)(name, withoutApiKeyParam(config), withoutApiKeyArg(cb), ...rest)
      : undefined;
  (server as unknown as Record<string, unknown>).registerPrompt = () => undefined;
}
