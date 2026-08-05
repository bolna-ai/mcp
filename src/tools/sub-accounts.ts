import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bolnaFetch } from "../lib/bolna-client";
import { toErrorResult } from "../lib/errors";
import { getApiKey } from "../lib/auth";
import { apiKeyOverrideSchema, subAccountIdSchema } from "./schemas";

const jsonResult = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

// A factory, not a shared instance: from/to on the same tool both use this,
// and a reused Zod object reference gets collapsed into a $ref instead of
// an inline type — see the identical e164Phone fix in schemas.ts.
function dateTimeSchema() {
  return z.string().datetime({ message: "must be an ISO 8601 UTC timestamp" }).optional();
}

// Sub-accounts are an enterprise feature: creating/updating one requires
// organization admin access (Bolna returns 403 otherwise).
export function registerSubAccountsTools(server: McpServer) {
  server.registerTool(
    "create_sub_account",
    {
      title: "Create sub-account",
      description:
        "Creates an isolated sub-account workspace with its own concurrency limits and auto-provisioned API key. Enterprise feature — requires organization admin access.",
      inputSchema: {
        name: z.string().min(1, "name is required"),
        min_concurrency: z.number().int().min(0),
        max_concurrency: z.number().int().min(0).optional(),
        multi_tenant: z.boolean().optional().default(false),
        db_host: z.string().optional(),
        db_name: z.string().optional(),
        db_port: z.string().optional(),
        db_user: z.string().optional(),
        db_password: z.string().optional(),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Create sub-account", readOnlyHint: false, destructiveHint: false },
    },
    async (args, extra) => {
      const { api_key, ...body } = args;
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch("/sub-accounts/create", apiKey, {
          method: "POST",
          body,
        });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "list_sub_accounts",
    {
      title: "List sub-accounts",
      description: "Lists all sub-accounts linked to the organization.",
      inputSchema: { api_key: apiKeyOverrideSchema() },
      annotations: { title: "List sub-accounts", readOnlyHint: true, openWorldHint: true },
    },
    async ({ api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch("/sub-accounts/all", apiKey);
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "update_sub_account",
    {
      title: "Update sub-account",
      description:
        "Partially updates a sub-account's name or concurrency limits. Enterprise feature — requires organization admin access.",
      inputSchema: {
        sub_account_id: subAccountIdSchema,
        name: z.string().optional(),
        min_concurrency: z.number().int().min(0).optional(),
        max_concurrency: z.number().int().min(0).optional(),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Update sub-account", readOnlyHint: false, destructiveHint: true },
    },
    async ({ sub_account_id, api_key, ...fields }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(
          `/sub-accounts/${encodeURIComponent(sub_account_id)}`,
          apiKey,
          { method: "PATCH", body: fields }
        );
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "delete_sub_account",
    {
      title: "Delete sub-account",
      description:
        "Permanently deletes a sub-account and ALL of its data: agents, batches, and executions. Cannot be undone.",
      inputSchema: { sub_account_id: subAccountIdSchema, api_key: apiKeyOverrideSchema() },
      annotations: { title: "Delete sub-account", readOnlyHint: false, destructiveHint: true },
    },
    async ({ sub_account_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(
          `/sub-accounts/${encodeURIComponent(sub_account_id)}`,
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
    "get_sub_account_usage",
    {
      title: "Get sub-account usage",
      description:
        "Retrieves usage and cost breakdown for one sub-account over a date range (defaults to the current month to date). Costs are returned in cents.",
      inputSchema: {
        sub_account_id: subAccountIdSchema,
        from: dateTimeSchema(),
        to: dateTimeSchema(),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Get sub-account usage", readOnlyHint: true, openWorldHint: true },
    },
    async ({ sub_account_id, from, to, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(
          `/sub-accounts/${encodeURIComponent(sub_account_id)}/usage`,
          apiKey,
          { query: { from, to } }
        );
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "get_all_sub_accounts_usage",
    {
      title: "Get all sub-accounts usage",
      description:
        "Retrieves usage and cost breakdown for every sub-account in the organization over a date range (defaults to the current month to date). Costs are returned in cents.",
      inputSchema: {
        from: dateTimeSchema(),
        to: dateTimeSchema(),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Get all sub-accounts usage", readOnlyHint: true, openWorldHint: true },
    },
    async ({ from, to, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch("/sub-accounts/all/usage", apiKey, { query: { from, to } });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
