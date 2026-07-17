import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Bolna MCP Server",
  description:
    "What the Bolna MCP server does and does not do with your data.",
};

export default function PrivacyPolicy() {
  return (
    <main style={{ maxWidth: "700px", margin: "0 auto", padding: "56px 24px" }}>
      <h1>Privacy Policy — Bolna MCP Server</h1>
      <p>
        <strong>Effective date:</strong> 2026-07-17
      </p>

      <p>
        This policy covers the Bolna MCP server (<code>mcp.bolna.ai</code>),
        which lets Claude and other MCP-compatible AI clients (Codex, Cursor,
        Windsurf, and others) read and manage your Bolna voice AI account on
        your behalf. It describes specifically what this server does with
        your data — it does not replace Bolna&apos;s main privacy policy,
        which governs your Bolna account generally.
      </p>

      <h2>Data collection practices</h2>
      <p>
        The server does not collect, log, or store the content of your
        requests. It does not read your Claude conversation history, and it
        has no access to anything outside the specific tool call it is
        processing.
      </p>
      <p>
        The server logs only operational metadata for each request: the tool
        name called, the HTTP status returned, and the response latency. It
        never logs tool arguments — this means prompts, phone numbers, agent
        configurations, and call transcripts passing through a tool call are
        never written to any log.
      </p>

      <h2>Usage and storage</h2>
      <p>
        Connecting requires either your own Bolna API key or a login
        completed through Bolna&apos;s OAuth sign-in. Either way, the
        credential is used only to authenticate the specific request it
        arrives with, and is never written to disk, a database, or any
        persistent store. It is not cached, retained, or logged. Once a
        request completes, the credential is discarded from memory.
      </p>
      <p>
        No conversation content, call transcripts, agent configurations, or
        other Bolna account data passing through the server is stored. Every
        tool call is a direct, stateless pass-through: the server validates
        the request, forwards it to Bolna&apos;s own API (
        <code>api.bolna.ai</code>), and returns the response.
      </p>

      <h2>Third-party sharing</h2>
      <p>
        The server communicates with two external services, both operated by
        or on behalf of Bolna: Bolna&apos;s own REST API (
        <code>api.bolna.ai</code>), and, only for users who sign in via
        OAuth, Bolna&apos;s authentication provider (Supabase) to confirm a
        login is valid. No account data is sent to Supabase — it is used
        solely to verify that a sign-in token is genuine. No data is sent to
        any other third party, analytics service, or advertising network.
      </p>

      <h2>Data retention</h2>
      <p>
        Because the server does not store request content or credentials,
        there is nothing to retain. The only data retained is the
        operational metadata described above (tool name, status, latency),
        retained for standard infrastructure logging/debugging purposes.
      </p>

      <h2>Your choices</h2>
      <p>
        If you connected via OAuth, you can revoke this server&apos;s access
        at any time from your Bolna account&apos;s connected-apps settings,
        or by asking whichever AI client you connected (Claude, Codex,
        Cursor, etc.) to remove the connector. If you connected with a raw
        API key, you can revoke access by rotating or deleting that key from
        your Bolna dashboard.
      </p>

      <h2>Security</h2>
      <p>
        All traffic to and from this server is encrypted in transit (HTTPS).
        Because no credentials or account data are persisted, there is no
        stored data at rest for this server to protect beyond routine
        operational logs.
      </p>

      <h2>Changes to this policy</h2>
      <p>
        If this policy changes, the effective date above will be updated.
        Material changes will be reflected here before they take effect.
      </p>

      <h2>Contact information</h2>
      <p>
        Questions about this policy or the Bolna MCP server can be sent to{" "}
        <a href="mailto:support@bolna.dev">support@bolna.dev</a>.
      </p>
    </main>
  );
}
