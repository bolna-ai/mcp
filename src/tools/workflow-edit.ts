import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bolnaFetch } from "../lib/bolna-client";
import { toErrorResult } from "../lib/errors";
import { getApiKey } from "../lib/auth";
import { conflictRevision, loadDraft, saveDraftAndValidate } from "../lib/workflow-draft";
import { applyOps, compareAgentVariables, EditError, type EditOp } from "../lib/workflow-edit";
import { agentIdSchema, apiKeyOverrideSchema, workflowIdSchema } from "./schemas";

const jsonResult = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data) }],
});

const textError = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true as const });

const nodeIdSchema = z.string().min(1, "node_id is required");
const pathSchema = z
  .union([z.string(), z.array(z.union([z.string(), z.number().int().min(0)]))])
  .describe(
    'Where to write, relative to the node when node_id is given, else to the definition root. Dot-separated with numeric list indexes ("config.timeout_s", "cases.1.then.to"), or a list of segments when a key itself holds a dot (["cases", 0, "then", "effects", 0, "set_value", "state.dials"]).'
  );
const caseSchema = z.record(z.any()).describe("A full case: {when, then: {to, effects?}}");

const editOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("upsert_node"),
    node: z.record(z.any()).describe("The whole node. Replaces the node with the same id, or is appended."),
  }),
  z.object({ op: z.literal("remove_node"), node_id: nodeIdSchema }),
  z.object({ op: z.literal("set"), node_id: nodeIdSchema.optional(), path: pathSchema, value: z.any() }),
  z.object({ op: z.literal("unset"), node_id: nodeIdSchema.optional(), path: pathSchema }),
  z.object({
    op: z.literal("insert_case"),
    node_id: nodeIdSchema,
    case: caseSchema,
    index: z.number().int().min(0).optional().describe("Position to insert at; omitted appends"),
  }),
  z.object({ op: z.literal("replace_case"), node_id: nodeIdSchema, index: z.number().int().min(0), case: caseSchema }),
  z.object({ op: z.literal("remove_case"), node_id: nodeIdSchema, index: z.number().int().min(0) }),
  z.object({
    op: z.literal("rename_node"),
    node_id: nodeIdSchema,
    new_id: z.string().optional().describe("New node id; every reference to the old id is rewritten"),
    name: z.string().optional().describe("New display name"),
  }),
  z.object({
    op: z.literal("map_agent_variables"),
    node_id: nodeIdSchema,
    overwrite: z.boolean().optional().describe("Also replace variables that are already mapped. Default false."),
  }),
]);

async function fetchAgentVariables(agentId: string, apiKey: string | undefined): Promise<string[]> {
  const result = await bolnaFetch<{ variables?: unknown }>(`/agent/${encodeURIComponent(agentId)}/variables`, apiKey);
  return Array.isArray(result?.variables) ? result.variables.filter((v): v is string => typeof v === "string") : [];
}

async function patchDraft(
  workflowId: string,
  apiKey: string | undefined,
  ops: EditOp[],
  expectedRevision: number | undefined,
  dryRun: boolean
) {
  const draft = await loadDraft(workflowId, apiKey);
  if (expectedRevision !== undefined && expectedRevision !== draft.revision) {
    return textError(
      `Revision conflict: the draft is at revision ${draft.revision}, not ${expectedRevision}. Nothing was saved. Re-read it with get_workflow_draft, or omit expected_revision to patch whatever is current.`
    );
  }
  const definition = structuredClone(draft.definition);
  const cache = new Map<string, Promise<string[]>>();
  const lookup = (agentId: string) => {
    if (!cache.has(agentId)) cache.set(agentId, fetchAgentVariables(agentId, apiKey));
    return cache.get(agentId)!;
  };
  let applied;
  try {
    applied = await applyOps(definition, ops, lookup);
  } catch (err) {
    if (err instanceof EditError) return textError(`Nothing was saved: ${err.message}`);
    throw err;
  }
  const touchedNodes = (definition.nodes ?? []).filter((n: any) => applied.touched.has(n?.id));
  if (dryRun) {
    return jsonResult({ dry_run: true, revision: draft.revision, applied: applied.applied, warnings: applied.warnings, nodes: touchedNodes });
  }
  try {
    const saved = await saveDraftAndValidate(workflowId, apiKey, draft.revision, definition);
    return jsonResult({
      ...saved,
      ...(draft.draft_exists ? {} : { draft_created_from_version: draft.based_on_version ?? null }),
      applied: applied.applied,
      warnings: applied.warnings,
    });
  } catch (err) {
    const current = conflictRevision(err);
    if (current !== undefined) {
      return textError(
        `Revision conflict: someone saved the draft while this patch was being applied (now revision ${current}). Nothing was saved; run the patch again.`
      );
    }
    throw err;
  }
}

