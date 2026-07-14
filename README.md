# Bolna MCP Server

Remote MCP server (Streamable HTTP) wrapping the [Bolna](https://bolna.ai) voice
AI REST API (`https://api.bolna.ai`): 7 read tools, 4 write tools, TypeScript,
deployed on Vercel via `mcp-handler`.

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

**Prerequisite:** your own Bolna API key (from the Bolna dashboard).

### Option A — one-command setup (Claude Code)

```bash
./scripts/connect.sh
```

Prompts for your Bolna API key and registers the server under `--scope user`
(personal to you, works across all your projects).

### Option B — manual config, Claude Code

Equivalent to Option A, either as a CLI command:

```bash
claude mcp add --transport http bolna-mcp https://bolna-mcp-eta.vercel.app/api/mcp \
  --header "Authorization: Bearer <your BOLNA_API_KEY>" \
  --scope user
```

or by hand-editing `~/.claude.json` (or `.mcp.json` for a project-scoped copy):

```json
{
  "mcpServers": {
    "bolna": {
      "type": "http",
      "url": "https://bolna-mcp-eta.vercel.app/api/mcp",
      "headers": {
        "Authorization": "Bearer <your BOLNA_API_KEY>"
      }
    }
  }
}
```

### Option C — manual config, Claude Desktop

Claude Desktop's config only understands locally-run (stdio) servers, so
reaching a remote HTTP server with a custom header needs the
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
        "https://bolna-mcp-eta.vercel.app/api/mcp",
        "--header",
        "Authorization: Bearer <your BOLNA_API_KEY>"
      ]
    }
  }
}
```

Restart Claude Desktop after editing the config.

### claude.ai web/mobile

Not currently supported — its custom-connector UI has no field for a
personal Bearer token. Options A–C above (Claude Code or Desktop) are the
only self-serve paths until real OAuth is in place.

### Try it

After connecting, start a new conversation and ask something like:

- "List my Bolna agents"
- "What's my Bolna wallet balance?"
- "Call +1... using my [agent name] agent"

## Auth

Pass your Bolna API key as a Bearer token in the `Authorization` header when
connecting to this server. For local development, set `BOLNA_API_KEY` in
`.env` and omit the header — the server falls back to it automatically.

## Local dev

```bash
npm install
cp .env.example .env   # then fill in BOLNA_API_KEY
npm run dev             # or: vercel dev
```

The MCP endpoint is served at `http://localhost:3000/api/mcp`.

## Deploy

```bash
vercel deploy
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

## License

[MIT](LICENSE)
