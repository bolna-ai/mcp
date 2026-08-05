import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bolnaFetch } from "../lib/bolna-client";
import { toErrorResult } from "../lib/errors";
import { getApiKey } from "../lib/auth";
import { agentIdSchema, apiKeyOverrideSchema } from "./schemas";

const jsonResult = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

export function registerAgentExtraTools(server: McpServer) {
  server.registerTool(
    "stop_agent_queued_calls",
    {
      title: "Stop agent queued calls",
      description:
        "Stops ALL queued calls for a Bolna agent, cancelling every call that hasn't started ringing yet. Does not affect calls already in progress. Returns the list of cancelled execution IDs.",
      inputSchema: {
        agent_id: agentIdSchema,
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Stop agent queued calls", readOnlyHint: false, destructiveHint: true },
    },
    async ({ agent_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(
          `/v2/agent/${encodeURIComponent(agent_id)}/stop`,
          apiKey,
          { method: "POST" }
        );
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err, { agentId: agent_id });
      }
    }
  );
}
