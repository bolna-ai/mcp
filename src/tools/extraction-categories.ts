import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bolnaFetch } from "../lib/bolna-client";
import { toErrorResult } from "../lib/errors";
import { getApiKey } from "../lib/auth";
import { agentIdSchema, apiKeyOverrideSchema, categoryIdSchema } from "./schemas";

const jsonResult = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data) }],
});

const errorResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  isError: true as const,
});

// When a category runs. A factory for the same $ref-collapsing reason as e164Phone.
function ruleFieldsSchema() {
  return {
    min_duration_s: z
      .number()
      .int()
      .min(1)
      .nullable()
      .optional()
      .describe("Start rule: run only on calls at least this many seconds long. Starting categories only."),
    skip_voicemail: z
      .boolean()
      .nullable()
      .optional()
      .describe("Start rule: true skips calls that the agent's voicemail detection ended (a carrier's answering-machine detection doesn't count). Starting categories only."),
    parent_disposition_id: z
      .string()
      .uuid()
      .nullable()
      .optional()
      .describe(
        "Follow-up: id of a Pre-defined (is_objective) disposition in another category of this agent (see list_extraction_categories). This category then runs only after that question is answered, filtered by match_mode and match_values; all three go together."
      ),
    match_mode: z
      .enum(["in", "not_in"])
      .nullable()
      .optional()
      .describe(
        'Follow-up: "in" runs this category only when the parent\'s answer is one of match_values; "not_in" skips it when it is.'
      ),
    match_values: z
      .array(z.string().min(1))
      .min(1)
      .nullable()
      .optional()
      .describe(
        "Follow-up: exact answer values from the parent disposition's objective_options, sub_options values included."
      ),
  };
}

// A category is the set of dispositions evaluated together in one extraction
// LLM pass (one category = one LLM call, run on the category's model).
export function registerExtractionCategoriesTools(server: McpServer) {
  server.registerTool(
    "list_extraction_categories",
    {
      title: "List extraction categories",
      description:
        "Lists an agent's extraction categories with the dispositions inside each. A category is the set of dispositions evaluated together in one LLM pass per call, run on the category's model; a disposition is a single extraction question inside a category. Returns {categories: [{id, name, model, managed_by, dispositions: [...], min_duration_s, skip_voicemail, parent_disposition_id, match_mode, match_values}]}; the last five say when the category runs (null, and skip_voicemail false, when unset; a parent_disposition_id makes it a follow-up).",
      inputSchema: {
        agent_id: agentIdSchema,
        api_key: apiKeyOverrideSchema(),
      },
      annotations: {
        title: "List extraction categories",
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async ({ agent_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(
          `/agent/${encodeURIComponent(agent_id)}/extraction-categories`,
          apiKey
        );
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err, { agentId: agent_id });
      }
    }
  );

  server.registerTool(
    "create_extraction_category",
    {
      title: "Create extraction category",
      description:
        "Creates an extraction category on an agent. A category is the set of dispositions evaluated together in one LLM pass per call; model (e.g. gpt-4.1-mini) runs that pass and is validated server-side against the allowed extraction models. name must be unique among the agent's categories. Put dispositions in it by passing its id as category_id to create_disposition / update_disposition. A category is either a starting category, optionally with a start rule (min_duration_s, skip_voicemail; every condition set must pass, none set runs it on every call), or a follow-up that runs only after a Pre-defined question in another category (parent_disposition_id + match_mode + match_values together), never both. A follow-up never runs if its parent's category was skipped or failed. A rule that would break the agent's chain (answer values the parent doesn't offer, a loop, start conditions on a follow-up) is refused with HTTP 400 and a message saying why.",
      inputSchema: {
        agent_id: agentIdSchema,
        name: z.string().min(1, "name is required"),
        model: z.string().min(1, "model is required"),
        ...ruleFieldsSchema(),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: {
        title: "Create extraction category",
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async ({ agent_id, api_key, ...body }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(
          `/agent/${encodeURIComponent(agent_id)}/extraction-categories`,
          apiKey,
          { method: "POST", body }
        );
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err, { agentId: agent_id });
      }
    }
  );

  server.registerTool(
    "update_extraction_category",
    {
      title: "Update extraction category",
      description:
        "Partially updates an extraction category: rename it, change the model that runs its LLM pass, and/or change when it runs. Only the fields you pass change, and an explicit null clears a rule field. Renaming also rewrites the legacy category text on every disposition inside it. A category is either a starting category (start rule: min_duration_s, skip_voicemail) or a follow-up (parent_disposition_id + match_mode + match_values together), never both, so a switch must clear the other side in the same call: to make it a follow-up pass min_duration_s: null and skip_voicemail: false with the three follow-up fields; to make it a starting category pass parent_disposition_id, match_mode and match_values as null. A change that would break a chain (answer values the parent no longer offers, a loop, start conditions on a follow-up) is refused with HTTP 400 and a message saying why. At least one field is required.",
      inputSchema: {
        category_id: categoryIdSchema,
        name: z.string().min(1).optional(),
        model: z.string().min(1).optional(),
        ...ruleFieldsSchema(),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: {
        title: "Update extraction category",
        readOnlyHint: false,
        destructiveHint: true,
      },
    },
    async ({ category_id, api_key, ...body }, extra) => {
      // JSON.stringify drops the undefined (omitted) fields and keeps an explicit null, which clears.
      if (Object.values(body).every((value) => value === undefined)) {
        return errorResult("At least one of name, model or a rule field must be provided.");
      }
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(
          `/extraction-categories/${encodeURIComponent(category_id)}`,
          apiKey,
          { method: "PATCH", body }
        );
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "delete_extraction_category",
    {
      title: "Delete extraction category",
      description:
        "Permanently deletes an extraction category AND every disposition inside it (the category owns its dispositions), detaching it from the agent. Past call results are unaffected; future calls stop evaluating those dispositions. To keep a disposition, first move it to another category via update_disposition with a new category_id.",
      inputSchema: {
        category_id: categoryIdSchema,
        api_key: apiKeyOverrideSchema(),
      },
      annotations: {
        title: "Delete extraction category",
        readOnlyHint: false,
        destructiveHint: true,
      },
    },
    async ({ category_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(
          `/extraction-categories/${encodeURIComponent(category_id)}`,
          apiKey,
          { method: "DELETE" }
        );
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
