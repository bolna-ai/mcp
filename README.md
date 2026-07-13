# Bolna MCP Server

Remote MCP server (Streamable HTTP) wrapping the [Bolna](https://bolna.ai) voice
AI REST API (`https://api.bolna.ai`): 7 read tools, 4 write tools, TypeScript,
deployed on Vercel via `mcp-handler`.

Endpoint corrections found while verifying tool paths against the live Bolna
docs are documented in the comment block at the top of
[`src/tools/index.ts`](src/tools/index.ts).

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
