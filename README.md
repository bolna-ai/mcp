# Bolna MCP Server

Remote MCP server (Streamable HTTP) wrapping the [Bolna](https://bolna.ai) voice
AI REST API (`https://api.bolna.ai`): 7 read tools, 4 write tools, TypeScript,
deployed on Vercel via `mcp-handler`.

**Live at [mcp.bolna.ai](https://mcp.bolna.ai)** — that page has the same
connect instructions below with copy-paste buttons for each client.

MCP is an open protocol, not Claude-specific — this server works with any
MCP-compatible client: Claude, Codex, Cursor, Windsurf, Zed, and others.

Endpoint corrections found while verifying tool paths against the live Bolna
docs are documented in the comment block at the top of
[`src/tools/index.ts`](src/tools/index.ts).

## Available tools

| Tool | Type | Description |
|---|---|---|
| `list_agents` | Read | List agents in the account (id, name, status, created_at). Paginated. |
| `get_agent` | Read | Full config of one agent by ID. |
| `list_agent_executions` | Read | Call history for one agent. Paginated, defaults to the last 7 days. |
| `get_execution` | Read | Full details of one call: transcript, status, cost, telephony data. |
| `list_phone_numbers` | Read | Phone numbers on the account. |
| `list_batches` | Read | Call batches for one agent. |
| `get_user_info` | Read | Account profile, wallet balance, concurrency limits. |
| `create_agent` | Write | Create a new agent. Returns its ID. |
| `update_agent` | Write | Patch an existing agent's name, prompts, welcome message, webhook, or voice settings. |
| `delete_agent` | Write | Permanently delete an agent. Irreversible. |
| `start_outbound_call` | Write | Place a real outbound call from an agent. Spends account balance. |

## Install & use

**Prerequisite:** your own Bolna API key (from the Bolna dashboard). Every
client below needs the same two things: the server URL
(`https://mcp.bolna.ai/api/mcp`) and that key as a Bearer token.

### Claude Code

One command:

```bash
./scripts/connect.sh
```

or the equivalent by hand:

```bash
claude mcp add --transport http bolna https://mcp.bolna.ai/api/mcp \
  --header "Authorization: Bearer <your BOLNA_API_KEY>" \
  --scope user
```

or by hand-editing `~/.claude.json` (or `.mcp.json` for a project-scoped copy):

```json
{
  "mcpServers": {
    "bolna": {
      "type": "http",
      "url": "https://mcp.bolna.ai/api/mcp",
      "headers": {
        "Authorization": "Bearer <your BOLNA_API_KEY>"
      }
    }
  }
}
```

### Claude Desktop

Desktop's config only understands locally-run (stdio) servers, so reaching a
remote HTTP server with a custom header needs the
[`mcp-remote`](https://www.npmjs.com/package/mcp-remote) bridge, which runs
locally and forwards the header on your behalf. Add this to
`claude_desktop_config.json`:

```json
{
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
}
```

Restart Claude Desktop after editing the config.

### Codex CLI

Reads the key from an environment variable rather than the config file:

```bash
export BOLNA_API_KEY="<your BOLNA_API_KEY>"

codex mcp add bolna \
  --url https://mcp.bolna.ai/api/mcp \
  --bearer-token-env-var BOLNA_API_KEY
```

### Cursor

Add to `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "bolna": {
      "url": "https://mcp.bolna.ai/api/mcp",
      "headers": {
        "Authorization": "Bearer <your BOLNA_API_KEY>"
      }
    }
  }
}
```

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "bolna": {
      "serverUrl": "https://mcp.bolna.ai/api/mcp",
      "headers": {
        "Authorization": "Bearer <your BOLNA_API_KEY>"
      }
    }
  }
}
```

### Zed

Add to `settings.json`. Zed doesn't support environment-variable
interpolation in headers yet, so the key goes in directly:

```json
{
  "context_servers": {
    "bolna": {
      "url": "https://mcp.bolna.ai/api/mcp",
      "headers": {
        "Authorization": "Bearer <your BOLNA_API_KEY>"
      }
    }
  }
}
```

### Any other MCP client

Point it at:

```
URL:     https://mcp.bolna.ai/api/mcp
Header:  Authorization: Bearer <your BOLNA_API_KEY>
```

### claude.ai web/mobile

This server now implements real OAuth (via Bolna's Supabase-backed
authorization server), so claude.ai's own "Add custom connector" flow
(Settings → Connectors) should work with just the URL — no manually pasted
token needed, since claude.ai handles the login/consent redirect itself the
same way Claude Code does. This hasn't been separately verified on claude.ai
web/mobile specifically yet (only Claude Code's CLI flow has been tested
end-to-end so far) — the CLI/config options above remain the proven paths in
the meantime.

### Try it

After connecting, start a new conversation and ask something like:

- "List my Bolna agents"
- "What's my Bolna wallet balance?"
- "Call +1... using my [agent name] agent"

## Auth

Two ways to connect:

- **OAuth** — sign in through Bolna's own login (Supabase-backed). This is
  what claude.ai's custom-connector UI and Claude Code's `Authenticate`
  prompt use automatically; no manual token needed.
- **Raw API key** — pass your own Bolna API key as a Bearer token in the
  `Authorization` header, per the client examples above.

Either credential is verified before being forwarded to `api.bolna.ai` — see
the comment block at the top of [`src/lib/auth.ts`](src/lib/auth.ts) for how.

For local development, set `BOLNA_API_KEY` in `.env` and omit the header —
the server falls back to it automatically.

## Local dev

```bash
npm install
cp .env.example .env   # then fill in BOLNA_API_KEY
npm run dev             # or: vercel dev
```

The MCP endpoint is served at `http://localhost:3000/api/mcp`.

## Deploy

Deployed under the **Bolna AI** Vercel team, aliased to `mcp.bolna.ai`:

```bash
vercel deploy --prod --scope bolna-ai
```

Set `BOLNA_API_KEY` as a Vercel environment variable only if you want a
server-wide fallback for testing; production callers should supply their own
key via the Authorization header.

## Test with MCP Inspector

```bash
npx @modelcontextprotocol/inspector
```

In the Inspector UI, connect with:
- **Transport:** Streamable HTTP
- **URL:** `http://localhost:3000/api/mcp` (or your deployed URL + `/api/mcp`)
- **Header:** `Authorization: Bearer <your Bolna API key>` (optional locally
  if `BOLNA_API_KEY` is set in `.env`)

Then use the Inspector's "List Tools" and "Call Tool" panels to exercise each
of the 11 tools with valid and invalid input.

## Privacy Policy

See [mcp.bolna.ai/privacy](https://mcp.bolna.ai/privacy).

## License

[MIT](LICENSE)
