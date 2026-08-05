import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bolnaFetch } from "../lib/bolna-client";
import { toErrorResult } from "../lib/errors";
import { getApiKey } from "../lib/auth";
import { agentIdSchema, apiKeyOverrideSchema, batchIdSchema, e164Phone } from "./schemas";

const jsonResult = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

// POST /batches takes multipart/form-data with a CSV file (confirmed live
// in the docs: "Use multipart/form-data — not JSON"), not a JSON array —
// there's no JSON alternative on Bolna's side. Rather than exposing raw
// file bytes as a tool argument, recipients are passed as structured JSON
// and turned into a CSV here. `contact_number` is Bolna's required column;
// any other key becomes a {variable} available in the agent's prompt.
function recipientsToCsv(recipients: Array<Record<string, string>>): string {
  const varKeys = new Set<string>();
  for (const r of recipients) {
    for (const key of Object.keys(r)) {
      if (key !== "contact_number") varKeys.add(key);
    }
  }
  const headers = ["contact_number", ...varKeys];
  const escape = (value: string) =>
    /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

  const lines = [headers.map(escape).join(",")];
  for (const r of recipients) {
    lines.push(headers.map((h) => escape(r[h] ?? "")).join(","));
  }
  return lines.join("\n");
}

// Bolna's scheduler rejects a "Z" suffix with a 500 (confirmed in the docs
// as a known gotcha) and requires a numeric UTC offset instead.
function toNumericUtcOffset(isoTimestamp: string): string {
  return isoTimestamp.endsWith("Z") ? isoTimestamp.slice(0, -1) + "+00:00" : isoTimestamp;
}

const recipientSchema = z.object({ contact_number: e164Phone() }).catchall(z.string());

export function registerBatchesTools(server: McpServer) {
  server.registerTool(
    "create_batch",
    {
      title: "Create batch",
      description:
        "Creates a batch of outbound calls for an agent from a list of recipients. Each recipient needs contact_number (E.164); any other field becomes a {variable} in the agent's prompt/welcome message. The batch is idle after creation — call schedule_batch to actually start calling.",
      inputSchema: {
        agent_id: agentIdSchema,
        recipients: z.array(recipientSchema).min(1, "at least one recipient is required"),
        from_phone_numbers: z.array(e164Phone()).optional(),
        retry_config: z
          .object({
            enabled: z.boolean(),
            max_retries: z.number().int().min(1),
            retry_intervals_minutes: z.array(z.number().int().min(1)),
          })
          .optional(),
        webhook_url: z.string().url().optional(),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Create batch", readOnlyHint: false, destructiveHint: false },
    },
    async ({ agent_id, recipients, from_phone_numbers, retry_config, webhook_url, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const csv = recipientsToCsv(recipients);
        const form = new FormData();
        form.append("agent_id", agent_id);
        form.append("file", new Blob([csv], { type: "text/csv" }), "recipients.csv");
        for (const number of from_phone_numbers ?? []) {
          form.append("from_phone_numbers", number);
        }
        if (retry_config) form.append("retry_config", JSON.stringify(retry_config));
        if (webhook_url) form.append("webhook_url", webhook_url);

        const result = await bolnaFetch("/batches", apiKey, { method: "POST", form });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err, { agentId: agent_id });
      }
    }
  );

  server.registerTool(
    "get_batch",
    {
      title: "Get batch",
      description:
        "Retrieves a batch's status, schedule, and contact counts. Use list_batches first to find a batch ID.",
      inputSchema: { batch_id: batchIdSchema, api_key: apiKeyOverrideSchema() },
      annotations: { title: "Get batch", readOnlyHint: true, openWorldHint: true },
    },
    async ({ batch_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(`/batches/${encodeURIComponent(batch_id)}`, apiKey);
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "schedule_batch",
    {
      title: "Schedule batch",
      description:
        "Schedules a created batch to start calling at a future time (must be at least 2 minutes out; Bolna rounds up to the next 10-minute mark). This commits the batch to placing real calls and spending account balance.",
      inputSchema: {
        batch_id: batchIdSchema,
        scheduled_at: z.string().datetime({ message: "scheduled_at must be an ISO 8601 timestamp" }),
        bypass_call_guardrails: z.boolean().optional().default(false),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Schedule batch", readOnlyHint: false, destructiveHint: true },
    },
    async ({ batch_id, scheduled_at, bypass_call_guardrails, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const form = new FormData();
        form.append("scheduled_at", toNumericUtcOffset(scheduled_at));
        form.append("bypass_call_guardrails", String(bypass_call_guardrails));

        const result = await bolnaFetch(`/batches/${encodeURIComponent(batch_id)}/schedule`, apiKey, {
          method: "POST",
          form,
        });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "stop_batch",
    {
      title: "Stop batch",
      description: "Halts a running or queued batch, cancelling any calls that haven't started yet.",
      inputSchema: { batch_id: batchIdSchema, api_key: apiKeyOverrideSchema() },
      annotations: { title: "Stop batch", readOnlyHint: false, destructiveHint: true },
    },
    async ({ batch_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(`/batches/${encodeURIComponent(batch_id)}/stop`, apiKey, {
          method: "POST",
        });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "delete_batch",
    {
      title: "Delete batch",
      description: "Permanently deletes a batch and removes it from scheduled or active batches.",
      inputSchema: { batch_id: batchIdSchema, api_key: apiKeyOverrideSchema() },
      annotations: { title: "Delete batch", readOnlyHint: false, destructiveHint: true },
    },
    async ({ batch_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(`/batches/${encodeURIComponent(batch_id)}`, apiKey, {
          method: "DELETE",
        });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
