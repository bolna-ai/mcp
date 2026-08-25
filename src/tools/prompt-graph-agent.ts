import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Condensed from the bolna-graph-agents Agent Skill (github.com/bolna-ai/skills).
const METHODOLOGY = `You are designing a Bolna graph agent: a directed graph of nodes and edges for a multi-step voice conversation, set under \`agent_config.tasks[].tools_config.llm_agent\` with \`agent_type: "graph_agent"\`.

## When a graph agent fits

Distinct stages with different objectives (greet → qualify → collect → confirm → close), deterministic branches (working hours, retry counts, language), external events driving the conversation, compliance checkpoints that can't be skipped, or high-volume flows where static nodes save latency/cost. If it's "one persona, many possible topics" with no real stage structure, a plain \`simple_llm_agent\` prompt fits better — don't force a graph.

## Core concepts

- **Node** — one conversation step, \`"llm"\` (has a \`prompt\`) or \`"static"\` (has \`static_message\`, pre-rendered audio, ~50ms vs ~800ms LLM round-trip, zero cost).
- **Edge** — a transition: \`to_node_id\`, \`condition\` (routing LLM's tool description for LLM edges), \`condition_type\` (\`"llm"\` default / \`"expression"\` / \`"unconditional"\` / \`"event"\`), optional \`parameters\` ({name: type} extracted from the user's reply into \`context_data\` on transition), \`priority\` (lower fires first; default 0 deterministic / 100 LLM).
- **Deterministic-first routing**: on every user turn, expression/unconditional/event edges are checked, in priority order, before the routing LLM runs. First match wins, sub-millisecond, free. Only if none match does the routing LLM evaluate the LLM edges' \`condition\` strings; if none of those match either, the agent stays on the current node and still responds (not silently) — it just re-asks naturally.
- **Silence repeat** — a node's \`repeat_after_silence_seconds\` auto-replays it and increments \`_silence_repeats\`, letting an expression edge escalate (e.g. transfer after 3 silent rounds).
- **Event injection** — \`POST /v1/call/{run_id}/events\` with \`{"event": "<name>", "properties": {...}}\` pushes a named event into a live call; a matching \`event\` edge on the *current* node transitions and triggers proactive speech. \`properties\` merge into \`context_data\` and become \`{key}\` substitutions downstream. \`run_id\` comes from \`POST /call\`'s response or the inbound webhook.
- **Per-node RAG** — a node's \`rag_config\` retrieves from a vector store only while the conversation is on that node.

## Top-level \`llm_agent\` fields

\`agent_type\` ("graph_agent") · \`agent_information\` (global system prompt prepended to every node — keep tight, it's sent on every LLM call) · \`routing_instructions\` (prompt for the routing LLM; supports \`{variable}\` from \`context_data\`, missing keys render \`NULL\`) · \`current_node_id\` (starting node) · \`nodes[]\` · \`model\` (response LLM, default gpt-4.1-mini) · \`routing_model\` (default gpt-4.1-mini) · \`routing_max_tokens\` (default 250, or 150 for GPT-5) · \`routing_reasoning_effort\` (GPT-5 only: minimal/low/medium/high).

## Expression edges

\`\`\`json
{
  "to_node_id": "after_hours",
  "condition_type": "expression",
  "condition": "Outside working hours",
  "priority": 0,
  "expression": {
    "logic": "or",
    "conditions": [
      { "variable": "recipient_data.current_hour", "operator": "lt", "value": 10 },
      { "variable": "recipient_data.current_hour", "operator": "gte", "value": 18 }
    ]
  }
}
\`\`\`
\`logic\`: \`"and"\` (default, all match) or \`"or"\` (any). Operators: equality \`eq\`/\`neq\`, numeric \`gt\`/\`gte\`/\`lt\`/\`lte\`, text \`contains\`, list \`in\`/\`not_in\`, existence \`exists\`/\`not_exists\`. Give mutually-exclusive deterministic rules distinct priorities rather than relying on declaration order.

Built-in variables (auto-populated, usable in any \`{variable}\` substitution or expression): \`recipient_data.current_hour/_minute/_weekday/_day/_month/_year\` (numeric/lowercase-string; **only populate when \`recipient_data.timezone\` is set on the call — the #1 graph-agent gotcha**, always pass \`timezone\` in \`POST /call\`'s \`user_data\`), \`recipient_data.timezone\`, \`recipient_data.user_number\` (E.164), \`detected_language\` (top-level, e.g. \`"hindi"\`), \`_node_turns\` (resets on transition), \`_total_turns\`, \`_silence_repeats\` (resets on transition). \`current_date\`/\`current_time\` are display-only, not for comparisons.

Prefer an edge's \`parameters\` over a separate "extract" node — one LLM call routes and captures data. By default an LLM edge becomes a routing tool named \`transition_to_<to_node_id>\`; override with \`function_name\`/\`function_description\` when two edges share a target or the auto-name confuses the routing LLM.

## Worked pattern: appointment booking

Static \`welcome\` node (50ms first words) with an LLM edge to \`collect_slot\` and an expression edge on \`_silence_repeats >= 3\` to \`goodbye\`. \`collect_slot\` is an LLM node whose \`prompt\` asks for day+time and whose edge captures both via \`parameters: {"appointment_day": "string", "appointment_time": "string"}\`, plus a same-node expression edge (\`priority: 0\`) to \`after_hours\` checking \`recipient_data.current_hour\` bounds — so after-hours always wins even if the user gave a valid-sounding time. \`confirm\` echoes the slot back and branches to \`booked\` (confirmed) or back to \`collect_slot\` (wants to change). \`booked\`, \`after_hours\`, and \`goodbye\` are static closing nodes — no LLM cost on the exit legs.

## Event-driven nodes

\`\`\`json
{
  "id": "awaiting_payment",
  "prompt": "Reassure the user while payment processes. Amount: {currency} {amount}.",
  "edges": [
    { "to_node_id": "confirmation", "condition_type": "event", "event_name": "payment_completed" },
    { "to_node_id": "payment_failed", "condition_type": "event", "event_name": "payment_failed" }
  ]
}
\`\`\`
Fired from the backend: \`POST /v1/call/{run_id}/events\` with \`{"event": "payment_completed", "properties": {"ref": "TXN-98765"}}\`. Always give event nodes a non-event fallback too (a timeout via \`_node_turns\` or \`_silence_repeats\`) in case the event never arrives.

## Debugging

Every routing decision logs one line:
\`\`\`
Routing decision (LLM): transition_to_offer_pitch | confidence: 0.95 | reasoning: Customer confirmed identity by saying 'yeah'. (latency: 210ms)
Routing decision (deterministic): -> after_hours | deterministic:expression:Outside working hours (latency: 0.6ms)
\`\`\`
\`reasoning\` is the most useful field — when a transition is wrong, it explains why. Quick symptom map:
- **Keeps re-asking instead of advancing** → routing returned \`stay_on_current_node\`; the \`condition\` is too narrow/missing vocabulary, or the reply genuinely doesn't match any edge (add a fallback edge).
- **Routes to the wrong node** → two conditions overlap; make them mutually exclusive, or move the deterministic case to an expression edge with \`priority: 0\`.
- **Confidence consistently low** → conditions describe too-similar intents; move data-driven branches into expression edges instead.
- **Skips a node unexpectedly** → an overly broad expression edge on the previous node fired early (e.g. \`_node_turns >= 1\` matches turn two regardless of content).
- **Time-based expression never fires** → \`recipient_data.timezone\` wasn't set on the call.
- **Long calls lose earlier context** → the response LLM only sees the last ~50 messages; persist critical state into \`context_data\` via \`parameters\`/event \`properties\` instead of relying on transcript recall.
- **Event fires but agent stays silent** → check in order: call already ended (expect 404, not 202), event name doesn't match an edge on the *currently active* node (event edges only fire on the active node), user was mid-speech when the event resolved (next turn routes normally), or no event edge exists for that name.

## Quality checklist before going live

Every node has an exit edge or is explicitly terminal · every external API call has a spoken fallback on failure · static nodes don't contain dynamic facts unless safely templated · compliance lines can't be skipped by routing · time-based expressions are backed by a \`timezone\`-set guarantee · event edges have a non-event fallback · outcomes map to a disposition or \`context_data\` field for analytics.

Produce the finished design as the full \`llm_agent\` JSON (or the specific nodes/edges asked for), matching this schema and style exactly — don't invent fields not covered above.`;

export function registerGraphAgentPrompt(server: McpServer) {
  server.registerPrompt(
    "design_graph_agent",
    {
      title: "Design a Bolna graph agent",
      description:
        "Generates a Bolna graph-agent config (nodes, edges, routing) from a use-case brief — node/edge schema, deterministic-first routing order, expression-edge operators and built-in variables, event injection, and a routing-log symptom-to-fix table for debugging. Pass `brief` describing the desired multi-step flow; omit it for the methodology plus a short brief-gathering flow.",
      argsSchema: { brief: z.string().optional() },
    },
    async ({ brief }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: brief
              ? `${METHODOLOGY}\n\n---\n\nDesign a graph agent for this use case: ${brief}`
              : `${METHODOLOGY}\n\n---\n\nNo specific brief was given yet. Ask, in one shot, for whichever of these would actually change the output — the stages/objectives the call moves through, which transitions are deterministic (hours, retries, language) vs intent-driven, any external events (payment, form submission) the flow reacts to, and compliance lines that can't be skipped — then produce the design regardless of what comes back.`,
          },
        },
      ],
    })
  );
}
