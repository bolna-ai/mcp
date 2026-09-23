import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bolnaFetch } from "../lib/bolna-client";
import { toErrorResult } from "../lib/errors";
import { getApiKey } from "../lib/auth";
import { apiKeyOverrideSchema, workflowContactSchema, workflowIdSchema } from "./schemas";

const jsonResult = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

// A node graph (nodes/cases/entry_node_id) with 8+ node types (start, agent,
// extraction, api, time, retry, aisensy_whatsapp, end), each with its own
// config shape and branching logic (cases[].when supports "always" or a
// cmp/left/right comparison against var/const operands). Faithfully
// modeling every node type here would be as brittle as it is verbose, so
// only the top-level shape is fixed; individual nodes pass through as-is —
// same rationale as agentConfigSchema's tasks/tools_config in write.ts.
const workflowDefinitionSchema = z
  .object({
    entry_node_id: z.string(),
    on_no_match: z.string().optional(),
    nodes: z.array(z.record(z.any())),
  })
  .passthrough();

// Passthrough so an unknown key reaches the engine's 422 instead of being silently stripped.
const workflowSettingsPatchSchema = z
  .object({
    webhook: z
      .object({
        url: z
          .string()
          .url()
          .optional()
          .describe(
            "Receiver URL. Must be https on port 443 or 8443 and resolve to a public address; redirects are not followed. Required when turning the webhook on."
          ),
        headers: z
          .record(z.string().nullable())
          .optional()
          .describe(
            "Headers sent with every delivery, merged name by name onto the stored ones: a string sets that header, null removes it, an omitted header keeps its current value. Names must be unique ignoring case; Host, Content-Length, Transfer-Encoding, Connection and any x-internal* name are reserved."
          ),
      })
      .passthrough()
      .nullable()
      .optional()
      .describe("The execution webhook. null turns it off, removing the URL and every header."),
  })
  .passthrough();

