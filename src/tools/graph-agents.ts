/**
 * Graph agents (https://www.bolna.ai/docs/graph-agent/introduction).
 *
 * There is no separate graph-agent resource in the Bolna API: a graph agent
 * is an ordinary v2 agent whose conversation task has
 * `tools_config.llm_agent.agent_type: "graph_agent"`, with the graph itself
 * (nodes, edges, routing settings) under `tools_config.llm_agent.llm_config`
 * — confirmed against docs/graph-agent/full-example and router-nodes,
 * 2026-10-12. These tools are typed wrappers over /v2/agent for that shape,
 * plus the one graph-only endpoint, `POST /v1/call/{run_id}/events`
 * (docs/graph-agent/event-injection).
 *
 * validate_graph_agent mirrors the editor's documented checks
 * (docs/graph-agent/validation) so a broken graph is caught before it is
 * saved; create/update run the same checks and refuse on errors.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bolnaFetch } from "../lib/bolna-client";
import { toErrorResult } from "../lib/errors";
import { getApiKey } from "../lib/auth";
import { agentIdSchema, apiKeyOverrideSchema } from "./schemas";

const jsonResult = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

const errorText = (text: string) => ({
  content: [{ type: "text" as const, text }],
  isError: true as const,
});

const OPERATORS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "in",
  "not_in",
  "exists",
  "not_exists",
] as const;

const CONDITION_TYPES = ["llm", "expression", "unconditional", "event"] as const;
const NODE_TYPES = ["llm", "static", "router"] as const;

// dashboard-backend's TELEPHONY_PROVIDER_AUDIO_FORMATS; `sip-trunk` is a
// legacy SIP trunk, `trunk` a SIP trunk.
const TELEPHONY_AUDIO_FORMATS = {
  twilio: "wav",
  plivo: "wav",
  exotel: "wav",
  vobiz: "wav",
  "sip-trunk": "ulaw",
  trunk: "linear16",
} as const;

// Factories rather than shared instances, for the same $ref-collapsing
// reason documented on e164Phone in schemas.ts.
function edgeSchema() {
  return z
    .object({
      to_node_id: z.string().min(1).describe("ID of the node this edge transitions to."),
      condition: z
        .string()
        .nullish()
        .describe(
          "For LLM (intent) edges, the routing LLM's description of when to take this edge — the only thing it sees. For other types, a human-readable label."
        ),
      condition_type: z
        .enum(CONDITION_TYPES)
        .nullish()
        .describe(
          'Omit (or "llm") for intent routing on the user\'s reply. "expression" checks `expression` against context variables, "unconditional" always fires, "event" fires on an injected event named `event_name`. Deterministic types are checked before the routing LLM runs.'
        ),
      expression: z
        .object({
          logic: z.enum(["and", "or"]).nullish().describe('Defaults to "and".'),
          conditions: z
            .array(
              z
                .object({
                  variable: z
                    .string()
                    .min(1)
                    .describe(
                      "Context variable, e.g. recipient_data.current_hour, _silence_repeats, _node_turns, detected_language, or a key captured by an earlier edge's parameters. Time variables only populate when recipient_data.timezone is set on the call."
                    ),
                  operator: z.enum(OPERATORS),
                  value: z.any().nullish().describe("Omit for exists / not_exists."),
                })
                .passthrough()
            )
            .min(1),
        })
        .passthrough()
        .nullish()
        .describe('Required when condition_type is "expression".'),
      event_name: z
        .string()
        .nullish()
        .describe('Required when condition_type is "event". Must match the `event` sent to send_graph_agent_event.'),
      parameters: z
        .record(z.string())
        .nullish()
        .describe(
          'Values to extract from the user\'s reply on this transition, as {name: type}, e.g. {"appointment_day": "string"}. Merged into context_data, usable as {name} downstream.'
        ),
      priority: z
        .number()
        .nullish()
        .describe("Lower fires first. Defaults to 0 for deterministic edges, 100 for LLM edges."),
      function_name: z.string().nullish().describe("Overrides the default routing tool name transition_to_<to_node_id>."),
      function_description: z.string().nullish(),
    })
    .passthrough();
}

function nodeSchema() {
  return z
    .object({
      id: z.string().min(1).describe("Unique node ID."),
      node_type: z
        .enum(NODE_TYPES)
        .nullish()
        .describe(
          '"llm" (default) speaks from `prompt`; "static" plays `static_message` from cached audio (~50ms, no LLM cost); "router" never speaks and only dispatches via its edges.'
        ),
      prompt: z.string().nullish().describe("Node instructions for LLM nodes. Supports {variable} substitution."),
      static_message: z.string().nullish().describe("Fixed line spoken by a static node."),
      description: z
        .string()
        .nullish()
        .describe("For router nodes with intent edges: the classification objective shown to the routing LLM."),
      repeat_after_silence_seconds: z
        .number()
        .nullish()
        .describe("Replays this node after this many seconds of user silence and increments _silence_repeats."),
      rag_config: z.record(z.any()).nullish().describe("Per-node knowledge base, active only while on this node."),
      edges: z.array(edgeSchema()).nullish().describe("Outgoing transitions. Empty or omitted means a terminal node."),
    })
    .passthrough();
}

function graphSchema() {
  return z
    .object({
      current_node_id: z.string().min(1).describe("ID of the starting node."),
      nodes: z.array(nodeSchema()).min(1, "a graph needs at least one node"),
      agent_information: z
        .string()
        .optional()
        .describe("Global prompt prepended to every node (persona, language, guardrails). Sent on every LLM call, so keep it tight."),
      routing_instructions: z
        .string()
        .optional()
        .describe("Prompt for the routing LLM. Supports {variable} from context_data."),
      model: z.string().optional().describe("Response LLM. Default gpt-4.1-mini."),
      provider: z.string().optional().describe('LLM provider. Default "openai".'),
      max_tokens: z.number().int().optional(),
      temperature: z.number().optional(),
      routing_model: z.string().optional().describe("Routing LLM. Default gpt-4.1-mini."),
      routing_max_tokens: z.number().int().optional(),
      routing_reasoning_effort: z.enum(["minimal", "low", "medium", "high"]).optional().describe("GPT-5 routing models only."),
      variable_types: z
        .record(z.string())
        .optional()
        .describe('Type hints for expression variables, e.g. {"recipient_data.current_hour": "number"}.'),
    })
    .passthrough();
}

type Graph = z.infer<ReturnType<typeof graphSchema>>;
type GraphNode = Graph["nodes"][number];

interface ValidationIssue {
  code: string;
  message: string;
  node_id?: string;
  edge_index?: number;
}

/** The editor's documented validation rules (docs/graph-agent/validation). */
export function validateGraph(
  graph: { current_node_id?: unknown; nodes?: unknown },
  toolNames?: Set<string>
): { valid: boolean; errors: ValidationIssue[]; warnings: ValidationIssue[] } {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const nodes = (Array.isArray(graph.nodes) ? graph.nodes : []) as GraphNode[];

  if (nodes.length === 0) {
    errors.push({ code: "no_nodes", message: "The graph has no nodes." });
    return { valid: false, errors, warnings };
  }

  const ids = new Set<string>();
  for (const node of nodes) {
    if (!node.id) {
      errors.push({ code: "missing_node_id", message: "A node has no id." });
      continue;
    }
    if (ids.has(node.id)) {
      errors.push({ code: "duplicate_node_id", message: `Node id "${node.id}" is used more than once.`, node_id: node.id });
    }
    ids.add(node.id);
  }

  const start = graph.current_node_id;
  if (typeof start !== "string" || !ids.has(start)) {
    errors.push({
      code: "no_start_node",
      message: `current_node_id ${start === undefined ? "is not set" : `"${String(start)}" doesn't match any node id`}.`,
    });
  }

  const targeted = new Set<string>();
  for (const node of nodes) {
    const nodeType = node.node_type ?? "llm";
    if (nodeType === "llm" && !node.prompt?.trim()) {
      warnings.push({ code: "empty_llm_prompt", message: `LLM node "${node.id}" has no prompt.`, node_id: node.id });
    }
    if (nodeType === "static" && !node.static_message?.trim()) {
      warnings.push({ code: "static_without_message", message: `Static node "${node.id}" has no static_message.`, node_id: node.id });
    }
    if (nodeType === "router" && (node.prompt || node.static_message)) {
      errors.push({
        code: "router_speaks",
        message: `Router node "${node.id}" sets prompt or static_message; a router never speaks.`,
        node_id: node.id,
      });
    }

    const rag = node.rag_config as Record<string, any> | undefined;
    if (rag) {
      const vectorId = rag.vector_store?.provider_config?.vector_id;
      const vectorIds = rag.vector_store?.provider_config?.vector_ids;
      if (!vectorId && !(Array.isArray(vectorIds) && vectorIds.length > 0)) {
        errors.push({ code: "kb_without_vectors", message: `Node "${node.id}" has a rag_config with no vector_id.`, node_id: node.id });
      }
    }

    if (toolNames) {
      for (const match of (node.prompt ?? "").matchAll(/(?:^|[^\w.])@([A-Za-z0-9_]+)/g)) {
        if (match[1] && !toolNames.has(match[1])) {
          errors.push({
            code: "unreachable_tool",
            message: `Node "${node.id}" references @${match[1]}, which isn't defined in the agent's api_tools.`,
            node_id: node.id,
          });
        }
      }
    }

    const edges = node.edges ?? [];
    const deterministicPriorities = new Map<number, number>();
    edges.forEach((edge, i) => {
      const at = { node_id: node.id, edge_index: i };
      targeted.add(edge.to_node_id);
      if (!ids.has(edge.to_node_id)) {
        errors.push({ code: "missing_transition_target", message: `Edge ${i} on "${node.id}" points to unknown node "${edge.to_node_id}".`, ...at });
      }
      const type = edge.condition_type ?? "llm";
      if (!(CONDITION_TYPES as readonly string[]).includes(type)) {
        errors.push({ code: "invalid_condition_type", message: `Edge ${i} on "${node.id}" has unknown condition_type "${type}".`, ...at });
      }
      if (type === "expression") {
        const conditions = edge.expression?.conditions;
        if (!Array.isArray(conditions) || conditions.length === 0) {
          errors.push({ code: "invalid_expression", message: `Expression edge ${i} on "${node.id}" has no conditions.`, ...at });
        } else {
          for (const c of conditions) {
            if (!(OPERATORS as readonly string[]).includes(c?.operator as string)) {
              errors.push({ code: "invalid_operator", message: `Edge ${i} on "${node.id}" uses unknown operator "${c?.operator}".`, ...at });
            } else if (!c.operator.endsWith("exists") && c.value === undefined) {
              errors.push({ code: "invalid_expression", message: `Edge ${i} on "${node.id}": condition on "${c.variable}" has no value.`, ...at });
            }
          }
        }
      }
      if (type === "event" && !edge.event_name) {
        errors.push({ code: "missing_event_name", message: `Event edge ${i} on "${node.id}" has no event_name.`, ...at });
      }
      if (edge.parameters && Object.values(edge.parameters).some((t) => typeof t !== "string")) {
        errors.push({ code: "bad_transition_parameters", message: `Edge ${i} on "${node.id}": parameters must be {name: type} string pairs.`, ...at });
      }
      if (type === "llm" && edges.length > 1 && !edge.condition?.trim() && !edge.function_description?.trim()) {
        warnings.push({ code: "empty_intent_condition", message: `Intent edge ${i} on "${node.id}" has no condition text.`, ...at });
      }
      if (type === "expression" || type === "unconditional") {
        const p = edge.priority ?? 0;
        deterministicPriorities.set(p, (deterministicPriorities.get(p) ?? 0) + 1);
      }
    });
    for (const [p, count] of deterministicPriorities) {
      if (count > 1) {
        warnings.push({
          code: "duplicate_transition_priorities",
          message: `${count} rule/always edges on "${node.id}" share priority ${p}; set distinct priorities.`,
          node_id: node.id,
        });
      }
    }
  }

  for (const node of nodes) {
    if (node.id && node.id !== start && !targeted.has(node.id)) {
      warnings.push({ code: "unreachable_node", message: `Node "${node.id}" isn't the start node and no edge points to it.`, node_id: node.id });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

function apiToolNames(apiTools: unknown): Set<string> | undefined {
  const tools = (apiTools as { tools?: unknown } | undefined)?.tools;
  if (!Array.isArray(tools)) return undefined;
  return new Set(tools.map((t) => (t as { name?: string }).name).filter((n): n is string => !!n));
}

/** Index of the task whose llm_agent is a graph agent, or -1. */
function findGraphTaskIndex(agent: any): number {
  const tasks: any[] = Array.isArray(agent?.tasks) ? agent.tasks : [];
  return tasks.findIndex((t) => t?.tools_config?.llm_agent?.agent_type === "graph_agent");
}

function invalidGraphResult(report: ReturnType<typeof validateGraph>) {
  return errorText(
    "The graph failed validation, so nothing was sent to Bolna. Fix these and retry:\n" +
      JSON.stringify(report, null, 2)
  );
}

// Fields GET /v2/agent/{id} returns that aren't part of AgentConfigV2, so
// they're dropped before the full config is PUT back.
const READ_ONLY_AGENT_FIELDS = ["id", "agent_status", "created_at", "updated_at", "agent_prompts"];

export function registerGraphAgentsTools(server: McpServer) {
  server.registerTool(
    "validate_graph_agent",
    {
      title: "Validate graph agent",
      description:
        "Checks a graph-agent graph (nodes, edges, current_node_id) against the same rules as Bolna's graph editor without saving anything: missing or duplicate node IDs, a missing start node, edges to unknown nodes, malformed expression edges and operators, event edges without an event_name, knowledge bases without vectors, and @tool references not in api_tools. Errors block saving; warnings (unreachable nodes, empty prompts, duplicate rule priorities) don't. Pass either `graph` or an `agent_id` to validate a saved agent.",
      inputSchema: {
        graph: graphSchema().optional().describe("The graph to check. Omit to validate a saved agent by agent_id."),
        agent_id: agentIdSchema.optional(),
        api_tools: z
          .record(z.any())
          .optional()
          .describe("The agent's tools_config.api_tools, used to check @tool references in node prompts."),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Validate graph agent", readOnlyHint: true, openWorldHint: true },
    },
    async ({ graph, agent_id, api_tools, api_key }, extra) => {
      if (graph) return jsonResult(validateGraph(graph, apiToolNames(api_tools)));
      if (!agent_id) return errorText("Provide either graph or agent_id.");
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const agent: any = await bolnaFetch(`/v2/agent/${encodeURIComponent(agent_id)}`, apiKey);
        const i = findGraphTaskIndex(agent);
        if (i < 0) return errorText(`Agent ${agent_id} is not a graph agent (no task has llm_agent.agent_type "graph_agent").`);
        const tools = agent.tasks[i].tools_config;
        return jsonResult(validateGraph(tools.llm_agent.llm_config ?? {}, apiToolNames(tools.api_tools)));
      } catch (err) {
        return toErrorResult(err, { agentId: agent_id });
      }
    }
  );

  server.registerTool(
    "get_graph_agent",
    {
      title: "Get graph agent",
      description:
        "Retrieves a graph agent's graph: start node, every node with its prompt or static message and outgoing edges, routing instructions and models, plus the agent's api_tools and a validation report. Use this before update_graph_agent. Fails if the agent isn't a graph agent; use get_agent for the full raw config.",
      inputSchema: { agent_id: agentIdSchema, api_key: apiKeyOverrideSchema() },
      annotations: { title: "Get graph agent", readOnlyHint: true, openWorldHint: true },
    },
    async ({ agent_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const agent: any = await bolnaFetch(`/v2/agent/${encodeURIComponent(agent_id)}`, apiKey);
        const i = findGraphTaskIndex(agent);
        if (i < 0) return errorText(`Agent ${agent_id} is not a graph agent (no task has llm_agent.agent_type "graph_agent").`);
        const tools = agent.tasks[i].tools_config;
        const graph = tools.llm_agent.llm_config ?? {};
        return jsonResult({
          agent_id: agent.id ?? agent_id,
          agent_name: agent.agent_name,
          agent_welcome_message: agent.agent_welcome_message,
          task_index: i,
          graph,
          api_tools: tools.api_tools,
          validation: validateGraph(graph, apiToolNames(tools.api_tools)),
        });
      } catch (err) {
        return toErrorResult(err, { agentId: agent_id });
      }
    }
  );

  server.registerTool(
    "create_graph_agent",
    {
      title: "Create graph agent",
      description:
        "Creates a Bolna graph agent: a node-based voice flow where each node is one conversation step (LLM, static cached audio, or silent router) and edges route between them by intent, expression rules on context variables, unconditional fallthrough, or injected events. The graph is validated first and nothing is created if it has errors. Transcriber, voice, and telephony default to Deepgram nova-3, ElevenLabs turbo v2.5, and Plivo; override with the optional config fields. Returns the new agent's ID. Invoke the design_graph_agent prompt for design methodology.",
      inputSchema: {
        agent_name: z.string().min(1, "agent_name must not be empty"),
        agent_welcome_message: z.string().optional().describe("First line the agent says when the call connects."),
        graph: graphSchema(),
        webhook_url: z.string().url().optional(),
        telephony_provider: z
          .enum(["twilio", "plivo", "exotel", "vobiz", "sip-trunk", "trunk"])
          .optional()
          .default("plivo"),
        language: z.string().optional().default("en").describe("Transcriber language code, e.g. en, hi."),
        transcriber: z.record(z.any()).optional().describe("Full transcriber config; replaces the Deepgram default."),
        synthesizer: z.record(z.any()).optional().describe("Full synthesizer config; replaces the ElevenLabs default."),
        api_tools: z
          .record(z.any())
          .optional()
          .describe("Function tools as tools_config.api_tools ({tools, tools_params}). Scope a tool to nodes with tools_params.<name>.scope: \"node\" and nodes: [...]."),
        task_config: z.record(z.any()).optional().describe("Call timing settings, e.g. hangup_after_silence, call_terminate."),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Create graph agent", readOnlyHint: false, destructiveHint: false },
    },
    async (args, extra) => {
      const report = validateGraph(args.graph, apiToolNames(args.api_tools));
      if (!report.valid) return invalidGraphResult(report);

      const apiKey = getApiKey(extra as any, args.api_key);
      const telephony = args.telephony_provider;
      const audioFormat = TELEPHONY_AUDIO_FORMATS[telephony];
      const llm_config = {
        provider: "openai",
        model: "gpt-4.1-mini",
        max_tokens: 200,
        temperature: 0.2,
        routing_model: "gpt-4.1-mini",
        routing_max_tokens: 250,
        ...args.graph,
      };
      const agent_config: Record<string, unknown> = {
        agent_name: args.agent_name,
        agent_type: "other",
        agent_welcome_message: args.agent_welcome_message,
        webhook_url: args.webhook_url,
        tasks: [
          {
            task_type: "conversation",
            toolchain: { execution: "parallel", pipelines: [["transcriber", "llm", "synthesizer"]] },
            task_config: { hangup_after_silence: 10, call_terminate: 600, ...args.task_config },
            tools_config: {
              input: { format: audioFormat, provider: telephony },
              output: { format: audioFormat, provider: telephony },
              llm_agent: { agent_type: "graph_agent", agent_flow_type: "streaming", llm_config },
              transcriber: args.transcriber ?? {
                provider: "deepgram",
                model: "nova-3",
                language: args.language,
                stream: true,
                encoding: "linear16",
                sampling_rate: 16000,
                endpointing: 250,
              },
              synthesizer: args.synthesizer ?? {
                provider: "elevenlabs",
                stream: true,
                buffer_size: 250,
                audio_format: "wav",
                provider_config: { model: "eleven_turbo_v2_5", voice: "Nila", voice_id: "V9LCAAi4tTlqe9JadbCo" },
              },
              ...(args.api_tools ? { api_tools: args.api_tools } : {}),
            },
          },
        ],
      };
      try {
        // A graph agent's instructions live on its nodes; the task prompt is
        // required by the API but unused, so it's sent empty.
        const result = await bolnaFetch("/v2/agent", apiKey, {
          method: "POST",
          body: { agent_config, agent_prompts: { task_1: { system_prompt: "" } }, creation_source: "mcp" },
        });
        return jsonResult({ ...(result as object), validation_warnings: report.warnings });
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "update_graph_agent",
    {
      title: "Update graph agent",
      description:
        "Updates a live graph agent's graph. Pass `graph` to replace it wholesale, or any of `nodes` (replaces the whole node list), `upsert_nodes` (add or replace nodes by id), `remove_node_ids`, and routing fields to edit it in place. The result is validated before saving and nothing is changed if it has errors. Other agent settings (voice, transcriber, telephony) are kept. Call get_graph_agent first to see the current graph.",
      inputSchema: {
        agent_id: agentIdSchema,
        graph: graphSchema().optional().describe("Full replacement graph. Mutually exclusive with the edit fields below."),
        current_node_id: z.string().optional(),
        nodes: z.array(nodeSchema()).optional().describe("Replaces the full node list."),
        upsert_nodes: z.array(nodeSchema()).optional().describe("Nodes to add, or to replace where the id already exists."),
        remove_node_ids: z.array(z.string()).optional(),
        settings: z
          .record(z.any())
          .optional()
          .describe("Other llm_config fields to set, e.g. agent_information, routing_instructions, model, routing_model, temperature."),
        api_tools: z.record(z.any()).optional().describe("Replaces tools_config.api_tools."),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Update graph agent", readOnlyHint: false, destructiveHint: true },
    },
    async (args, extra) => {
      const { agent_id, graph, current_node_id, nodes, upsert_nodes, remove_node_ids, settings, api_tools } = args;
      const edits = [current_node_id, nodes, upsert_nodes, remove_node_ids, settings, api_tools];
      if (!graph && edits.every((e) => e === undefined)) {
        return errorText("Provide graph, or at least one of current_node_id, nodes, upsert_nodes, remove_node_ids, settings, api_tools.");
      }
      if (graph && (nodes || upsert_nodes || remove_node_ids)) {
        return errorText("Pass either graph (full replacement) or node edits, not both.");
      }

      const apiKey = getApiKey(extra as any, args.api_key);
      try {
        const agent: any = await bolnaFetch(`/v2/agent/${encodeURIComponent(agent_id)}`, apiKey);
        const i = findGraphTaskIndex(agent);
        if (i < 0) return errorText(`Agent ${agent_id} is not a graph agent (no task has llm_agent.agent_type "graph_agent").`);

        const tools = agent.tasks[i].tools_config;
        let llmConfig: Record<string, any> = graph
          ? { ...tools.llm_agent.llm_config, ...graph }
          : { ...tools.llm_agent.llm_config };
        if (nodes) llmConfig.nodes = nodes;
        if (upsert_nodes || remove_node_ids) {
          const removed = new Set(remove_node_ids ?? []);
          const next: GraphNode[] = (llmConfig.nodes ?? []).filter((n: GraphNode) => !removed.has(n.id));
          for (const node of upsert_nodes ?? []) {
            const at = next.findIndex((n) => n.id === node.id);
            if (at >= 0) next[at] = node;
            else next.push(node);
          }
          llmConfig.nodes = next;
        }
        if (settings) llmConfig = { ...llmConfig, ...settings };
        if (current_node_id) llmConfig.current_node_id = current_node_id;
        if (api_tools) tools.api_tools = api_tools;

        const report = validateGraph(llmConfig, apiToolNames(tools.api_tools));
        if (!report.valid) return invalidGraphResult(report);
        tools.llm_agent.llm_config = llmConfig;

        // PATCH only covers name/welcome/webhook/synthesizer/telephony, so a
        // graph change is a full PUT of the fetched config with the graph swapped.
        const agent_config = { ...agent };
        for (const field of READ_ONLY_AGENT_FIELDS) delete agent_config[field];
        const agent_prompts =
          agent.agent_prompts && Object.keys(agent.agent_prompts).length > 0
            ? agent.agent_prompts
            : { task_1: { system_prompt: "" } };

        const result = await bolnaFetch(`/v2/agent/${encodeURIComponent(agent_id)}`, apiKey, {
          method: "PUT",
          body: { agent_config, agent_prompts },
        });
        return jsonResult({ ...(result as object), validation_warnings: report.warnings });
      } catch (err) {
        return toErrorResult(err, { agentId: agent_id });
      }
    }
  );

  server.registerTool(
    "send_graph_agent_event",
    {
      title: "Send event to live graph agent call",
      description:
        "Pushes a named event into a live graph-agent call, e.g. payment_completed or link_opened. If the node the call is currently on has an event edge with a matching event_name, the agent transitions and speaks proactively without waiting for the caller. `properties` are merged into the call's context_data either way, so later nodes can use them as {variable} substitutions and in expression edges. Fire-and-forget: returns 202 accepted once queued, or 404 if the call has already ended.",
      inputSchema: {
        run_id: z
          .string()
          .min(1, "run_id is required")
          .describe("The live call's ID: execution_id from start_outbound_call, or the run ID from the inbound webhook."),
        event: z.string().min(1, "event is required").describe("Event name; must match an edge's event_name exactly."),
        properties: z.record(z.any()).optional().describe("Data merged into the call's context_data."),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Send event to live graph agent call", readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ run_id, event, properties, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(`/v1/call/${encodeURIComponent(run_id)}/events`, apiKey, {
          method: "POST",
          body: { event, properties: properties ?? {} },
        });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err, { executionId: run_id });
      }
    }
  );
}
