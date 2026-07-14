import Waveform from "@/components/Waveform";
import ConnectTabs from "@/components/ConnectTabs";

const TOOLS: Array<{ name: string; type: "read" | "write"; description: string }> = [
  { name: "list_agents", type: "read", description: "List agents in the account (id, name, status, created_at). Paginated." },
  { name: "get_agent", type: "read", description: "Full config of one agent by ID." },
  { name: "list_agent_executions", type: "read", description: "Call history for one agent. Paginated, defaults to the last 7 days." },
  { name: "get_execution", type: "read", description: "Full details of one call: transcript, status, cost, telephony data." },
  { name: "list_phone_numbers", type: "read", description: "Phone numbers on the account." },
  { name: "list_batches", type: "read", description: "Call batches for one agent." },
  { name: "get_user_info", type: "read", description: "Account profile, wallet balance, concurrency limits." },
  { name: "create_agent", type: "write", description: "Create a new agent. Returns its ID." },
  { name: "update_agent", type: "write", description: "Patch an existing agent's name, prompts, welcome message, webhook, or voice settings." },
  { name: "delete_agent", type: "write", description: "Permanently delete an agent. Irreversible." },
  { name: "start_outbound_call", type: "write", description: "Place a real outbound call from an agent. Spends account balance." },
];

export default function Home() {
  return (
    <main>
      <section className="hero">
        <Waveform />
        <div className="hero-content">
          <h1>Bolna, for your AI agent.</h1>
          <p className="tagline">
            Read and manage your voice AI agents, place calls, and pull
            transcripts &mdash; from Claude, Codex, Cursor, Windsurf, or any
            other MCP-compatible coding agent.
          </p>
        </div>
      </section>

      <section className="block" aria-labelledby="tools-label">
        <p className="label" id="tools-label">
          Tools <span className="label-count">11</span>
        </p>
        <div className="tool-list">
          {TOOLS.map((t) => (
            <div className="tool-row" key={t.name}>
              <span className={`tool-dot ${t.type}`} aria-hidden="true" />
              <code className="tool-name">{t.name}</code>
              <span className="tool-desc">{t.description}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="block" aria-labelledby="connect-label">
        <p className="label" id="connect-label">
          Connect
        </p>
        <p className="lede">
          You&apos;ll need your own Bolna API key from the Bolna dashboard.
          Pick your tool below &mdash; every option needs the same two
          things: this server&apos;s URL and your key as a Bearer token.
        </p>
        <ConnectTabs />
      </section>

      <section className="block" aria-labelledby="try-label">
        <p className="label" id="try-label">
          Try it
        </p>
        <ul className="try-list">
          <li>&ldquo;List my Bolna agents&rdquo;</li>
          <li>&ldquo;What&apos;s my Bolna wallet balance?&rdquo;</li>
          <li>&ldquo;Call +1&hellip; using my [agent name] agent&rdquo;</li>
        </ul>
      </section>

      <footer>
        <a href="https://github.com/bolna-ai/mcp">github.com/bolna-ai/mcp</a>
        <span className="sep">&middot;</span>
        <a href="https://bolna.ai">bolna.ai</a>
        <span className="sep">&middot;</span>
        MIT
      </footer>
    </main>
  );
}
