import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bolnaFetch } from "../lib/bolna-client";
import { toErrorResult } from "../lib/errors";
import { getApiKey } from "../lib/auth";
import {
  apiKeyOverrideSchema,
  workflowCampaignIdSchema,
  workflowContactSchema,
  workflowIdSchema,
} from "./schemas";

const jsonResult = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

// Bolna's campaign action endpoints use a Google-style ":verb" suffix on the
// resource path (e.g. /workflow-campaigns/{id}:start), not a sub-path —
// confirmed the WHATWG URL parser leaves the literal colon untouched here.
function campaignActionPath(campaignId: string, action: string): string {
  return `/workflow-campaigns/${encodeURIComponent(campaignId)}:${action}`;
}

export function registerWorkflowCampaignsTools(server: McpServer) {
  server.registerTool(
    "create_workflow_campaign",
    {
      title: "Create workflow campaign",
      description:
        "Creates a campaign that will run many contacts through a workflow. Pins a published version (defaults to the latest at creation time). Starts in 'draft' status with no entries — use upload_workflow_campaign_entries to add contacts, then start_workflow_campaign (or set scheduled_at here to start automatically).",
      inputSchema: {
        workflow_id: workflowIdSchema,
        name: z.string().min(1).max(120, "name must be 120 characters or fewer"),
        version: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Published version to pin. Omit to pin the latest published version at creation time."),
        binding: z
          .record(z.any())
          .optional()
          .describe("Optional per-campaign overrides for agent and phone number mappings."),
        scheduled_at: z
          .string()
          .datetime({ message: "scheduled_at must be an ISO 8601 timestamp" })
          .optional()
          .describe("Timezone-aware timestamp to start the campaign at. Omit to start manually."),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Create workflow campaign", readOnlyHint: false, destructiveHint: false },
    },
    async ({ workflow_id, name, version, binding, scheduled_at, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch("/workflow-campaigns", apiKey, {
          method: "POST",
          body: { workflow_id, name, version, binding, scheduled_at },
        });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "list_workflow_campaigns",
    {
      title: "List workflow campaigns",
      description: "Lists workflow campaigns, optionally filtered by workflow, status, or kind. Paginated.",
      inputSchema: {
        workflow_id: workflowIdSchema.optional(),
        status: z
          .enum(["draft", "scheduled", "running", "paused", "completed", "aborted"])
          .optional(),
        kind: z.enum(["batch", "continuous", "api"]).optional(),
        sort_by: z
          .enum(["created_at", "updated_at", "name", "entries_count", "success_count", "failure_count"])
          .optional(),
        order: z.enum(["asc", "desc"]).optional(),
        limit: z.number().int().min(1).max(100).optional().default(20),
        offset: z.number().int().min(0).optional().default(0),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "List workflow campaigns", readOnlyHint: true, openWorldHint: true },
    },
    async ({ workflow_id, status, kind, sort_by, order, limit, offset, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch("/workflow-campaigns", apiKey, {
          query: { workflow_id, status, kind, sort_by, order, limit, offset },
        });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "get_workflow_campaign",
    {
      title: "Get workflow campaign",
      description:
        "Retrieves a campaign's status and totals, plus a breakdown of entry counts by state and validation error counts. Use list_workflow_campaigns first to find a campaign ID.",
      inputSchema: { campaign_id: workflowCampaignIdSchema, api_key: apiKeyOverrideSchema() },
      annotations: { title: "Get workflow campaign", readOnlyHint: true, openWorldHint: true },
    },
    async ({ campaign_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(
          `/workflow-campaigns/${encodeURIComponent(campaign_id)}`,
          apiKey
        );
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "delete_workflow_campaign",
    {
      title: "Delete workflow campaign",
      description: "Permanently deletes a campaign. Only allowed while it's an empty draft that hasn't started.",
      inputSchema: { campaign_id: workflowCampaignIdSchema, api_key: apiKeyOverrideSchema() },
      annotations: { title: "Delete workflow campaign", readOnlyHint: false, destructiveHint: true },
    },
    async ({ campaign_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(
          `/workflow-campaigns/${encodeURIComponent(campaign_id)}`,
          apiKey,
          { method: "DELETE" }
        );
        return jsonResult(result ?? { status: "deleted" });
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "upload_workflow_campaign_entries",
    {
      title: "Upload workflow campaign entries",
      description:
        "Adds contacts to a campaign for it to run. Only reference_id, mobile_number, name, and email are standard fields — anything else the campaign's pinned workflow declares in its start node should go in custom_fields. Rows that fail validation are reported individually without blocking the rows that succeed. Allowed while the campaign is draft, scheduled, or running.",
      inputSchema: {
        campaign_id: workflowCampaignIdSchema,
        entries: z.array(workflowContactSchema).min(1, "at least one entry is required"),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Upload workflow campaign entries", readOnlyHint: false, destructiveHint: false },
    },
    async ({ campaign_id, entries, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(
          `/workflow-campaigns/${encodeURIComponent(campaign_id)}/entries`,
          apiKey,
          { method: "POST", body: entries }
        );
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "list_workflow_campaign_entries",
    {
      title: "List workflow campaign entries",
      description: "Lists the contacts uploaded to a campaign, optionally filtered by status. Paginated.",
      inputSchema: {
        campaign_id: workflowCampaignIdSchema,
        status: z.enum(["pending", "failed_validation", "dispatched", "completed"]).optional(),
        sort_by: z.enum(["created_at", "reference_id", "status"]).optional(),
        order: z.enum(["asc", "desc"]).optional(),
        limit: z.number().int().min(1).max(100).optional().default(20),
        offset: z.number().int().min(0).optional().default(0),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "List workflow campaign entries", readOnlyHint: true, openWorldHint: true },
    },
    async ({ campaign_id, status, sort_by, order, limit, offset, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(
          `/workflow-campaigns/${encodeURIComponent(campaign_id)}/entries`,
          apiKey,
          { query: { status, sort_by, order, limit, offset } }
        );
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "get_workflow_campaign_entries_template",
    {
      title: "Get workflow campaign entries template",
      description:
        "Returns the CSV header row a campaign's pinned workflow version expects for entry uploads (system fields plus any custom fields its start node declares). Useful for building a CSV before calling upload_workflow_campaign_entries.",
      inputSchema: { campaign_id: workflowCampaignIdSchema, api_key: apiKeyOverrideSchema() },
      annotations: { title: "Get workflow campaign entries template", readOnlyHint: true, openWorldHint: true },
    },
    async ({ campaign_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch<string>(
          `/workflow-campaigns/${encodeURIComponent(campaign_id)}/entries/template`,
          apiKey
        );
        return { content: [{ type: "text" as const, text: String(result) }] };
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "start_workflow_campaign",
    {
      title: "Start workflow campaign",
      description:
        "Starts a draft or scheduled campaign immediately, dispatching its pending entries as real calls/messages. Fails if there are no pending entries or it has already started.",
      inputSchema: { campaign_id: workflowCampaignIdSchema, api_key: apiKeyOverrideSchema() },
      annotations: { title: "Start workflow campaign", readOnlyHint: false, destructiveHint: true },
    },
    async ({ campaign_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(campaignActionPath(campaign_id, "start"), apiKey, {
          method: "POST",
          body: {},
        });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "pause_workflow_campaign",
    {
      title: "Pause workflow campaign",
      description: "Pauses a scheduled or running campaign, halting new dispatches until resumed.",
      inputSchema: { campaign_id: workflowCampaignIdSchema, api_key: apiKeyOverrideSchema() },
      annotations: { title: "Pause workflow campaign", readOnlyHint: false, destructiveHint: true },
    },
    async ({ campaign_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(campaignActionPath(campaign_id, "pause"), apiKey, {
          method: "POST",
          body: {},
        });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "resume_workflow_campaign",
    {
      title: "Resume workflow campaign",
      description: "Resumes a paused campaign's dispatching.",
      inputSchema: { campaign_id: workflowCampaignIdSchema, api_key: apiKeyOverrideSchema() },
      annotations: { title: "Resume workflow campaign", readOnlyHint: false, destructiveHint: true },
    },
    async ({ campaign_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(campaignActionPath(campaign_id, "resume"), apiKey, {
          method: "POST",
          body: {},
        });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "abort_workflow_campaign",
    {
      title: "Abort workflow campaign",
      description:
        "Permanently terminates a campaign (cancelling any in-flight dispatching). This is a terminal state — an aborted campaign cannot be resumed or restarted.",
      inputSchema: { campaign_id: workflowCampaignIdSchema, api_key: apiKeyOverrideSchema() },
      annotations: { title: "Abort workflow campaign", readOnlyHint: false, destructiveHint: true },
    },
    async ({ campaign_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(campaignActionPath(campaign_id, "abort"), apiKey, {
          method: "POST",
          body: {},
        });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "list_workflow_campaign_executions",
    {
      title: "List workflow campaign executions",
      description:
        "Lists the per-contact executions a campaign has created, optionally filtered by status or outcome. Paginated.",
      inputSchema: {
        campaign_id: workflowCampaignIdSchema,
        status: z
          .enum(["pending", "running", "completed", "failed", "cancelled", "aborted"])
          .optional(),
        outcome: z.enum(["success", "failure", "neutral", "none"]).optional(),
        sort_by: z.enum(["created_at", "updated_at", "status", "outcome"]).optional(),
        order: z.enum(["asc", "desc"]).optional(),
        limit: z.number().int().min(1).max(100).optional().default(20),
        offset: z.number().int().min(0).optional().default(0),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "List workflow campaign executions", readOnlyHint: true, openWorldHint: true },
    },
    async ({ campaign_id, status, outcome, sort_by, order, limit, offset, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(
          `/workflow-campaigns/${encodeURIComponent(campaign_id)}/executions`,
          apiKey,
          { query: { status, outcome, sort_by, order, limit, offset } }
        );
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "get_workflow_campaign_report",
    {
      title: "Get workflow campaign report",
      description:
        "Retrieves an aggregated report for a campaign: execution counts by status, termination reasons, and a per-node funnel of attempt counts.",
      inputSchema: { campaign_id: workflowCampaignIdSchema, api_key: apiKeyOverrideSchema() },
      annotations: { title: "Get workflow campaign report", readOnlyHint: true, openWorldHint: true },
    },
    async ({ campaign_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(
          `/workflow-campaigns/${encodeURIComponent(campaign_id)}/report`,
          apiKey
        );
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
