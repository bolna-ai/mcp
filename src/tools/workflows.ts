import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bolnaFetch } from "../lib/bolna-client";
import { toErrorResult } from "../lib/errors";
import { getApiKey } from "../lib/auth";
import { apiKeyOverrideSchema, workflowContactSchema, workflowIdSchema } from "./schemas";

const jsonResult = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data) }],
});

// A node graph (nodes/cases/entry_node_id) with 9+ node types (start, agent,
// extraction, api, callback, time, retry, aisensy_whatsapp, end), each with
// its own config shape and branching logic (cases[].when supports "always"
// or a cmp/left/right comparison against var/const operands). Faithfully
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

// Fallback for a workflow-service whose node-type catalog has no definition_guide yet.
// Without one, models guessed the graph shape and spent many save/validate rounds fixing it.
// A stale line here costs one extra validation round, never a bad publish.
const WORKFLOW_DEFINITION_GUIDE = {
  envelope:
    '{"entry_node_id": "<start node id>", "on_no_match": "<fallback node id, required: where any node with no matching case goes, usually a failure end node>", "nodes": [...]}. Max 200 nodes.',
  node:
    '{"id": "^[a-z0-9_]{1,64}$", "type": "<node type>", "name": "<optional label>", "config": {...}, then its exit: "to": "<node id>" for time nodes only; "cases": [...] plus optional "on_no_match": "<node id>" for every other node type, start included (start needs at least one case, e.g. {"always": true}); nothing for end nodes}.',
  case: '{"when": <condition>, "then": {"to": "<node id>", "effects": [{"set_value": {"state.<key>": <operand>}}]}}. Cases are checked in order and the first match wins; effects are optional. At most 25 cases per node.',
  condition:
    '{"always": true} | {"cmp": "==|!=|>|>=|<|<=|in|contains", "left": <operand>, "right": <operand>} | {"exists": {"var": "..."}} | {"all": [<condition>, ...]} | {"any": [<condition>, ...]} | {"not": <condition>}.',
  operand:
    '{"var": "<namespace>.<name>"} for a variable (e.g. call.status, entry.<start field>, extraction.<field>, state.<key>) or {"const": <value>} for a literal.',
  agent_outcomes:
    'An agent node branches on call.status. Route "completed" onward and send the rest (e.g. no-answer, busy, failed) to a retry node or an end node.',
  retry:
    'A retry node loops back to an earlier node: config {"target_node_id": "<agent node id>", "attempts": [{"delay": {"days": 0, "hours": 1, "minutes": 0}}, ...]} (1-10 attempts). Its own cases run once the attempts are used up, e.g. {"always": true} to a failure end node. Only a retry node may close a cycle.',
  time: 'A time node waits: config {"delay": {"days", "hours", "minutes"}} or {"at": "<ISO time with offset>"}, then "to" the next node.',
  end: 'An end node needs config {"label": "<short reason>", "outcome": "success|failure|neutral"}.',
  example: {
    entry_node_id: "n_start",
    on_no_match: "n_end_fail",
    nodes: [
      {
        id: "n_start",
        type: "start",
        config: { trigger: { kind: "manual" } },
        cases: [{ when: { always: true }, then: { to: "n_call" } }],
      },
      {
        id: "n_call",
        type: "agent",
        config: { agent_id: "<agent id from list_agents>" },
        cases: [
          {
            when: { cmp: "==", left: { var: "call.status" }, right: { const: "completed" } },
            then: { to: "n_end_ok" },
          },
          { when: { always: true }, then: { to: "n_retry" } },
        ],
      },
      {
        id: "n_retry",
        type: "retry",
        config: { target_node_id: "n_call", attempts: [{ delay: { hours: 1 } }, { delay: { hours: 1 } }] },
        cases: [{ when: { always: true }, then: { to: "n_end_fail" } }],
      },
      { id: "n_end_ok", type: "end", config: { label: "completed", outcome: "success" } },
      { id: "n_end_fail", type: "end", config: { label: "unreachable", outcome: "failure" } },
    ],
  },
};

