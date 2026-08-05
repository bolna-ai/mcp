import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bolnaFetch } from "../lib/bolna-client";
import { toErrorResult } from "../lib/errors";
import { getApiKey } from "../lib/auth";
import { apiKeyOverrideSchema, executionIdSchema } from "./schemas";

const jsonResult = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

export function registerCallsTools(server: McpServer) {
  server.registerTool(
    "stop_call",
    {
      title: "Stop a queued or scheduled call",
      description:
        "Cancels a single call that hasn't started yet (status queued or scheduled). Has no effect on a call that's already ringing or in progress.",
      inputSchema: {
        execution_id: executionIdSchema,
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Stop a queued or scheduled call", readOnlyHint: false, destructiveHint: true },
    },
    async ({ execution_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(
          `/call/${encodeURIComponent(execution_id)}/stop`,
          apiKey,
          { method: "POST" }
        );
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err, { executionId: execution_id });
      }
    }
  );
}
