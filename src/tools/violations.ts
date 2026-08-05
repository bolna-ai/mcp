import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bolnaFetch } from "../lib/bolna-client";
import { toErrorResult } from "../lib/errors";
import { getApiKey } from "../lib/auth";
import { apiKeyOverrideSchema } from "./schemas";

const jsonResult = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

// Submitting a violation (POST /violations/submit) requires an evidence
// file (screenshot/document) in the request — same file-upload tradeoff as
// knowledgebase/create's PDF path and providers/add. Only list is exposed.
export function registerViolationsTools(server: McpServer) {
  server.registerTool(
    "list_violations",
    {
      title: "List violations",
      description:
        "Lists flagged call violations on the account (content policy, regulatory, or fraud flags), optionally filtered by status. Paginated.",
      inputSchema: {
        status: z.enum(["pending", "accepted", "rejected", "submitted"]).optional(),
        page_number: z.number().int().min(1).optional().default(1),
        page_size: z.number().int().min(1).optional().default(20),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "List violations", readOnlyHint: true, openWorldHint: true },
    },
    async ({ status, page_number, page_size, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch("/violations/list", apiKey, {
          query: { status, page_number, page_size },
        });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