export function registerWorkflowEditTools(server: McpServer) {
  server.registerTool(
    "patch_workflow_draft",
    {
      title: "Patch workflow draft",
      description:
        "Edits a workflow's draft in place with a list of small operations, instead of resending the whole definition through save_workflow_draft. Reads the current draft (or, right after a publish, the published version the next draft starts from), applies the operations in order, saves with the right revision, and runs validate. Returns the new revision, the validate issues, what each operation did, and warnings. If any operation fails, nothing is saved. Operations: upsert_node {node} replaces the node with the same id or adds it; remove_node {node_id}; set {node_id?, path, value} and unset {node_id?, path} write or delete one value inside a node (or the definition root when node_id is omitted), e.g. {\"op\":\"set\",\"node_id\":\"n_wait\",\"path\":\"config.delay.hours\",\"value\":2}; insert_case {node_id, case, index?}, replace_case {node_id, index, case} and remove_case {node_id, index} edit a node's ordered cases (a time node has one `to`, not cases; set its `to` instead); rename_node {node_id, new_id?, name?} changes the display name and/or the id, rewriting every reference to the id (to, on_no_match, entry_node_id, retry target_node_id, node.<id>.* variables and templates, ui.conditions); map_agent_variables {node_id, overwrite?} maps each of the agent's prompt variables to the start field of the same name as {\"value\": {\"var\": \"entry.<name>\"}} and warns about any with no such field. Pass expected_revision to refuse the patch if the draft moved since you read it; dry_run returns the changed nodes without saving.",
      inputSchema: {
        workflow_id: workflowIdSchema,
        operations: z.array(editOpSchema).min(1).max(100),
        expected_revision: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Fail instead of saving if the draft is no longer at this revision. Omit to patch the current draft."),
        dry_run: z.boolean().optional().default(false).describe("Apply in memory and return the changed nodes, without saving"),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Patch workflow draft", readOnlyHint: false, destructiveHint: true },
    },
    async ({ workflow_id, operations, expected_revision, dry_run, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        return await patchDraft(workflow_id, apiKey, operations as EditOp[], expected_revision, dry_run);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "rename_workflow_node",
    {
      title: "Rename workflow node",
      description:
        "Changes a draft node's display name, its id, or both, and saves. A new id is rewritten everywhere the old one is referenced: case targets, to, on_no_match, entry_node_id, a retry node's target_node_id, node.<id>.* variable references and templates, and the editor's ui.conditions. A callback node's URL is keyed by its id, so a new id gives it a new URL and signing secret. Returns the new revision and validate issues. The same operation is available inside patch_workflow_draft as rename_node.",
      inputSchema: {
        workflow_id: workflowIdSchema,
        node_id: nodeIdSchema.describe("The node's current id"),
        new_id: z.string().optional().describe("New id: 1-64 characters of a-z, 0-9 and _"),
        name: z.string().optional().describe("New display name"),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Rename workflow node", readOnlyHint: false, destructiveHint: true },
    },
    async ({ workflow_id, node_id, new_id, name, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        return await patchDraft(workflow_id, apiKey, [{ op: "rename_node", node_id, new_id, name }], undefined, false);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "duplicate_workflow",
    {
      title: "Duplicate workflow",
      description:
        "Copies a workflow into a new, unpublished workflow whose draft holds the copied definition (revision 0), e.g. to build a test twin. Copies the given published version, else the latest published version, else the current draft. Agents the account doesn't already own are copied too, and imported_agents maps each source agent id to its copy. Returns the new workflow.",
      inputSchema: {
        workflow_id: workflowIdSchema.describe("The workflow to copy"),
        name: z.string().min(1).max(120, "name must be 120 characters or fewer").optional().describe("Name of the copy"),
        version: z.number().int().min(1).optional().describe("Published version to copy"),
        include_webhook: z.boolean().optional().default(false).describe("Also copy the execution webhook settings"),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Duplicate workflow", readOnlyHint: false, destructiveHint: false },
    },
    async ({ workflow_id, name, version, include_webhook, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch("/workflows:import", apiKey, {
          method: "POST",
          body: {
            source_workflow_id: workflow_id,
            ...(name ? { name } : {}),
            ...(version ? { version } : {}),
            ...(include_webhook ? { include_settings: ["webhook"] } : {}),
          },
        });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "list_agent_variables",
    {
      title: "List agent variables",
      description:
        "Lists the {placeholder} variables an agent's prompt, welcome message and graph prompts read, without the full agent config get_agent returns. With workflow_id, also checks each agent node in that workflow's draft that uses this agent (or only node_id): mapped, unmapped, auto_mappable (unmapped ones a start field of the same name could fill; patch_workflow_draft's map_agent_variables writes those mappings) and unused_mappings (mapped but never read by the prompt).",
      inputSchema: {
        agent_id: agentIdSchema,
        workflow_id: workflowIdSchema.optional(),
        node_id: nodeIdSchema.optional().describe("Only check this agent node"),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "List agent variables", readOnlyHint: true, openWorldHint: true },
    },
    async ({ agent_id, workflow_id, node_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      let variables: string[];
      try {
        variables = await fetchAgentVariables(agent_id, apiKey);
      } catch (err) {
        return toErrorResult(err, { agentId: agent_id });
      }
      if (!workflow_id) return jsonResult({ agent_id, variables });
      try {
        const draft = await loadDraft(workflow_id, apiKey);
        const agentNodes = (draft.definition.nodes ?? []).filter(
          (n: any) => n?.type === "agent" && n?.config?.agent_id === agent_id && (!node_id || n.id === node_id)
        );
        if (node_id && agentNodes.length === 0) {
          return textError(`No agent node '${node_id}' using agent ${agent_id} in workflow ${workflow_id}'s draft.`);
        }
        return jsonResult({
          agent_id,
          variables,
          nodes: agentNodes.map((n: any) => ({ node_id: n.id, ...compareAgentVariables(draft.definition, n, variables) })),
        });
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
