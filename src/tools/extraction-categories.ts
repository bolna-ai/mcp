import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bolnaFetch } from "../lib/bolna-client";
import { toErrorResult } from "../lib/errors";
import { getApiKey } from "../lib/auth";
import { agentIdSchema, apiKeyOverrideSchema, categoryIdSchema } from "./schemas";

const jsonResult = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

const errorResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  isError: true as const,
});

// Extraction categories group an agent's dispositions: extraction is the
// post-call feature, a category is the set of dispositions evaluated
// together in one LLM pass (one category = one LLM call, run on the
// category's model), and a disposition is a single question inside it.
export function registerExtractionCategoriesTools(server: McpServer) {
  server.registerTool(
    "list_extraction_categories",
    {
      title: "List extraction categories",
      description:
        "Lists an agent's extraction categories with the dispositions inside each. A category is the set of dispositions evaluated together in one LLM pass per call, run on the category's model; a disposition is a single extraction question inside a category. Returns {categories: [{id, name, model, dispositions: [...]}]}.",
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
        "Creates an extraction category on an agent. A category is the set of dispositions evaluated together in one LLM pass per call; model (e.g. gpt-4.1-mini) runs that pass and is validated server-side against the allowed extraction models. name must be unique among the agent's categories. Put dispositions in it by passing its id as category_id to create_disposition / update_disposition.",
      inputSchema: {
        agent_id: agentIdSchema,
        name: z.string().min(1, "name is required"),
        model: z.string().min(1, "model is required"),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: {
        title: "Create extraction category",
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async ({ agent_id, name, model, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(
          `/agent/${encodeURIComponent(agent_id)}/extraction-categories`,
          apiKey,
          { method: "POST", body: { name, model } }
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
        "Partially updates an extraction category: rename it and/or change the model that runs its LLM pass. Renaming also rewrites the legacy category text on every disposition inside it. At least one of name or model is required.",
      inputSchema: {
        category_id: categoryIdSchema,
        name: z.string().min(1).optional(),
        model: z.string().min(1).optional(),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: {
        title: "Update extraction category",
        readOnlyHint: false,
        destructiveHint: true,
      },
    },
    async ({ category_id, name, model, api_key }, extra) => {
      if (name === undefined && model === undefined) {
        return errorResult("At least one of name or model must be provided.");
      }
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(
          `/extraction-categories/${encodeURIComponent(category_id)}`,
          apiKey,
          {
            method: "PATCH",
            body: {
              ...(name !== undefined && { name }),
              ...(model !== undefined && { model }),
            },
          }
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
