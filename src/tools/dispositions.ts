import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bolnaFetch } from "../lib/bolna-client";
import { toErrorResult } from "../lib/errors";
import { getApiKey } from "../lib/auth";
import { agentIdSchema, apiKeyOverrideSchema, dispositionIdSchema } from "./schemas";

const jsonResult = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

// Confirmed live 2026-08-05: a just-created disposition can 404 on an
// immediate update_disposition/get_disposition call; retrying a few seconds
// later succeeds. Same brief propagation delay pattern seen on newly added
// SIP trunk numbers (see sip-trunks.ts) — not a bug in this tool.

const errorResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  isError: true as const,
});

// Recursive: an objective option can nest sub_options for hierarchical
// classification (e.g. "interested" -> "budget confirmed" / "needs approval").
type ObjectiveOption = {
  value: string;
  condition: string;
  sub_options?: ObjectiveOption[];
};
const objectiveOptionSchema: z.ZodType<ObjectiveOption> = z.lazy(() =>
  z.object({
    value: z.string().min(1),
    condition: z.string().min(1),
    sub_options: z.array(objectiveOptionSchema).optional(),
  })
);

const subjectiveTypeSchema = z.enum(["text", "timestamp", "numeric", "boolean", "email", "regex"]);

const subjectiveTypeConfigSchema = z.object({
  pattern: z.string().min(1, "pattern is required in subjective_type_config"),
  description: z.string().optional(),
});

const dispositionFieldsSchema = {
  name: z.string().min(1, "name is required"),
  question: z.string().min(1, "question is required"),
  category: z.string().optional().default("General"),
  system_prompt: z.string().optional(),
  model: z.string().optional().default("gpt-4.1-mini"),
  is_subjective: z.boolean().optional().default(false),
  is_objective: z.boolean().optional().default(false),
  subjective_type: subjectiveTypeSchema.optional().default("text"),
  subjective_type_config: subjectiveTypeConfigSchema.optional(),
  objective_options: z.array(objectiveOptionSchema).optional(),
};

/**
 * Bolna requires at least one of is_subjective/is_objective, non-empty
 * objective_options when is_objective is true, and a pattern when
 * subjective_type is "regex". These are cross-field rules the API enforces
 * with 422s; checked here up front for a clearer error, following the same
 * pattern as update_agent's manual "at least one field" check in write.ts
 * (registerTool's inputSchema is a flat shape, not a refinable ZodObject).
 */
function validateDispositionFields(d: {
  is_subjective: boolean;
  is_objective: boolean;
  subjective_type: string;
  objective_options?: unknown[];
}): string | null {
  if (!d.is_subjective && !d.is_objective) {
    return "At least one of is_subjective or is_objective must be true.";
  }
  if (d.is_objective && (!d.objective_options || d.objective_options.length === 0)) {
    return "objective_options must be provided and non-empty when is_objective is true.";
  }
  if (d.subjective_type === "regex" && !("subjective_type_config" in d)) {
    return "subjective_type_config.pattern is required when subjective_type is 'regex'.";
  }
  return null;
}

