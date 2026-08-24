import type { CSSProperties } from "react";
import { MASCOT_GRID } from "@/lib/mascot";

const TOOL_CATEGORIES: { category: string; tools: string[] }[] = [
  {
    category: "Agents",
    tools: [
      "list_agents",
      "get_agent",
      "create_agent",
      "update_agent",
      "delete_agent",
      "stop_agent_queued_calls",
    ],
  },
  {
    category: "Calls",
    tools: [
      "start_outbound_call",
      "stop_call",
      "list_agent_executions",
      "get_execution",
      "get_execution_raw_logs",
      "list_batch_executions",
    ],
  },
  {
    category: "Batches",
    tools: [
      "create_batch",
      "get_batch",
      "list_batches",
      "schedule_batch",
      "stop_batch",
      "delete_batch",
    ],
  },
  {
    category: "Dispositions",
    tools: [
      "list_dispositions",
      "get_disposition",
      "create_disposition",
      "bulk_create_dispositions",
      "update_disposition",
      "delete_disposition",
      "test_dispositions",
    ],
  },
  {
    category: "Phone Numbers",
    tools: [
      "list_phone_numbers",
      "search_phone_numbers",
      "buy_phone_number",
      "delete_phone_number",
    ],
  },
  {
    category: "Inbound",
    tools: ["setup_inbound_agent", "unlink_inbound_agent"],
  },
  {
    category: "SIP Trunks",
    tools: [
      "create_sip_trunk",
      "get_sip_trunk",
      "list_sip_trunks",
      "update_sip_trunk",
      "delete_sip_trunk",
      "add_trunk_number",
      "remove_trunk_number",
      "list_trunk_numbers",
    ],
  },
  {
    category: "Knowledge Bases",
    tools: [
      "create_knowledgebase",
      "get_knowledgebase",
      "list_knowledgebases",
      "delete_knowledgebase",
    ],
  },
  {
    category: "Providers & Voices",
    tools: ["list_providers", "remove_provider", "list_tts_providers", "list_voices"],
  },
  {
    category: "Sub-accounts",
    tools: [
      "create_sub_account",
      "list_sub_accounts",
      "update_sub_account",
      "delete_sub_account",
      "get_sub_account_usage",
      "get_all_sub_accounts_usage",
    ],
  },
  {
    category: "Violations",
    tools: ["list_violations"],
  },
  {
    category: "Workflows",
    tools: [
      "create_workflow",
      "list_workflows",
      "get_workflow",
      "rename_workflow",
      "delete_workflow",
      "get_workflow_draft",
      "save_workflow_draft",
      "validate_workflow",
      "publish_workflow",
      "get_workflow_version",
      "run_workflow",
      "list_workflow_node_types",
    ],
  },
  {
    category: "Workflow Campaigns",
    tools: [
      "create_workflow_campaign",
      "list_workflow_campaigns",
      "get_workflow_campaign",
      "delete_workflow_campaign",
      "upload_workflow_campaign_entries",
      "list_workflow_campaign_entries",
      "get_workflow_campaign_entries_template",
      "start_workflow_campaign",
      "pause_workflow_campaign",
      "resume_workflow_campaign",
      "abort_workflow_campaign",
      "list_workflow_campaign_executions",
      "get_workflow_campaign_report",
    ],
  },
  {
    category: "Workflow Executions",
    tools: ["get_workflow_execution", "cancel_workflow_execution"],
  },
  {
    category: "Account",
    tools: ["get_user_info"],
  },
  {
    category: "Docs",
    tools: ["search_docs", "get_doc"],
  },
];

const TOOL_COUNT = TOOL_CATEGORIES.reduce((sum, { tools }) => sum + tools.length, 0);

export default function Home() {
  return (
    <main>
      <h1
        style={{
          fontFamily: "monospace",
          fontSize: "1em",
          fontWeight: "bold",
          margin: 0,
        }}
      >
        Bolna MCP Server
      </h1>
      <pre>
        {MASCOT_GRID.map((row, r) => (
          <span key={r}>
            {row.map((cell, c) =>
              cell ? (
                <span key={c} style={{ color: cell[1] }}>
                  {cell[0]}
                </span>
              ) : (
                " "
              )
            )}
            {"\n"}
          </span>
        ))}
      </pre>

      <pre>
        {"Connect to: "}
        <code>https://mcp.bolna.ai/api/mcp</code>
        {"\n"}
        {"Docs:       "}
        <a
          href="https://www.bolna.ai/docs/build-with-ai/mcp"
          style={{ color: "#3F5C8C" }}
        >
          https://www.bolna.ai/docs/build-with-ai/mcp
        </a>
        {"\n"}
        {"Privacy:    "}
        <a href="/privacy" style={{ color: "#3F5C8C" }}>
          https://mcp.bolna.ai/privacy
        </a>
      </pre>

      <div style={{ marginTop: 50 }}>
        <pre>
          <strong>Setup Instructions:</strong>
          {"\n\n\n"}
          <strong>
            For most clients (Streamable HTTP) &mdash; Cursor, Windsurf, Zed,
            etc.:
          </strong>
          {"\n\n"}
          {`{
  "mcpServers": {
    "bolna": {
      "url": "https://mcp.bolna.ai/api/mcp",
      "headers": {
        "Authorization": "Bearer <BOLNA_API_KEY>"
      }
    }
  }
}`}
          {"\n\n\n"}
          <strong>For Claude Code:</strong>
          {"\n\n"}
          {`claude mcp add -s user -t http bolna https://mcp.bolna.ai/api/mcp -H "Authorization: Bearer <BOLNA_API_KEY>"`}
          {"\n\n\n"}
          <strong>For Codex CLI:</strong>
          {"\n\n"}
          {`export BOLNA_API_KEY="<BOLNA_API_KEY>"
codex mcp add bolna --url https://mcp.bolna.ai/api/mcp --bearer-token-env-var BOLNA_API_KEY`}
          {"\n\n\n"}
          <strong>Full documentation:</strong>
          {"\n\n"}
          <a href="https://www.bolna.ai/docs/build-with-ai/mcp">
            https://www.bolna.ai/docs/build-with-ai/mcp
          </a>
        </pre>
      </div>

      <div style={{ marginTop: 50 }}>
        <p style={{ fontFamily: "monospace", fontWeight: "bold", margin: "0 0 12px 0" }}>
          Tools ({TOOL_COUNT}):
        </p>
        <table
          style={{
            fontFamily: "monospace",
            fontSize: "0.9em",
            borderCollapse: "collapse",
          }}
        >
          <thead>
            <tr>
              <th style={tableHeaderStyle}>Category</th>
              <th style={tableHeaderStyle}>Tool</th>
            </tr>
          </thead>
          <tbody>
            {TOOL_CATEGORIES.flatMap(({ category, tools }) =>
              tools.map((tool, i) => (
                <tr key={tool}>
                  {i === 0 && (
                    <td rowSpan={tools.length} style={tableCellStyle}>
                      {category}
                    </td>
                  )}
                  <td style={tableCellStyle}>{tool}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}

const tableCellStyle: CSSProperties = {
  border: "1px solid #ccc",
  padding: "4px 12px",
  textAlign: "left",
  verticalAlign: "top",
};

const tableHeaderStyle: CSSProperties = {
  ...tableCellStyle,
  fontWeight: "bold",
};
