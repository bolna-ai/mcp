import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bolnaFetch } from "../lib/bolna-client";
import { toErrorResult } from "../lib/errors";
import { getApiKey } from "../lib/auth";
import { agentIdSchema, apiKeyOverrideSchema, e164Phone } from "./schemas";

const jsonResult = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

// Faithful to POST /v2/agent's request body (see tools/index.ts comment
// block). Provider-shaped sub-objects (llm_agent/synthesizer/transcriber/
// input/output/task_config) vary by provider, so they're passed through as
// records rather than re-modeled field-by-field.
const taskSchema = z
  .object({
    task_type: z.enum(["conversation", "extraction", "summarization"]),
    toolchain: z
      .object({
        execution: z.enum(["parallel", "sequential"]),
        pipelines: z.array(z.array(z.string())),
      })
      .passthrough(),
    tools_config: z
      .object({
        llm_agent: z.record(z.any()),
        synthesizer: z.record(z.any()),
        transcriber: z.record(z.any()),
        input: z.record(z.any()),
        output: z.record(z.any()),
      })
      .passthrough(),
    task_config: z.record(z.any()).optional(),
  })
  .passthrough();

const agentConfigSchema = z
  .object({
    agent_name: z.string().min(1, "agent_name must not be empty"),
    tasks: z.array(taskSchema).min(1, "at least one task is required"),
    agent_welcome_message: z.string().optional(),
    webhook_url: z.string().url().optional(),
    agent_type: z.string().optional(),
    calling_guardrails: z.record(z.any()).optional(),
    ingest_source_config: z.record(z.any()).optional(),
    call_summary_enabled: z
      .boolean()
      .optional()
      .describe(
        "When true, runs one platform summary pass per call, writing the summary to the execution's summary field and a subjective-only \"Call Summary\" entry under extracted_data General. When false (default), no summary is generated."
      ),
  })
  .passthrough();

const taskPromptSchema = z.object({ system_prompt: z.string().min(1) }).passthrough();

const agentPromptsSchema = z
  .record(taskPromptSchema)
  .refine((p) => Object.keys(p).length > 0, {
    message: "agent_prompts must include at least one task prompt (e.g. task_1)",
  });

const patchAgentConfigSchema = z
  .object({
    agent_name: z.string().min(1, "agent_name must not be empty").optional(),
    agent_welcome_message: z.string().optional(),
    webhook_url: z.string().url().optional(),
    synthesizer: z
      .object({ provider: z.string(), provider_config: z.record(z.any()) })
      .passthrough()
      .optional(),
    ingest_source_config: z.record(z.any()).optional(),
    telephony_provider: z
      .enum(["twilio", "plivo", "exotel", "vobiz", "sip-trunk", "default"])
      .optional(),
    call_summary_enabled: z
      .boolean()
      .optional()
      .describe(
        "When true, runs one platform summary pass per call, writing the summary to the execution's summary field and a subjective-only \"Call Summary\" entry under extracted_data General. When false (default), no summary is generated."
      ),
  })
  .passthrough();

const patchAgentPromptsSchema = z.record(
  z.object({ system_prompt: z.string().min(1).optional() }).passthrough()
);

export function registerWriteTools(server: McpServer) {
  server.registerTool(
    "create_agent",
    {
      title: "Create agent",
      description:
        "Creates a new voice AI agent in the connected Bolna account with the given name, prompts, and model configuration. Returns the new agent's ID. See the Bolna Agent API (https://docs.bolna.ai/api-reference/agent/v2/create) for the full configuration schema.",
      inputSchema: {
        agent_config: agentConfigSchema,
        agent_prompts: agentPromptsSchema,
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Create agent", readOnlyHint: false, destructiveHint: false },
    },
    async ({ agent_config, agent_prompts, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        // Stamped "mcp" (not caller-configurable) so Bolna can attribute
        // agents created through this MCP server, distinct from
        // dashboard/API/agent-builder creations. Top-level key, per API contract
        // — NOT nested inside agent_config.
        const result = await bolnaFetch("/v2/agent", apiKey, {
          method: "POST",
          body: { agent_config, agent_prompts, creation_source: "mcp" },
        });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "update_agent",
    {
      title: "Update agent",
      description:
        "Partially updates an existing Bolna agent's properties such as name, welcome message, prompts, webhook URL, or voice settings. Only the provided fields are changed. This modifies the live agent configuration.",
      inputSchema: {
        agent_id: agentIdSchema,
        agent_config: patchAgentConfigSchema.optional(),
        agent_prompts: patchAgentPromptsSchema.optional(),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Update agent", readOnlyHint: false, destructiveHint: true },
    },
    async ({ agent_id, agent_config, agent_prompts, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      if (!agent_config && !agent_prompts) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Provide at least one of agent_config or agent_prompts to update.",
            },
          ],
          isError: true as const,
        };
      }
      try {
        const result = await bolnaFetch(
          `/v2/agent/${encodeURIComponent(agent_id)}`,
          apiKey,
          {
            method: "PATCH",
            body: { agent_config, agent_prompts },
          }
        );
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err, { agentId: agent_id });
      }
    }
  );

  server.registerTool(
    "delete_agent",
    {
      title: "Delete agent",
      description:
        "Permanently deletes a Bolna agent and its related data, including batches and execution history. This cannot be undone.",
      inputSchema: {
        agent_id: agentIdSchema,
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Delete agent", readOnlyHint: false, destructiveHint: true },
    },
    async ({ agent_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(
          `/v2/agent/${encodeURIComponent(agent_id)}`,
          apiKey,
          { method: "DELETE" }
        );
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err, { agentId: agent_id });
      }
    }
  );

  server.registerTool(
    "start_outbound_call",
    {
      title: "Start outbound call",
      description:
        "Initiates a real outbound phone call from a Bolna voice AI agent to the given recipient number. Optionally pass a from-number and dynamic variables for prompt personalization. This places a live call and consumes account balance. Returns the execution ID for tracking via get_execution.",
      inputSchema: {
        agent_id: agentIdSchema,
        recipient_phone_number: e164Phone(),
        from_phone_number: e164Phone().optional(),
        user_data: z.record(z.any()).optional(),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Start outbound call", readOnlyHint: false, destructiveHint: true },
    },
    async (
      { agent_id, recipient_phone_number, from_phone_number, user_data, api_key },
      extra
    ) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch("/call", apiKey, {
          method: "POST",
          body: {
            agent_id,
            recipient_phone_number,
            from_phone_number,
            user_data,
          },
        });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err, { agentId: agent_id });
      }
    }
  );
}