// The draft endpoint stores any JSON object without checking it; only /validate parses it.
// Validating as part of each save returns the issues in the same tool call instead of
// costing the model a separate validate_workflow round after every save.
async function validateDraft(workflowId: string, apiKey: string | undefined): Promise<unknown> {
  try {
    const result = (await bolnaFetch(`/workflows/${encodeURIComponent(workflowId)}/validate`, apiKey, {
      method: "POST",
      body: {},
    })) as { issues?: unknown } | null;
    return result?.issues ?? [];
  } catch (err) {
    return { validation_unavailable: err instanceof Error ? err.message : String(err) };
  }
}

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
            "Receiver URL. Must be https on port 443 or 8443, and its host must not be a private, loopback, link-local or carrier-NAT IP address; redirects are not followed. Pointing it at a different host or port drops the stored headers, so send them again in the same call. Required when turning the webhook on."
          ),
        headers: z
          .record(z.string().nullable())
          .optional()
          .describe(
            "Headers sent with every delivery, merged name by name onto the stored ones: a string sets that header, null removes it, an omitted header keeps its current value unless url moves to a different host or port. Names must be unique ignoring case; Host, Content-Length, Transfer-Encoding, Connection and any x-internal* name are reserved."
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
        "Creates a new unpublished workflow. To build one, pass the complete node graph as `definition`: this one call creates the workflow and saves and validates its draft, and returns the workflow, the draft `revision` and the validation `issues`. If `issues` has errors, fix them all in one save_workflow_draft call; if it has none, call publish_workflow. Call list_workflow_node_types first: its `definition_guide` has the graph grammar and a worked example. Leave out `definition` to create an empty workflow.",
      inputSchema: {
        name: z.string().min(1).max(120, "name must be 120 characters or fewer"),
        definition: workflowDefinitionSchema
          .optional()
          .describe("The full node graph to save as the first draft. See definition_guide in list_workflow_node_types."),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Create workflow", readOnlyHint: false, destructiveHint: false },
    },
    async ({ name, definition, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      let workflow: { id?: string } | null;
      try {
        workflow = (await bolnaFetch("/workflows", apiKey, { method: "POST", body: { name } })) as { id?: string } | null;
      } catch (err) {
        return toErrorResult(err);
      }
      if (!definition || !workflow?.id) return jsonResult(workflow);
      try {
        // A new workflow's draft starts at revision 0.
        const draft = await bolnaFetch(`/workflows/${encodeURIComponent(workflow.id)}/draft`, apiKey, {
          method: "PUT",
          body: { expected_revision: 0, definition },
        });
        return jsonResult({ workflow, ...(draft as object), issues: await validateDraft(workflow.id, apiKey) });
      } catch (err) {
        // The workflow exists even though its draft didn't save; saying so keeps the model
        // from creating a duplicate when it retries.
        const text = toErrorResult(err).content[0]?.text ?? "";
        return {
          content: [
            {
              type: "text" as const,
              text: `Workflow ${workflow.id} was created but its draft was not saved. Retry with save_workflow_draft (expected_revision 0) instead of creating it again. ${text}`,
            },
          ],
          isError: true as const,
        };
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
        "Changes a workflow's live settings. A change takes effect at once, including for executions already running, and is not tied to a published version. settings is an RFC 7396 JSON merge patch: omitted keys stay as they are and null removes a key. The only section is webhook, the execution webhook: one POST per contact execution when it finishes, with event \"execution.terminal\", execution_id, workflow_id, workflow_version, campaign_id, reference_id, status (completed | failed | cancelled | aborted), termination_reason (the end node's label, or internal_error | required_variable_missing | cancelled | campaign_aborted | zombie | terminated), outcome, occurred_at, and trail (every node attempt in order). Setting webhook.url turns it on; {\"webhook\": null} turns it off. Header values are write-only: the response and get_workflow show each as \"**********\". Omit a header to keep its value, since sending the mask back is rejected; a url on a different host or port drops every stored header instead. Call test_workflow_webhook afterwards to check the receiver.",
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
        "Overwrites a workflow's draft node graph, then validates it, and returns the new `revision` plus the validation `issues`, so there's no need to call validate_workflow afterwards. When issues has errors, fix every one of them in the next save rather than one at a time. expected_revision must match the draft's current revision (from get_workflow_draft or the previous save) or the call fails with a 409 revision conflict — call get_workflow_draft first if unsure. To build a new workflow, pass the graph to create_workflow instead. Use list_workflow_node_types to see available node types, their config fields and the definition_guide grammar. A callback node pauses the execution until your system POSTs to its URL; it must route callback.status == \"timeout\" with a case or its own on_no_match, and `status` is reserved as a payload_map name.",
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
        return jsonResult({ ...(result as object), issues: await validateDraft(workflow_id, apiKey) });
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
        "Lists every node type the workflow engine supports (start, agent, extraction, api, callback, time, retry, aisensy_whatsapp, end), with each one's config parameters, bounds, and defaults, plus a `definition_guide`: how nodes, cases, conditions and variables fit together, with a worked call-and-retry example. Call this once before authoring a definition for create_workflow or save_workflow_draft.",
      inputSchema: { api_key: apiKeyOverrideSchema() },
      annotations: { title: "List workflow node types", readOnlyHint: true, openWorldHint: true },
    },
    async ({ api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch("/workflow-node-types", apiKey);
        // workflow-service serves its own tested guide; this copy only covers deployments that predate it.
        return jsonResult({ definition_guide: WORKFLOW_DEFINITION_GUIDE, ...(result as object) });
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "get_workflow_callback",
    {
      title: "Get workflow callback",
      description:
        "Returns the callback URL and signing secret for a workflow's callback node, which your system POSTs to in order to resume executions waiting at that node; optionally the last payload received there (kept 30 minutes). Rotation stays a dashboard action.",
      inputSchema: {
        workflow_id: workflowIdSchema,
        node_id: z
          .string()
          .min(1, "node_id is required")
          .describe("The callback node's id in the workflow definition (from get_workflow_draft)"),
        include_last: z
          .boolean()
          .optional()
          .default(false)
          .describe("Also return the last payload this node's URL received, kept for 30 minutes"),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Get workflow callback", readOnlyHint: true, openWorldHint: true },
    },
    async ({ workflow_id, node_id, include_last, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      const path = `/workflows/${encodeURIComponent(workflow_id)}/nodes/${encodeURIComponent(node_id)}/callback`;
      try {
        const endpoint = await bolnaFetch(path, apiKey);
        if (!include_last) return jsonResult({ endpoint });
        const last = await bolnaFetch(`${path}:last`, apiKey);
        return jsonResult({ endpoint, last });
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
