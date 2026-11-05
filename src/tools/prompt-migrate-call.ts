import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Condensed from the migrate-call-to-workflow Agent Skill (github.com/bolna-ai/skills).
const METHODOLOGY = `You are moving an existing Bolna /call integration onto a Bolna workflow. The end state: the user's code calls \`POST /workflows/{workflow_id}/run\` instead of \`POST /call\` for the migrated flow, retry / re-dial / scheduling / agent-choosing logic moves out of their code into the workflow, and their existing call webhook handler keeps working unchanged.

## Rules

\`publish_workflow\` and \`run_workflow\` act on the live account, and a run places a real, billed call: ask before each. The first test run dials a number the user owns, never a customer's. Don't edit or create agents unless asked; only create the workflow. The old /call path stays behind a flag until the user confirms the workflow works in production.

## 1. Inventory

If you can read the user's codebase, read every place that calls /call. Otherwise ask them to paste that code. Record: the \`agent_id\` values and how the code picks one, including a picking value that isn't in \`user_data\`; every \`user_data\` key; \`from_phone_number\` (constant, per call, or absent); \`scheduled_at\`; \`retry_config\` or re-dial logic in the code (statuses, intervals, number of calls); \`agent_data\` or \`bypass_call_guardrails\`; how results are read (agent webhook or polling \`GET /executions/{id}\`) and every \`recipient_data\` key that code reads; what the calling function returns or stores, and whether it blocks until the call ends. Confirm the real keys sent today with \`list_agent_executions\` and \`get_execution\` (\`context_details.recipient_data\`) on two or three recent calls; if the agent has no calls yet, the code is the source. Show the inventory as a table and confirm it before building.

Stop and tell the user the flow can't move yet if it uses \`agent_data\` (voice_id / language override), \`bypass_call_guardrails\`, a different \`from_phone_number\` per call, or more than 50 \`user_data\` keys.

## 2. Mapping

- \`agent_id\` → agent node \`config.agent_id\`. Picking the agent by a variable → start-node cases on \`entry.<variable>\`, one agent node per agent; a picking value that isn't in \`user_data\` becomes a start field of its own.
- \`recipient_phone_number\` → \`mobile_number\` on the run (the agent node dials \`entry.mobile_number\` by default).
- \`user_data.<key>\` → a start field \`{"name": "<key>", "type": "string"}\` in \`config.fields\`, plus \`config.variables.<key> = {"value": {"var": "entry.<key>"}}\` on **every** agent node, not only those whose prompt uses it: an agent node passes the call only its mapped variables, so the call's \`recipient_data\` (and its webhook payload) holds only mapped keys. A key whose value is an object or array is declared \`"type": "json"\` instead: a \`string\` field rejects it with a 422 on the run, and the agent receives a \`json\` value as a JSON string. Field types: string, number, boolean, timestamp, phone, email, url, json, timezone. Placeholders (\`{name}\` or \`{{name}}\`, in welcome message, prompts, and graph node prompts and edges) are listed authoritatively by \`validate_workflow\`'s \`unmapped_agent_variable\` warnings, which skip the ones Bolna fills itself (date, time, timezone). A placeholder the code doesn't send today is an existing gap: tell the user rather than invent a value; leaving it unmapped behaves exactly like a /call request that omits the key.
- Constant \`from_phone_number\` → agent node \`config.from_number\`.
- \`retry_config\` or code re-dials → agent node cases on \`call.status\` routing to a \`retry\` node (\`target_node_id\` = the agent node, \`attempts\` = one \`{"delay": {...}}\` per re-dial, max 10: three calls in total is two attempts). When the attempts run out the retry node's own cases run, so route them to the gave-up \`end\` node. \`retry_on_voicemail\` → include \`"voicemail"\`. /call says \`no-answer\`; \`call.status\` says \`no_answer\`. All values: completed, busy, no_answer, failed, voicemail, cancelled, rejected, timeout, error.
- \`scheduled_at\` → start field of type \`timestamp\` and a \`time\` node \`{"at": {"var": "entry.scheduled_at"}}\` before the agent node.

Shape: root needs \`entry_node_id\`, \`on_no_match\` and \`nodes\`. The start node routes with \`cases\`, never \`to\`; a node that doesn't branch uses one \`{"when": {"always": true}, "then": {"to": "<next>"}}\` case. Only \`time\` takes \`to\`; \`end\` takes neither. Route every outcome, including the root \`on_no_match\`, to an \`end\` node (\`label\` becomes \`termination_reason\`, \`outcome\` is success / failure / neutral). Built-in fields needing no declaration: \`reference_id\`, \`mobile_number\`, \`name\`, \`email\` (declare one only to add \`"required": true\`). \`list_workflow_node_types\` has every config field, default and bound.

## 3. Build, test, publish

\`create_workflow\`, then \`get_workflow_draft\` for the draft's \`revision\`, then \`save_workflow_draft\` with that as \`expected_revision\` and the full definition, then \`validate_workflow\`. Each save returns the next revision; a 409 \`revision_conflict\` carries \`current_revision\` to retry with. Fix every error in one save, and clear each \`unmapped_agent_variable\` warning by mapping a key the code sends or by confirming with the user it isn't sent today. Describe the routes in plain words (who gets called, with which agent, when it retries, how it ends) and \`publish_workflow\` once the user agrees; it returns the new \`version\` and any \`warnings\`. Publishing consumes the draft, so \`get_workflow_draft\` returns 404 until the next save; to change a published workflow, save with \`expected_revision: 0\` (a new draft seeded from the published version) and publish again. Runs use the latest published version. Then, with their OK, \`run_workflow\` on their own number once per branch: \`{"reference_id": "migration-test-1", "mobile_number": "+91...", "custom_fields": {...}}\`. \`get_workflow_execution\` lists the node attempts in \`nodes\`; an agent node's \`outputs\` carry \`call.execution_id\`, and \`get_execution\` on it shows the call. Check its \`recipient_data\` has every key their webhook handler reads.

## 4. Code change

Keep \`user_data\` as is and send it as \`custom_fields\`, plus the agent-picking value if it isn't already in \`user_data\`:

\`\`\`
- POST https://api.bolna.ai/call
- {"agent_id": "...", "recipient_phone_number": "+91...", "user_data": {...}}
+ POST https://api.bolna.ai/workflows/<workflow_id>/run
+ {"reference_id": "<unique per run>", "mobile_number": "+91...", "custom_fields": {...}}
\`\`\`

\`WORKFLOW_ID\` goes in config next to the agent id. \`reference_id\` identifies one run of one published version: build it from ids the user's system already has, such as \`<order_id>-<purpose>\`, and if the calling function has none, add a parameter and ask the user what to pass. Repeating it returns 409 \`{"detail": {"code": "duplicate_run", "execution_id": "..."}}\`: treat that as success and use the id (safe HTTP retries). Contacting the same person again for another reason needs a new value. Always set it: an omitted one is derived from the row's content, so identical requests collide. \`name\` / \`email\` in user_data go top-level, not under \`custom_fields\`. \`422 unknown_field\` = a key not declared on the start node. The \`201\` response is \`{execution_id, campaign_id, workflow_version, status}\`, returned as soon as the execution is created: store this \`execution_id\` where the call id was stored. A function that used to block until a call ended (polling and re-dialing) now returns this id, and the outcome arrives through the results below; that changes what its callers get back, so tell the user. Turn off the code's own re-dial and scheduling for this flow behind the same flag.

## 5. Results

The agent's call webhook still fires for every call the workflow places, same payload, one per attempt. Polling moves from \`GET /executions/{id}\` to \`GET /workflow-executions/{id}\`: \`status\` is \`pending\` or \`running\` while in progress, then \`completed\`, \`failed\`, \`cancelled\` or \`aborted\`; \`completed\` means an \`end\` node was reached, so read \`outcome\` (success / failure / neutral) and \`termination_reason\` (the end node's label). For a call's transcript or recording, read \`call.execution_id\` from the agent node's \`outputs\` in \`nodes\`. Optionally, \`update_workflow_settings\` with \`{"webhook": {"url": "https://..."}}\` sends one POST per contact when the workflow finishes (\`execution_id\`, \`reference_id\`, \`status\`, \`outcome\`, \`termination_reason\`, \`trail\`); check it with \`test_workflow_webhook\` and join on \`reference_id\`.

Before production: every \`user_data\` key is mapped on every agent node (any \`unmapped_agent_variable\` left is one the user confirmed isn't sent today), every branch tested on the user's number, the \`reference_id\` scheme decided, the code's own re-dials off, and the old /call path kept behind a flag for rollback.`;

export function registerMigrateCallPrompt(server: McpServer) {
  server.registerPrompt(
    "migrate_call_to_workflow",
    {
      title: "Migrate a /call integration to a workflow",
      description:
        "Moves an existing Bolna /call integration onto a workflow: inventories how the code calls /call, maps agent choice, user_data, retries and scheduling onto workflow nodes, builds and validates the workflow, tests it on the user's own number, and rewrites the call site to the run endpoint while the call webhook keeps working. Pass `agent_id` for the agent whose /call flow should move; omit it to be asked.",
      argsSchema: { agent_id: z.string().optional() },
    },
    async ({ agent_id }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: agent_id
              ? `${METHODOLOGY}\n\n---\n\nMigrate the /call integration for agent ${agent_id}.`
              : `${METHODOLOGY}\n\n---\n\nNo agent was named yet. Ask which agent's /call flow to migrate (offer list_agents if they don't know the id), then start with the inventory.`,
          },
        },
      ],
    })
  );
}
