import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bolnaFetch } from "../lib/bolna-client";
import { toErrorResult } from "../lib/errors";
import { getApiKey } from "../lib/auth";
import { z } from "zod";
import {
  apiKeyOverrideSchema,
  batchIdSchema,
  executionIdSchema,
  pageNumberSchema,
  pageSizeSchema,
  paginate,
  asList,
} from "./schemas";

interface RawLogEntry {
  created_at: string;
  type: "request" | "response";
  component: string;
  provider: string;
  data: string;
  reasoning_content?: string;
}

interface BatchExecutionSummary {
  id: string;
  status: string;
  conversation_duration: number | null;
  created_at: string;
}

// Mirrors DEBUG_SECTIONS in dashboard-backend routes/executions.py.
const DEBUG_SECTIONS = ["execution", "progression", "logs"] as const;

const jsonResult = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data) }],
});

export function registerExecutionsTools(server: McpServer) {
  server.registerTool(
    "get_execution_raw_logs",
    {
      title: "Get call raw logs",
      description:
        "Fetches the raw pipeline logs for a call execution: every request/response between the telephony, transcriber, LLM, and synthesizer components, including LLM reasoning summaries where available. Much more detailed than get_execution — use this for deep debugging.",
      inputSchema: {
        execution_id: executionIdSchema,
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Get call raw logs", readOnlyHint: true, openWorldHint: true },
    },
    async ({ execution_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const logs = await bolnaFetch<{ status: string; data: RawLogEntry[] }>(
          `/executions/${encodeURIComponent(execution_id)}/log`,
          apiKey
        );
        return jsonResult(logs);
      } catch (err) {
        return toErrorResult(err, { executionId: execution_id });
      }
    }
  );

  server.registerTool(
    "get_execution_debug",
    {
      title: "Get call debug bundle",
      description:
        "Fetches what you need to debug one call execution, in a single request: the execution's status, cost, telephony data, latency and extractions; per-turn latency analytics with the structured transcript; and the pipeline logs (transcriber, LLM, synthesizer, function calls, webhook delivery). It always returns the customer view, so staff-only data is not included. To keep the result small, empty fields are dropped and LLM requests are delta-encoded. The first `llm` request is the full rendered prompt that ran. Each later one has only the text it adds, and `data_shared_prefix_chars` says how many leading characters it shares with the previous request (full text = previous_full[:data_shared_prefix_chars] + data). Pass `include` to fetch only some sections. A section that doesn't exist for this call, or that failed, comes back null, and the reason (`not_available` or `error`) is listed under `unavailable`. For anything trimmed here, use get_execution (full record, including the prose transcript), get_execution_raw_logs (logs without delta encoding) or get_agent (agent config).",
      inputSchema: {
        execution_id: executionIdSchema,
        include: z
          .array(z.enum(DEBUG_SECTIONS))
          .min(1)
          .optional()
          .describe("Sections to return. Omit for all of them."),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Get call debug bundle", readOnlyHint: true, openWorldHint: true },
    },
    async ({ execution_id, include, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const query = include ? `?include=${encodeURIComponent([...new Set(include)].join(","))}` : "";
        const bundle = await bolnaFetch(
          `/executions/${encodeURIComponent(execution_id)}/debug${query}`,
          apiKey
        );
        // Compact JSON: indentation alone adds ~3% to an already large result.
        return { content: [{ type: "text" as const, text: JSON.stringify(bundle) }] };
      } catch (err) {
        return toErrorResult(err, { executionId: execution_id });
      }
    }
  );

  server.registerTool(
    "list_batch_executions",
    {
      title: "List batch call executions",
      description:
        "Lists every call execution within a batch, including status, duration, and per-recipient context. Use list_batches first to find a batch ID. Paginated.",
      inputSchema: {
        batch_id: batchIdSchema,
        page_number: pageNumberSchema,
        page_size: pageSizeSchema,
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "List batch call executions", readOnlyHint: true, openWorldHint: true },
    },
    async ({ batch_id, page_number, page_size, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const executions = asList<{
          id: string;
          status: string;
          conversation_duration: number | null;
          created_at: string;
        }>(
          await bolnaFetch<unknown>(`/batches/${encodeURIComponent(batch_id)}/executions`, apiKey),
          `GET /batches/${batch_id}/executions`
        );
        const page = paginate(executions, page_number, page_size);
        const summaries: BatchExecutionSummary[] = page.map((e) => ({
          id: e.id,
          status: e.status,
          conversation_duration: e.conversation_duration,
          created_at: e.created_at,
        }));
        return jsonResult({
          batch_id,
          page_number,
          page_size,
          total: executions.length,
          executions: summaries,
        });
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
