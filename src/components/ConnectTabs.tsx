"use client";

import { useState } from "react";

const TABS = [
  {
    id: "code",
    label: "Claude Code",
    blurb: "One command, using your own Bolna API key.",
    code: `claude mcp add --transport http bolna https://mcp.bolna.ai/api/mcp \\
  --header "Authorization: Bearer <your BOLNA_API_KEY>" \\
  --scope user`,
  },
  {
    id: "desktop",
    label: "Claude Desktop",
    blurb: "Routed through mcp-remote, since Desktop only speaks to local servers.",
    code: `{
  "mcpServers": {
    "bolna": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://mcp.bolna.ai/api/mcp",
        "--header",
        "Authorization: Bearer <your BOLNA_API_KEY>"
      ]
    }
  }
}`,
  },
  {
    id: "codex",
    label: "Codex CLI",
    blurb: "Reads your key from an environment variable, not the config file.",
    code: `export BOLNA_API_KEY="<your BOLNA_API_KEY>"

codex mcp add bolna \\
  --url https://mcp.bolna.ai/api/mcp \\
  --bearer-token-env-var BOLNA_API_KEY`,
  },
  {
    id: "cursor",
    label: "Cursor",
    blurb: "Add to .cursor/mcp.json (project) or ~/.cursor/mcp.json (global).",
    code: `{
  "mcpServers": {
    "bolna": {
      "url": "https://mcp.bolna.ai/api/mcp",
      "headers": {
        "Authorization": "Bearer <your BOLNA_API_KEY>"
      }
    }
  }
}`,
  },
  {
    id: "windsurf",
    label: "Windsurf",
    blurb: "Add to ~/.codeium/windsurf/mcp_config.json.",
    code: `{
  "mcpServers": {
    "bolna": {
      "serverUrl": "https://mcp.bolna.ai/api/mcp",
      "headers": {
        "Authorization": "Bearer <your BOLNA_API_KEY>"
      }
    }
  }
}`,
  },
  {
    id: "zed",
    label: "Zed",
    blurb:
      "Add to settings.json. Zed doesn't support env-var interpolation here yet, so the key goes in directly.",
    code: `{
  "context_servers": {
    "bolna": {
      "url": "https://mcp.bolna.ai/api/mcp",
      "headers": {
        "Authorization": "Bearer <your BOLNA_API_KEY>"
      }
    }
  }
}`,
  },
  {
    id: "other",
    label: "Other",
    blurb:
      "Any MCP client that supports remote Streamable HTTP with a custom request header will work — point it at the URL below with this header.",
    code: `URL:     https://mcp.bolna.ai/api/mcp
Header:  Authorization: Bearer <your BOLNA_API_KEY>`,
  },
];

export default function ConnectTabs() {
  const [active, setActive] = useState(0);
  const tab = TABS[active] ?? TABS[0]!;

  return (
    <div className="connect">
      <div className="connect-tabs" role="tablist" aria-label="Connection method">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={i === active}
            className={`connect-tab${i === active ? " active" : ""}`}
            onClick={() => setActive(i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="connect-blurb">{tab.blurb}</p>
      <pre>
        <code>{tab.code}</code>
      </pre>
    </div>
  );
}
