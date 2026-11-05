import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Condensed from the migrate-call-to-workflow Agent Skill (github.com/bolna-ai/skills).
const METHODOLOGY = `You are moving an existing Bolna /call integration onto a Bolna workflow. The end state: the user's code calls \`POST /workflows/{workflow_id}/run\` instead of \`POST /call\` for the migrated flow, retry / re-dial / scheduling / agent-choosing logic moves out of their code into the workflow, and their existing call webhook handler keeps working unchanged.

## Rules

\`publish_workflow\` and \`run_workflow\` act on the live account, and a run places a real, billed call: ask before each. The first test run dials a number the user owns, never a customer's. Don't edit or create agents unless asked; only create the workflow. The old /call path stays behind a flag until the user confirms the workflow works in production.

## 1. Inventory

If you can read the user's codebase, read every place that calls /call. Otherwise ask them to paste that code. Record: the \`agent_id\` values and how the code picks one; every \`user_data\` key; \`from_phone_number\` (constant, per call, or absent); \`scheduled_at\`; \`retry_config\` or re-dial logic in the code (statuses, intervals, attempt count); \`agent_data\` or \`bypass_call_guardrails\`; how results are read (agent webhook or polling \`GET /executions/{id}\`); what is stored from the /call response. Confirm the real keys sent today with \`list_agent_executions\` and \`get_execution\` (\`context_details.recipient_data\`) on two or three recent calls. Show the inventory as a table and confirm it before building.

Stop and tell the user the flow can't move yet if it uses \`agent_data\` (voice_id / language override), \`bypass_call_guardrails\`, a different \`from_phone_number\` per call, or more than 50 \`user_data\` keys.

## 2. Mapping

- \`agent_id\` → agent node \`config.agent_id\`. Picking the agent by a variable → start-node cases on \`entry.<variable>\`, one agent node per agent.
- \`recipient_phone_number\` → \`mobile_number\` on the run (the agent node dials \`entry.mobile_number\` by default).
- \`user_data.<key>\` → a start field \`{"name": "<key>", "type": "string"}\` in \`config.fields\`, plus \`config.variables.<key> = {"value": {"var": "entry.<key>"}}\` on every agent node that needs it. An agent node passes the call only its mapped variables. Read each agent with \`get_agent\`: every \`{placeholder}\` in its welcome message and prompts must be mapped.
- Constant \`from_phone_number\` → agent node \`config.from_number\`.
- \`retry_config\` or code re-dials → agent node cases on \`call.status\` routing to a \`retry\` node (\`target_node_id\` = the agent node, \`attempts\` = one \`{"delay": {...}}\` per interval, max 10); its always-case is the gave-up path. \`retry_on_voicemail\` → include \`"voicemail"\`. /call says \`no-answer\`; \`call.status\` says \`no_answer\`. All values: completed, busy, no_answer, failed, voicemail, cancelled, rejected, timeout, error.
- \`scheduled_at\` → start field of type \`timestamp\` and a \`time\` node \`{"at": {"var": "entry.scheduled_at"}}\` before the agent node.

Shape: root needs \`entry_node_id\`, \`on_no_match\` and \`nodes\`. The start node routes with \`cases\`, never \`to\`; a node that doesn't branch uses one \`{"when": {"always": true}, "then": {"to": "<next>"}}\` case. Only \`time\` takes \`to\`; \`end\` takes neither. Route every outcome, including the root \`on_no_match\`, to an \`end\` node (\`label\` becomes \`termination_reason\`, \`outcome\` is success / failure / neutral). Built-in fields needing no declaration: \`reference_id\`, \`mobile_number\`, \`name\`, \`email\`. \`list_workflow_node_types\` has every config field, default and bound.

## 3. Build, test, publish

\`create_workflow\`, then \`save_workflow_draft\` with the full definition and \`validate_workflow\`. Fix every error and every \`unmapped_agent_variable\` warning in one save. Describe the routes in plain words (who gets called, with which agent, when it retries, how it ends) and \`publish_workflow\` once the user agrees. Then, with their OK, \`run_workflow\` on their own number once per branch: \`{"reference_id": "migration-test-1", "mobile_number": "+91...", "custom_fields": {...}}\`. \`get_workflow_execution\` shows the trail; the agent node's outputs carry \`call.execution_id\`, and \`get_execution\` on it shows the call. Check its \`recipient_data\` has every key their webhook handler reads.

## 4. Code change

Keep \`user_data\` as is and send it as \`custom_fields\`:

\`\`\`
- POST https://api.bolna.ai/call
- {"agent_id": "...", "recipient_phone_number": "+91...", "user_data": {...}}
+ POST https://api.bolna.ai/workflows/<workflow_id>/run
+ {"reference_id": "<unique per run>", "mobile_number": "+91...", "custom_fields": {...}}
\`\`\`

\`WORKFLOW_ID\` goes in config next to the agent id. \`reference_id\` identifies one run: repeating it returns \`409 duplicate_run\` with the existing \`execution_id\` (safe HTTP retries); contacting the same person again for another reason needs a new value such as \`<order_id>-<purpose>\`. Always set it: an omitted one is derived from the row's content, so identical requests collide. \`name\` / \`email\` in user_data go top-level, not under \`custom_fields\`. \`422 unknown_field\` = a key not declared on the start node. The \`201\` response is \`{execution_id, campaign_id, workflow_version, status}\`: store this \`execution_id\` where the call id was stored. Turn off the code's own re-dial and scheduling for this flow behind the same flag.

## 5. Results

The agent's call webhook still fires for every call the workflow places, same payload, one per attempt. Polling moves from \`GET /executions/{id}\` to \`GET /workflow-executions/{id}\`, reading \`call.execution_id\` from the trail for a call's transcript or recording. Optionally, \`update_workflow_settings\` with \`{"webhook": {"url": "https://..."}}\` sends one POST per contact when the workflow finishes (\`execution_id\`, \`reference_id\`, \`status\`, \`outcome\`, \`termination_reason\`, \`trail\`); check it with \`test_workflow_webhook\` and join on \`reference_id\`.

Before production: every key the prompts or webhook handler read is mapped, every branch tested on the user's number, the \`reference_id\` scheme decided, the code's own re-dials off, and the old /call path kept behind a flag for rollback.`;

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
