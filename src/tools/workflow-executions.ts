import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bolnaFetch } from "../lib/bolna-client";
import { toErrorResult } from "../lib/errors";
import { getApiKey } from "../lib/auth";
import { apiKeyOverrideSchema, workflowExecutionIdSchema } from "./schemas";

const jsonResult = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data) }],
});

interface ExecutionDetail {
  nodes?: Record<string, any>[];
  events?: Record<string, any>[];
  [key: string]: unknown;
}

function summarizeExecution(detail: ExecutionDetail) {
  const { nodes = [], events = [], ...execution } = detail ?? {};
  const path = nodes.map((n) => {
    const caseLabel = n.matched_case_index === null || n.matched_case_index === undefined ? "no match" : `case ${n.matched_case_index}`;
    const next = n.to_node_id ? ` -> ${n.to_node_id}` : "";
    const when = n.scheduled_for ? ` @ ${n.scheduled_for}` : "";
    return `${n.node_id}#${n.attempt} ${n.status} (${caseLabel})${next}${when}`;
  });
  const folded: Record<string, any>[] = [];
  const seen = new Map<string, Record<string, any>>();
  for (const event of events) {
    if (event?.event_type !== "warning") {
      folded.push(event);
      continue;
    }
    const key = `${event.node_id}|${JSON.stringify(event.detail)}`;
    const first = seen.get(key);
    if (first) {
      first.count += 1;
      first.last_at = event.created_at;
    } else {
      const entry = { ...event, count: 1, last_at: event.created_at };
      seen.set(key, entry);
      folded.push(entry);
    }
  }
  return {
    ...execution,
    path,
    nodes: nodes.map(({ inputs: _inputs, ...rest }) => rest),
    events: folded,
  };
}

export function registerWorkflowExecutionsTools(server: McpServer) {
  server.registerTool(
    "get_workflow_execution",
    {
      title: "Get workflow execution",
      description:
        "Retrieves a single contact's progress through a workflow: current node, every node attempt in order, the most recent 100 timeline events, and outcome once terminal. Poll this to track a run_workflow call or an entry from list_workflow_campaign_executions. view \"summary\" is much smaller: it adds path (one line per node attempt: node, matched case, next node, scheduled time), drops each attempt's inputs (an agent node's inputs repeat every prompt variable) and folds repeated warnings into one entry with a count. Use \"full\" to see the inputs a node resolved. state is filled in once the execution ends.",
      inputSchema: {
        execution_id: workflowExecutionIdSchema,
        view: z
          .enum(["full", "summary"])
          .optional()
          .default("full")
          .describe("\"summary\" drops per-node inputs and folds repeated warnings; \"full\" is the engine's response as-is"),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Get workflow execution", readOnlyHint: true, openWorldHint: true },
    },
    async ({ execution_id, view, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch<ExecutionDetail>(
          `/workflow-executions/${encodeURIComponent(execution_id)}`,
          apiKey
        );
        return jsonResult(view === "summary" ? summarizeExecution(result) : result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "cancel_workflow_execution",
    {
      title: "Cancel workflow execution",
      description: "Terminates a running workflow execution for a single contact.",
      inputSchema: {
        execution_id: workflowExecutionIdSchema,
        reason: z.string().optional().describe("Free-form reason recorded on the cancellation."),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Cancel workflow execution", readOnlyHint: false, destructiveHint: true },
    },
    async ({ execution_id, reason, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(
          `/workflow-executions/${encodeURIComponent(execution_id)}:cancel`,
          apiKey,
          { method: "POST", body: reason !== undefined ? { reason } : {} }
        );
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "resend_workflow_webhook",
    {
      title: "Resend workflow execution webhook",
      description:
        "Queues a finished execution's webhook again, to the workflow's current webhook URL and headers. The payload is the one originally sent, occurred_at included, so a receiver keyed on execution_id sees a redelivery. Returns the execution_id and destination webhook_url once queued; delivery itself happens asynchronously. Fails with 409 if the execution hasn't finished or its workflow has no webhook set, 422 if the message is too large to queue at all, which a retry won't fix, and 502 if it couldn't be queued, which is safe to retry. Get execution IDs from run_workflow or list_workflow_campaign_executions.",
      inputSchema: { execution_id: workflowExecutionIdSchema, api_key: apiKeyOverrideSchema() },
      annotations: { title: "Resend workflow execution webhook", readOnlyHint: false, destructiveHint: false },
    },
    async ({ execution_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(
          `/workflow-executions/${encodeURIComponent(execution_id)}/webhook:resend`,
          apiKey,
          { method: "POST", body: {} }
        );
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
