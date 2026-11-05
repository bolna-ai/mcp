import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bolnaFetch } from "../lib/bolna-client";
import { toErrorResult } from "../lib/errors";
import { getApiKey } from "../lib/auth";
import { apiKeyOverrideSchema, workflowContactSchema, workflowIdSchema } from "./schemas";

const jsonResult = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data) }],
});

// Stringified into the definition parameter's description, where a tool description's
// 4,096-char client cap does not apply. Publishes clean once <agent_id> is a real agent.
const WORKFLOW_EXAMPLE = {
  entry_node_id: "n_start",
  on_no_match: "n_gave_up",
  defaults: { timezone: "Asia/Kolkata" },
  memory: {
    attempts: { type: "number", initial: 0, description: "Calls placed so far" },
    promised_date: { type: "timestamp", description: "Latest date the customer promised to pay" },
  },
  nodes: [
    { id: "n_start", type: "start", config: { trigger: { kind: "manual" } }, cases: [{ when: { always: true }, then: { to: "n_count" } }] },
    { id: "n_count", type: "memory", config: { set: [{ name: "attempts", op: "add", value: { const: 1 } }] }, to: "n_call" },
    {
      id: "n_call",
      type: "agent",
      config: { agent_id: "<agent_id>" },
      cases: [
        { when: { cmp: "==", left: { var: "call.status" }, right: { const: "completed" } }, then: { to: "n_ext" } },
        { when: { always: true }, then: { to: "n_retry" } },
      ],
    },
    {
      id: "n_ext",
      type: "extraction",
      config: { agent_node_id: "n_call", selected: ["ptp_date"] },
      cases: [{ when: { always: true }, then: { to: "n_remember" } }],
    },
    {
      id: "n_remember",
      type: "memory",
      config: { set: [{ name: "promised_date", op: "max", value: { var: "node.n_ext.extraction.ptp_date" } }] },
      to: "n_wait",
    },
    {
      id: "n_wait",
      type: "time",
      config: { at: { time: { from: { var: "memory.promised_date" }, at: "10:00" } } },
      cases: [
        { when: { cmp: "==", left: { var: "time.result" }, right: { const: "missing" } }, then: { to: "n_retry" } },
        { when: { always: true }, then: { to: "n_due" } },
      ],
    },
    {
      id: "n_retry",
      type: "retry",
      config: { attempts: [{ at: { time: { from: "today", offset: { days: 1 }, at: "10:00" } } }], target_node_id: "n_count" },
      cases: [{ when: { always: true }, then: { to: "n_gave_up" } }],
    },
    { id: "n_due", type: "end", config: { label: "promise_due", outcome: "success" } },
    { id: "n_gave_up", type: "end", config: { label: "no_promise", outcome: "failure" } },
  ],
};

