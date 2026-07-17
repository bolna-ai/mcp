# Privacy Policy — Bolna MCP Server

**Last updated:** 2026-07-17

This policy covers the Bolna MCP server (`mcp.bolna.ai`), which lets Claude and
other MCP-compatible AI clients read and manage your Bolna voice AI account.

## Data collection practices

The server does not collect, log, or store the content of your requests. It
does not read your Claude conversation history, and it has no access to
anything outside the specific tool call it is processing.

The server logs only operational metadata for each request: the tool name
called, the HTTP status returned, and the response latency. It never logs
tool arguments — this means prompts, phone numbers, agent configurations,
and call transcripts passing through a tool call are never written to any
log.

## Usage and storage

Connecting requires either your own Bolna API key or a login completed
through Bolna's OAuth sign-in. Either way, the credential is used only to
authenticate the specific request it arrives with, and is never written to
disk, a database, or any persistent store. It is not cached, retained, or
logged. Once a request completes, the credential is discarded from memory.

No conversation content, call transcripts, agent configurations, or other
Bolna account data passing through the server is stored. Every tool call is
a direct, stateless pass-through: the server validates the request, forwards
it to Bolna's own API (`api.bolna.ai`), and returns the response.

## Third-party sharing

The server communicates with two external services, both operated by or on
behalf of Bolna: Bolna's own REST API (`api.bolna.ai`), and, only for users
who sign in via OAuth, Bolna's authentication provider (Supabase) to confirm
a login is valid. No account data is sent to Supabase — it is used solely to
verify that a sign-in token is genuine. No data is sent to any other third
party, analytics service, or advertising network.

## Data retention

Because the server does not store request content or credentials, there is
nothing to retain. The only data retained is the operational metadata
described above (tool name, status, latency), retained for standard
infrastructure logging/debugging purposes.

## Contact information

Questions about this policy or the Bolna MCP server can be sent to
**support@bolna.dev**.