export function registerWorkflowsTools(server: McpServer) {
  server.registerTool(
    "create_workflow",
    {
      title: "Create workflow",
      description:
        "Creates a new (empty, unpublished) workflow. Returns its ID. Use save_workflow_draft to add the node graph, then validate_workflow and publish_workflow before running it.",
      inputSchema: {
        name: z.string().min(1).max(120, "name must be 120 characters or fewer"),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Create workflow", readOnlyHint: false, destructiveHint: false },
    },
    async ({ name, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch("/workflows", apiKey, { method: "POST", body: { name } });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "list_workflows",
    {
      title: "List workflows",
      description: "Lists workflows in the account, optionally filtered by name. Paginated.",
      inputSchema: {
        name: z.string().optional().describe("Case-insensitive substring filter on the workflow name"),
        limit: z.number().int().min(1).max(100).optional().default(20),
        offset: z.number().int().min(0).optional().default(0),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "List workflows", readOnlyHint: true, openWorldHint: true },
    },
    async ({ name, limit, offset, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch("/workflows", apiKey, { query: { name, limit, offset } });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "get_workflow",
    {
      title: "Get workflow",
      description:
        "Retrieves a workflow's status, its settings (the execution webhook URL and headers, with every header value masked as \"**********\"), and its full version history (draft metadata and every published version, each with campaign/contact outcome totals). Use list_workflows first to find a workflow ID.",
      inputSchema: { workflow_id: workflowIdSchema, api_key: apiKeyOverrideSchema() },
      annotations: { title: "Get workflow", readOnlyHint: true, openWorldHint: true },
    },
    async ({ workflow_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(`/workflows/${encodeURIComponent(workflow_id)}`, apiKey);
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "rename_workflow",
    {
      title: "Rename workflow",
      description: "Renames an existing workflow.",
      inputSchema: {
        workflow_id: workflowIdSchema,
        name: z.string().min(1).max(120, "name must be 120 characters or fewer"),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Rename workflow", readOnlyHint: false, destructiveHint: true },
    },
    async ({ workflow_id, name, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(`/workflows/${encodeURIComponent(workflow_id)}`, apiKey, {
          method: "PATCH",
          body: { name },
        });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "update_workflow_settings",
    {
      title: "Update workflow settings",
      description:
        "Changes a workflow's live settings. A change takes effect at once, including for executions already running, and is not tied to a published version. settings is an RFC 7396 JSON merge patch: omitted keys stay as they are and null removes a key. The only section is webhook, the execution webhook: one POST per contact execution when it finishes, with event \"execution.terminal\", execution_id, workflow_id, workflow_version, campaign_id, reference_id, status (completed | failed | cancelled | aborted), termination_reason (the end node's label, or internal_error | required_variable_missing | cancelled | campaign_aborted | zombie | terminated), outcome, occurred_at, and trail (every node attempt in order). Setting webhook.url turns it on; {\"webhook\": null} turns it off. Header values are write-only: the response and get_workflow show each as \"**********\". Omit a header to keep its value, since sending the mask back is rejected. Call test_workflow_webhook afterwards to check the receiver.",
      inputSchema: {
        workflow_id: workflowIdSchema,
        settings: workflowSettingsPatchSchema,
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Update workflow settings", readOnlyHint: false, destructiveHint: true },
    },
    async ({ workflow_id, settings, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(`/workflows/${encodeURIComponent(workflow_id)}`, apiKey, {
          method: "PATCH",
          body: { settings },
        });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "test_workflow_webhook",
    {
      title: "Test workflow webhook",
      description:
        "Sends one sample execution webhook to the workflow's saved webhook URL right now and reports how the receiver answered. The sample has the real payload shape, with a trail walked along the latest published version's first-case path so it carries this workflow's own node ids and extraction fields; reference_id SAMPLE-0001 and an all-zero campaign_id mark it as a sample. result.delivered is true only for a 2xx; otherwise error_type is http_error (see http_status and response_body) or unreachable (DNS, connect, TLS or timeout). Fails with 409 if no webhook is set (use update_workflow_settings) and 422 if the workflow has never been published.",
      inputSchema: { workflow_id: workflowIdSchema, api_key: apiKeyOverrideSchema() },
      annotations: { title: "Test workflow webhook", readOnlyHint: false, destructiveHint: false },
    },
    async ({ workflow_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(`/workflows/${encodeURIComponent(workflow_id)}/webhook:test`, apiKey, {
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
    "delete_workflow",
    {
      title: "Delete workflow",
      description: "Permanently deletes a workflow, including its draft and all published versions.",
      inputSchema: { workflow_id: workflowIdSchema, api_key: apiKeyOverrideSchema() },
      annotations: { title: "Delete workflow", readOnlyHint: false, destructiveHint: true },
    },
    async ({ workflow_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(`/workflows/${encodeURIComponent(workflow_id)}`, apiKey, {
          method: "DELETE",
        });
        return jsonResult(result ?? { status: "deleted" });
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "get_workflow_draft",
    {
      title: "Get workflow draft",
      description:
        "Retrieves a workflow's current editable draft definition (node graph) and its revision number, needed to save further edits without a conflict.",
      inputSchema: { workflow_id: workflowIdSchema, api_key: apiKeyOverrideSchema() },
      annotations: { title: "Get workflow draft", readOnlyHint: true, openWorldHint: true },
    },
    async ({ workflow_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(`/workflows/${encodeURIComponent(workflow_id)}/draft`, apiKey);
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "save_workflow_draft",
    {
      title: "Save workflow draft",
      description:
        "Overwrites a workflow's draft node graph. expected_revision must match the draft's current revision (from get_workflow_draft or the previous save) or the call fails with a 409 revision conflict — call get_workflow_draft first if unsure. Use list_workflow_node_types to see available node types and their config fields.",
      inputSchema: {
        workflow_id: workflowIdSchema,
        expected_revision: z.number().int().min(0),
        definition: workflowDefinitionSchema,
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Save workflow draft", readOnlyHint: false, destructiveHint: true },
    },
    async ({ workflow_id, expected_revision, definition, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(`/workflows/${encodeURIComponent(workflow_id)}/draft`, apiKey, {
          method: "PUT",
          body: { expected_revision, definition },
        });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "validate_workflow",
    {
      title: "Validate workflow",
      description:
        "Checks a workflow's saved draft for errors (e.g. dangling case targets, unbounded cycles, unknown agent references) before publishing. Errors block publish_workflow; warnings don't. Save the draft first with save_workflow_draft.",
      inputSchema: { workflow_id: workflowIdSchema, api_key: apiKeyOverrideSchema() },
      annotations: { title: "Validate workflow", readOnlyHint: true, openWorldHint: true },
    },
    async ({ workflow_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(`/workflows/${encodeURIComponent(workflow_id)}/validate`, apiKey, {
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
    "publish_workflow",
    {
      title: "Publish workflow",
      description:
        "Freezes a workflow's current draft as a new immutable published version, which run_workflow and new campaigns then use. Fails if the draft has unresolved validation errors (run validate_workflow first) or is identical to the latest published version.",
      inputSchema: { workflow_id: workflowIdSchema, api_key: apiKeyOverrideSchema() },
      annotations: { title: "Publish workflow", readOnlyHint: false, destructiveHint: true },
    },
    async ({ workflow_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(`/workflows/${encodeURIComponent(workflow_id)}/publish`, apiKey, {
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
    "get_workflow_version",
    {
      title: "Get workflow version",
      description: "Retrieves a specific published version of a workflow, including its full node graph.",
      inputSchema: {
        workflow_id: workflowIdSchema,
        version: z.number().int().min(1),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Get workflow version", readOnlyHint: true, openWorldHint: true },
    },
    async ({ workflow_id, version, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(
          `/workflows/${encodeURIComponent(workflow_id)}/versions/${version}`,
          apiKey
        );
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "run_workflow",
    {
      title: "Run workflow",
      description:
        "Runs a single contact through a workflow's latest published version, creating a real execution (and an implicit single-contact campaign) immediately. Fields the start node declares may be passed flat at the top level or nested under custom_fields; undeclared fields are rejected. Reusing the same reference_id returns the existing execution instead of starting a new one.",
      inputSchema: {
        workflow_id: workflowIdSchema,
        contact: workflowContactSchema,
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Run workflow", readOnlyHint: false, destructiveHint: true },
    },
    async ({ workflow_id, contact, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(`/workflows/${encodeURIComponent(workflow_id)}/run`, apiKey, {
          method: "POST",
          body: contact,
        });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "list_workflow_node_types",
    {
      title: "List workflow node types",
      description:
        "Lists every node type the workflow engine supports (start, agent, extraction, api, time, retry, aisensy_whatsapp, end), with each one's config parameters, bounds, and defaults. Use this before authoring a workflow definition for save_workflow_draft.",
      inputSchema: { api_key: apiKeyOverrideSchema() },
      annotations: { title: "List workflow node types", readOnlyHint: true, openWorldHint: true },
    },
    async ({ api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch("/workflow-node-types", apiKey);
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
