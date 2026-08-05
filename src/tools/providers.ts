import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bolnaFetch } from "../lib/bolna-client";
import { toErrorResult } from "../lib/errors";
import { getApiKey } from "../lib/auth";
import { apiKeyOverrideSchema } from "./schemas";

const jsonResult = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

// Adding a provider (POST /providers) takes a third-party secret (e.g. a
// Twilio auth token) as the request body. Deliberately not wrapped as a
// tool: that would mean a real credential gets typed into an LLM chat and
// flows through the conversation/client history, which the Bolna dashboard
// avoids entirely. Only list/remove are exposed here.
//
// GET /providers: the docs describe a bare array response, but the live
// endpoint actually returns `{providers: [...], providers_data: null}` —
// confirmed live 2026-08-05 against a real account. Passed through as-is
// below since no code here assumes a specific shape.
export function registerProvidersTools(server: McpServer) {
  server.registerTool(
    "list_providers",
    {
      title: "List providers",
      description:
        "Lists third-party providers configured on the account (e.g. OPENAI_API_KEY, telephony credentials). Secret values are always masked by the API.",
      inputSchema: { api_key: apiKeyOverrideSchema() },
      annotations: { title: "List providers", readOnlyHint: true, openWorldHint: true },
    },
    async ({ api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch("/providers", apiKey);
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "remove_provider",
    {
      title: "Remove provider",
      description:
        "Removes a configured provider by its name (e.g. OPENAI_API_KEY), as returned by list_providers' provider_name field. Any agent still relying on this provider will break.",
      inputSchema: {
        provider_name: z.string().min(1, "provider_name is required"),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Remove provider", readOnlyHint: false, destructiveHint: true },
    },
    async ({ provider_name, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(
          `/providers/${encodeURIComponent(provider_name)}`,
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
