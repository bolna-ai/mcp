import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bolnaFetch } from "../lib/bolna-client";
import { toErrorResult } from "../lib/errors";
import { getApiKey } from "../lib/auth";
import { agentIdSchema, apiKeyOverrideSchema } from "./schemas";

const jsonResult = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

const ivrStepSchema = z.record(z.any());

const ivrConfigSchema = z.object({
  enabled: z.boolean(),
  voice: z.string().optional(),
  welcome_message: z.string().optional(),
  timeout: z.number().int().optional(),
  max_retries: z.number().int().optional(),
  steps: z.array(ivrStepSchema).optional(),
  default_agent_id: z.string().optional(),
});

export function registerInboundTools(server: McpServer) {
  server.registerTool(
    "setup_inbound_agent",
    {
      title: "Set up inbound agent",
      description:
        "Configures a Bolna agent to automatically answer inbound calls on a specific phone number, optionally with an IVR menu. Use list_phone_numbers first to find the phone_number_id.",
      inputSchema: {
        agent_id: agentIdSchema,
        phone_number_id: z.string().min(1, "phone_number_id is required"),
        allow_multiple: z.boolean().optional().default(false),
        ivr_config: ivrConfigSchema.optional(),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Set up inbound agent", readOnlyHint: false, destructiveHint: false },
    },
    async ({ agent_id, phone_number_id, allow_multiple, ivr_config, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch("/inbound/setup", apiKey, {
          method: "POST",
          body: { agent_id, phone_number_id, allow_multiple, ivr_config },
        });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err, { agentId: agent_id });
      }
    }
  );

  server.registerTool(
    "unlink_inbound_agent",
    {
      title: "Unlink inbound agent",
      description:
        "Removes inbound call routing from a phone number, so it no longer auto-answers with an agent.",
      inputSchema: {
        phone_number_id: z.string().min(1, "phone_number_id is required"),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Unlink inbound agent", readOnlyHint: false, destructiveHint: true },
    },
    async ({ phone_number_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch("/inbound/unlink", apiKey, {
          method: "POST",
          body: { phone_number_id },
        });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
