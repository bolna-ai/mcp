# Bolna MCP Server

Remote MCP server (Streamable HTTP) wrapping the [Bolna](https://bolna.ai) voice
AI REST API (`https://api.bolna.ai`): 57 tools covering nearly every documented
Bolna endpoint, TypeScript, deployed on Vercel via `mcp-handler`.

**Live at [mcp.bolna.ai](https://mcp.bolna.ai)** — that page has the same
connect instructions below with copy-paste buttons for each client.

MCP is an open protocol, not Claude-specific — this server works with any
MCP-compatible client: Claude, Codex, Cursor, Windsurf, Zed, and others.

Endpoint corrections found while verifying tool paths against the live Bolna
docs are documented in the comment block at the top of
[`src/tools/index.ts`](src/tools/index.ts).

## Sub-accounts and switching between accounts

Sub-account API keys (format `sa-...`) work exactly like a main account's key
(`bn-...`) — connect a separate client/connector with a sub-account's key as
the Bearer token to work entirely within that sub-account.

To switch accounts **within a single connected session** instead of
reconnecting, every tool also accepts an optional `api_key` argument that
overrides the connection's own credential for just that call. Get a
sub-account's key from `list_sub_accounts`' `api_key` field, then pass it to
any tool call to run that call against that sub-account instead of the main
account — e.g. "list agents in sub-account X" resolves to calling
`list_sub_accounts`, finding X's key, then `list_agents` with that key passed
as `api_key`.

## Available tools

57 tools across 14 categories. "Write" tools flagged **Destructive** modify,
remove, or spend money and typically prompt for confirmation in MCP clients
that respect tool annotations.

### Agents & calls

| Tool | Type | Description |
|---|---|---|
| `list_agents` | Read | List agents in the account (id, name, status, created_at). Paginated. |
| `get_agent` | Read | Full config of one agent by ID. |
| `create_agent` | Write | Create a new agent. Returns its ID. |
| `update_agent` | Write, Destructive | Patch an existing agent's name, prompts, welcome message, webhook, or voice settings. |
| `delete_agent` | Write, Destructive | Permanently delete an agent. Irreversible. |
| `stop_agent_queued_calls` | Write, Destructive | Cancel every queued call for an agent. |
| `start_outbound_call` | Write, Destructive | Place a real outbound call from an agent. Spends account balance. |
| `stop_call` | Write, Destructive | Cancel a queued or scheduled call. |

### Executions

| Tool | Type | Description |
|---|---|---|
| `list_agent_executions` | Read | Call history for one agent. Paginated, defaults to the last 7 days. |
| `get_execution` | Read | Full details of one call: transcript, status, cost, telephony data. |
| `get_execution_raw_logs` | Read | Raw pipeline logs (transcriber/LLM/synthesizer) for a call. |
| `list_batch_executions` | Read | Every call execution within a batch. Paginated. |

### Batches

| Tool | Type | Description |
|---|---|---|
| `create_batch` | Write | Create a batch of outbound calls from a list of recipients. |
| `get_batch` | Read | A batch's status, schedule, and contact counts. |
| `list_batches` | Read | Call batches for one agent. |
| `schedule_batch` | Write, Destructive | Schedule a batch to start calling. Spends account balance. |
| `stop_batch` | Write, Destructive | Halt a running or queued batch. |
| `delete_batch` | Write, Destructive | Permanently delete a batch. |

### Dispositions (structured call extraction)

| Tool | Type | Description |
|---|---|---|
| `list_dispositions` | Read | List dispositions, optionally scoped to an agent. |
| `get_disposition` | Read | Retrieve a single disposition. |
| `create_disposition` | Write | Create a disposition linked to an agent. |
| `bulk_create_dispositions` | Write | Atomically create multiple dispositions for one agent. |
| `update_disposition` | Write, Destructive | Update a disposition (may fork a private copy — Bolna's copy-on-write). |
| `delete_disposition` | Write, Destructive | Permanently delete a disposition. |
| `test_dispositions` | Read | Run an agent's dispositions against a sample transcript. |

### Phone numbers & inbound

| Tool | Type | Description |
|---|---|---|
| `list_phone_numbers` | Read | Phone numbers on the account. |
| `search_phone_numbers` | Read | Search phone numbers available for purchase. |
| `buy_phone_number` | Write, Destructive | Purchase a phone number. Real recurring charge. |
| `delete_phone_number` | Write, Destructive | Remove a phone number and stop its billing. |
| `setup_inbound_agent` | Write | Route inbound calls on a number to an agent, optionally with an IVR menu. |
| `unlink_inbound_agent` | Write, Destructive | Remove inbound routing from a number. |

### SIP trunks (bring your own telephony)

| Tool | Type | Description |
|---|---|---|
| `create_sip_trunk` | Write | Create a SIP trunk with gateway and auth config. |
| `get_sip_trunk` | Read | Full details of a SIP trunk. |
| `list_sip_trunks` | Read | All SIP trunks on the account. |
| `update_sip_trunk` | Write, Destructive | Partially update a SIP trunk. |
| `delete_sip_trunk` | Write, Destructive | Permanently delete a trunk and its gateways/numbers. |
| `add_trunk_number` | Write | Add a DID phone number to a trunk. |
| `remove_trunk_number` | Write, Destructive | Remove a number from a trunk. |
| `list_trunk_numbers` | Read | Numbers assigned to a trunk. |

### Sub-accounts (enterprise)

| Tool | Type | Description |
|---|---|---|
| `create_sub_account` | Write | Create an isolated sub-account workspace. Requires org admin access. |
| `list_sub_accounts` | Read | All sub-accounts in the organization. |
| `update_sub_account` | Write, Destructive | Update a sub-account's name or concurrency limits. |
| `delete_sub_account` | Write, Destructive | Permanently delete a sub-account and all its data. |
| `get_sub_account_usage` | Read | Usage and cost breakdown for one sub-account. |
| `get_all_sub_accounts_usage` | Read | Usage and cost breakdown for every sub-account. |

### Voice & providers

| Tool | Type | Description |
|---|---|---|
| `list_tts_providers` | Read | TTS providers and models Bolna supports. |
| `list_voices` | Read | Voices available for a TTS provider/model. |
| `list_providers` | Read | Third-party providers configured on the account (secrets masked). |
| `remove_provider` | Write, Destructive | Remove a configured provider by name. |

### Knowledgebase (RAG)

| Tool | Type | Description |
|---|---|---|
| `create_knowledgebase` | Write | Create a knowledgebase by scraping a URL. PDF upload isn't supported here. |
| `get_knowledgebase` | Read | A knowledgebase's file name, status, and settings. |
| `list_knowledgebases` | Read | All knowledgebases on the account. |
| `delete_knowledgebase` | Write, Destructive | Permanently delete a knowledgebase. |

### Violations

| Tool | Type | Description |
|---|---|---|
| `list_violations` | Read | List flagged call violations, optionally filtered by status. Paginated. |

### Account & documentation

| Tool | Type | Description |
|---|---|---|
| `get_user_info` | Read | Account profile, wallet balance, concurrency limits. |
| `search_docs` | Read | Search the Bolna documentation site for matching pages. |
| `get_doc` | Read | Fetch the full markdown content of a Bolna documentation page. |

Not exposed as a tool, all for the same reason — each needs either a raw
file upload or a third-party secret as its request body, neither of which
maps cleanly to a tool argument or belongs in a chat conversation:
- `POST /providers` (add a provider) — takes a third-party credential (e.g. a Twilio auth token)
- `POST /knowledgebase` with a PDF file (the URL variant is supported, above)
- `POST /violations/submit` — takes an evidence screenshot/document

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

### Claude Desktop (extension)

Instead of the `mcp-remote` bridge above, you can install this as a proper
[Desktop Extension](https://github.com/modelcontextprotocol/mcpb) (`.mcpb`) —
a local, stdio-based build of the same 57 tools, packaged with a manifest so
Claude Desktop can install it with one click and prompt you for your API key
itself (no config file editing).

Build it from source:

```bash
npm run package:mcpb   # bundles src/stdio.ts, packs mcpb/ into bolna-mcp.mcpb
```

Then double-click `bolna-mcp.mcpb`, or drag it into Claude Desktop's
Settings → Extensions, and enter your Bolna API key when prompted.

This local build talks directly to `api.bolna.ai` using only the raw API key
path in [`src/lib/auth.ts`](src/lib/auth.ts) — OAuth is specific to the
remote server and isn't used here.

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
of the 13 core tools with valid and invalid input.

## Privacy Policy

See [mcp.bolna.ai/privacy](https://mcp.bolna.ai/privacy).

## License

[MIT](LICENSE)
