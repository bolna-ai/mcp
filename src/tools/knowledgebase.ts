import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bolnaFetch } from "../lib/bolna-client";
import { toErrorResult } from "../lib/errors";
import { getApiKey } from "../lib/auth";
import { apiKeyOverrideSchema } from "./schemas";

const jsonResult = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

const ragIdSchema = z.string().min(1, "rag_id is required");

// POST /knowledgebase takes multipart/form-data and accepts EITHER a PDF
// file or a URL to scrape, not both (confirmed live 2026-08-05). Only the
// URL path is exposed here — a raw PDF upload doesn't map cleanly to a tool
// argument, same tradeoff as providers/add and violations/submit.
export function registerKnowledgebaseTools(server: McpServer) {
  server.registerTool(
    "create_knowledgebase",
    {
      title: "Create knowledgebase from URL",
      description:
        "Creates a knowledgebase by scraping and ingesting a URL, for use as RAG context in a voice agent. PDF upload isn't supported here — only the URL path. Processing is async; check status via get_knowledgebase.",
      inputSchema: {
        url: z.string().url("url must be a valid URL"),
        chunk_size: z.number().int().optional().default(512),
        similarity_top_k: z.number().int().optional().default(15),
        overlapping: z.number().int().optional().default(128),
        language_support: z.enum(["multilingual"]).optional(),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Create knowledgebase from URL", readOnlyHint: false, destructiveHint: false },
    },
    async ({ url, chunk_size, similarity_top_k, overlapping, language_support, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const form = new FormData();
        form.append("url", url);
        form.append("chunk_size", String(chunk_size));
        form.append("similarity_top_k", String(similarity_top_k));
        form.append("overlapping", String(overlapping));
        if (language_support) form.append("language_support", language_support);

        const result = await bolnaFetch("/knowledgebase", apiKey, { method: "POST", form });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "get_knowledgebase",
    {
      title: "Get knowledgebase",
      description: "Retrieves a knowledgebase's file name, status, and settings by ID.",
      inputSchema: { rag_id: ragIdSchema, api_key: apiKeyOverrideSchema() },
      annotations: { title: "Get knowledgebase", readOnlyHint: true, openWorldHint: true },
    },
    async ({ rag_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(`/knowledgebase/${encodeURIComponent(rag_id)}`, apiKey);
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "list_knowledgebases",
    {
      title: "List knowledgebases",
      description: "Lists every knowledgebase on the account, including status and creation dates.",
      inputSchema: { api_key: apiKeyOverrideSchema() },
      annotations: { title: "List knowledgebases", readOnlyHint: true, openWorldHint: true },
    },
    async ({ api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch("/knowledgebase/all", apiKey);
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "delete_knowledgebase",
    {
      title: "Delete knowledgebase",
      description: "Permanently deletes a knowledgebase. Agents referencing it will lose that RAG context.",
      inputSchema: { rag_id: ragIdSchema, api_key: apiKeyOverrideSchema() },
      annotations: { title: "Delete knowledgebase", readOnlyHint: false, destructiveHint: true },
    },
    async ({ rag_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(`/knowledgebase/${encodeURIComponent(rag_id)}`, apiKey, {
          method: "DELETE",
        });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