// A node graph (nodes/cases/entry_node_id) with 10 node types (start, agent,
// extraction, api, callback, time, memory, retry, aisensy_whatsapp, end), each with
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
  .passthrough()
  .describe(
    "The whole definition: entry_node_id, on_no_match (where a node goes when none of its cases match and it has no on_no_match of its own), nodes, and the optional top-level memory and defaults. Example: a collections journey that counts call attempts, keeps the later of the promised payment dates, waits until 10:00 on that date, and calls again tomorrow at 10:00 when there is no date. Replace <agent_id> (from list_agents) and ptp_date (one of that agent's extraction fields, from list_dispositions): " +
      JSON.stringify(WORKFLOW_EXAMPLE)
  );

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
        "Changes a workflow's live settings. A change takes effect at once, including for executions already running, and is not tied to a published version. settings is an RFC 7396 JSON merge patch: omitted keys stay as they are and null removes a key. The only section is webhook, the execution webhook: one POST per contact execution when it finishes, with event \"execution.terminal\", execution_id, workflow_id, workflow_version, campaign_id, reference_id, status (completed | failed | cancelled | aborted), termination_reason (the end node's label, or internal_error | required_variable_missing | cancelled | campaign_aborted | zombie | terminated), outcome, occurred_at, trail (every node attempt in order), and memory (the final value of each declared memory variable, null when empty). Setting webhook.url turns it on; {\"webhook\": null} turns it off. Header values are write-only: the response and get_workflow show each as \"**********\". Omit a header to keep its value, since sending the mask back is rejected; a url on a different host or port drops every stored header instead. Call test_workflow_webhook afterwards to check the receiver.",
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
        "Overwrites a workflow's draft node graph. expected_revision must match the draft's current revision (from get_workflow_draft or the previous save) or the call fails with a 409 revision conflict — call get_workflow_draft first if unsure. " +
        "A callback node pauses the execution until your system POSTs to its URL; it must route callback.status == \"timeout\" with a case or its own on_no_match, and `status` is reserved as a payload_map name. " +
        "Read list_workflow_node_types first: it describes every node type's config, the memory section (declaration schema, name pattern, limits, which op works on which type) and the formats. The definition parameter carries a complete example. " +
        "Publish rules: declare every memory variable in the definition's top-level memory block, {\"<name>\": {\"type\": \"number\", \"initial\": 0}}, before a memory node writes it or anything reads memory.<name>. Memory and time nodes may use \"to\" instead of \"cases\" (not both). Non-zero offset hours or minutes cannot be combined with a time value's at. A time node with cases must route every time.result (waited, passed, missing), e.g. by ending on an always case. A start field with type \"timezone\" gives each contact's own zone (exact, case-sensitive IANA names such as \"Asia/Kolkata\", or the upload row fails with invalid_field_type); a blank value falls back to definition.defaults.timezone, and a workflow without defaults.timezone runs in Asia/Kolkata. validate_workflow's issue messages carry the exact JSON fix: an undeclared memory write's message holds the declaration to add, an undeclared memory read names the nearest declared name. " +
        "An operand is {\"var\": \"<namespace>.<path>\"}, {\"const\": ...}, {\"op\": \"+\" | \"-\" | \"*\" | \"/\", \"args\": [...]} or a time value. Earlier nodes' outputs stay readable all execution at node.<node_id>.* (e.g. node.<extraction_node_id>.extraction.<field>), so read what a call said there directly. " +
        "Memory is for a value that changes or has several writers: a counter, a flag, the latest of several dates, a computed value. A memory node writes it (config.set rows {\"name\", \"op\", \"value\"}, run top to bottom; a memory node's cases see its writes) and {\"var\": \"memory.<name>\"} reads it anywhere. A value that does not resolve, is null or does not convert to the declared type is refused and the old value kept, with a timeline warning; op clear empties it. Memory starts from the initial values and lasts the contact's whole journey; its final values arrive as memory in the execution webhook and get_workflow_execution. " +
        "A time value, {\"time\": {\"from\": \"now\" | \"today\" | <operand>, \"offset\": {\"days\": 1, \"hours\": 0, \"minutes\": 0}, \"at\": \"10:00\"}}, is a moment in the contact's timezone: days are calendar days, at sets the clock, hours and minutes are elapsed time. 10 AM tomorrow is {\"time\": {\"from\": \"today\", \"offset\": {\"days\": 1}, \"at\": \"10:00\"}}. Use it as a time node's or retry attempt's at, a memory value, or in a condition, where < <= > >= compare two timestamps as instants: {\"cmp\": \"<\", \"left\": {\"var\": \"memory.promised_date\"}, \"right\": {\"time\": {\"from\": \"now\"}}}. A time node's time.result is waited, passed (its at was already past, so it did not wait) or missing (its at did not resolve). " +
        "In a template string (WhatsApp variables, api url, headers and body) a dotted timestamp ref takes a format, {memory.promised_date|date}, rendered in the contact's timezone; the names are the catalog's formats. Agent and api variables stay ISO, and a bare api input {name|date} is sent as written. " +
        "system.* carries what an agent prompt gets, read when the node runs: current_hour, current_minute, current_day, current_month, current_year (ints), current_weekday (lowercase), current_date and current_time (display strings, not for comparisons), timezone, and current_timestamp and current_day_start (Unix seconds; to wait on or compare a time, use a time value). After 7 PM is system.current_hour >= 19. Full reference: search_docs \"workflow conditions and variables\".",
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
        "Lists every node type the workflow engine supports (start, agent, extraction, api, callback, time, memory, retry, aisensy_whatsapp, end), with each one's config parameters, bounds, defaults and what its cases branch on, plus the variable namespaces, the memory section (the declaration schema for the definition's top-level memory block, the name pattern, limits, and ops_by_type: which memory-node op works on which type) and formats (each timestamp format name with how it renders). Use this before authoring a workflow definition for save_workflow_draft.",
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
