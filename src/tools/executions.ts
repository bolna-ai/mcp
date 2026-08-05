import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bolnaFetch } from "../lib/bolna-client";
import { toErrorResult } from "../lib/errors";
import { getApiKey } from "../lib/auth";
import {
  apiKeyOverrideSchema,
  batchIdSchema,
  executionIdSchema,
  pageNumberSchema,
  pageSizeSchema,
  paginate,
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

const jsonResult = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
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
        const executions = await bolnaFetch<
          Array<{ id: string; status: string; conversation_duration: number | null; created_at: string }>
        >(`/batches/${encodeURIComponent(batch_id)}/executions`, apiKey);
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
