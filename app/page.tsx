import { MASCOT_GRID } from "@/lib/mascot";

export default function Home() {
  return (
    <main>
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
        <a href="https://github.com/bolna-ai/mcp" style={{ color: "#3F5C8C" }}>
          https://github.com/bolna-ai/mcp
        </a>
      </pre>

      <div style={{ marginTop: 50 }}>
        <pre>
          <strong>Setup Instructions:</strong>
          {"\n\n"}
          <strong>
            For most clients (Streamable HTTP) &mdash; Cursor, Windsurf, Zed,
            etc.:
          </strong>
          {`
{
  "mcpServers": {
    "bolna": {
      "url": "https://mcp.bolna.ai/api/mcp",
      "headers": {
        "Authorization": "Bearer <BOLNA_API_KEY>"
      }
    }
  }
}
`}
          <strong>For Claude Code:</strong>
          {`
claude mcp add -s user -t http bolna https://mcp.bolna.ai/api/mcp -H "Authorization: Bearer <BOLNA_API_KEY>"
`}
          <strong>For Codex CLI:</strong>
          {`
export BOLNA_API_KEY="<BOLNA_API_KEY>"
codex mcp add bolna --url https://mcp.bolna.ai/api/mcp --bearer-token-env-var BOLNA_API_KEY
`}
          <strong>Full documentation:</strong>
          {"\n"}
          <a href="https://github.com/bolna-ai/mcp">
            https://github.com/bolna-ai/mcp
          </a>
        </pre>
      </div>
    </main>
  );
}