// GET /dispositions/: the docs describe a bare array response, but the live
// endpoint's actual shape depends on whether agent_id is passed — confirmed
// live 2026-08-05 against a real account. Without agent_id it returns
// `{user_owned: [...]}`; with agent_id it returns `{agent_dispositions:
// [...], global_dispositions: [...]}`. Passed through as-is below since no
// code here assumes a specific shape.
export function registerDispositionsTools(server: McpServer) {
  server.registerTool(
    "list_dispositions",
    {
      title: "List dispositions",
      description:
        "Lists dispositions (structured extraction questions run against call transcripts). Pass agent_id to scope to one agent's linked dispositions, or omit to see every disposition on the account. The response shape differs depending on whether agent_id is passed.",
      inputSchema: {
        agent_id: agentIdSchema.optional(),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "List dispositions", readOnlyHint: true, openWorldHint: true },
    },
    async ({ agent_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch("/dispositions/", apiKey, { query: { agent_id } });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "get_disposition",
    {
      title: "Get disposition",
      description:
        "Retrieves a single disposition by ID. Pass agent_id to require it be linked to that agent.",
      inputSchema: {
        disposition_id: dispositionIdSchema,
        agent_id: agentIdSchema.optional(),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Get disposition", readOnlyHint: true, openWorldHint: true },
    },
    async ({ disposition_id, agent_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(
          `/dispositions/${encodeURIComponent(disposition_id)}`,
          apiKey,
          { query: { agent_id } }
        );
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "create_disposition",
    {
      title: "Create disposition",
      description:
        "Creates a new disposition (a structured extraction question evaluated against every call transcript) linked to an agent. Requires is_subjective and/or is_objective; objective_options is required when is_objective is true.",
      inputSchema: {
        agent_id: agentIdSchema,
        ...dispositionFieldsSchema,
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Create disposition", readOnlyHint: false, destructiveHint: false },
    },
    async (args, extra) => {
      const validationError = validateDispositionFields(args);
      if (validationError) return errorResult(validationError);

      const { agent_id, api_key, ...fields } = args;
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch("/dispositions/", apiKey, {
          method: "POST",
          body: { agent_id, ...fields },
        });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err, { agentId: agent_id });
      }
    }
  );

  server.registerTool(
    "bulk_create_dispositions",
    {
      title: "Bulk create dispositions",
      description:
        "Atomically creates multiple dispositions linked to one agent in a single request. If any disposition is invalid, none are created.",
      inputSchema: {
        agent_id: agentIdSchema,
        dispositions: z
          .array(z.object(dispositionFieldsSchema))
          .min(1, "at least one disposition is required"),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Bulk create dispositions", readOnlyHint: false, destructiveHint: false },
    },
    async ({ agent_id, dispositions, api_key }, extra) => {
      for (const [i, d] of dispositions.entries()) {
        const validationError = validateDispositionFields(d);
        if (validationError) return errorResult(`dispositions[${i}]: ${validationError}`);
      }

      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch("/dispositions/bulk", apiKey, {
          method: "POST",
          body: { agent_id, dispositions },
        });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err, { agentId: agent_id });
      }
    }
  );

  server.registerTool(
    "update_disposition",
    {
      title: "Update disposition",
      description:
        "Partially updates a disposition. If agent_id is provided and the disposition is shared across agents, this forks a private copy scoped to that agent instead of editing the shared original (Bolna's copy-on-write behavior) — the response indicates whether it updated in place or created a copy.",
      inputSchema: {
        disposition_id: dispositionIdSchema,
        agent_id: agentIdSchema.optional(),
        name: z.string().optional(),
        question: z.string().optional(),
        category: z.string().optional(),
        system_prompt: z.string().optional(),
        model: z.string().optional(),
        is_subjective: z.boolean().optional(),
        is_objective: z.boolean().optional(),
        subjective_type: subjectiveTypeSchema.optional(),
        subjective_type_config: subjectiveTypeConfigSchema.optional(),
        objective_options: z.array(objectiveOptionSchema).optional(),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Update disposition", readOnlyHint: false, destructiveHint: true },
    },
    async ({ disposition_id, api_key, ...fields }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(
          `/dispositions/${encodeURIComponent(disposition_id)}`,
          apiKey,
          { method: "PUT", body: fields }
        );
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "delete_disposition",
    {
      title: "Delete disposition",
      description:
        "Permanently deletes a disposition. Only the disposition's owner (or an account admin) can delete it. Past call results that already used it are unaffected; only future calls stop evaluating it.",
      inputSchema: {
        disposition_id: dispositionIdSchema,
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Delete disposition", readOnlyHint: false, destructiveHint: true },
    },
    async ({ disposition_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(
          `/dispositions/${encodeURIComponent(disposition_id)}`,
          apiKey,
          { method: "DELETE" }
        );
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "test_dispositions",
    {
      title: "Test dispositions against a transcript",
      description:
        "Runs every disposition linked to an agent against a supplied transcript, without a real call. Use this to preview extraction results before deploying disposition changes.",
      inputSchema: {
        agent_id: agentIdSchema,
        transcript: z.string().min(1).max(50000, "transcript must be 50000 characters or fewer"),
        call_date: z.string().datetime({ message: "call_date must be an ISO 8601 timestamp" }).optional(),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Test dispositions against a transcript", readOnlyHint: true, openWorldHint: true },
    },
    async ({ agent_id, transcript, call_date, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(
          `/v2/agent/${encodeURIComponent(agent_id)}/dispositions/test`,
          apiKey,
          { method: "POST", body: { transcript, call_date } }
        );
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err, { agentId: agent_id });
      }
    }
  );
}
