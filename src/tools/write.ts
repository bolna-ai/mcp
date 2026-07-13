import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bolnaFetch } from "../lib/bolna-client";
import { toErrorResult } from "../lib/errors";
import { getApiKey } from "../lib/auth";
import { agentIdSchema, e164Phone } from "./schemas";

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
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ agent_config, agent_prompts }, extra) => {
      const apiKey = getApiKey(extra as any);
      try {
        const result = await bolnaFetch("/v2/agent", apiKey, {
          method: "POST",
          body: { agent_config, agent_prompts },
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
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ agent_id, agent_config, agent_prompts }, extra) => {
      const apiKey = getApiKey(extra as any);
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
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ agent_id }, extra) => {
      const apiKey = getApiKey(extra as any);
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
        recipient_phone_number: e164Phone,
        from_phone_number: e164Phone.optional(),
        user_data: z.record(z.any()).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (
      { agent_id, recipient_phone_number, from_phone_number, user_data },
      extra
    ) => {
      const apiKey = getApiKey(extra as any);
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
