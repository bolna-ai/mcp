import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Condensed from the debug-bolna-calls Agent Skill (github.com/bolna-ai/skills).
const METHODOLOGY = `You are diagnosing a Bolna voice-agent issue. Most problems fall into a few well-known patterns — map the symptom to the exact field to change, then verify with the API.

## Triage first

Get (or infer from what's given): \`execution_id\` (the single most useful thing — every diagnostic flows from it), \`agent_id\`, \`batch_id\` if relevant, the observed symptom in one sentence. Then pull \`get_execution\` (status, costs, transcript, \`latency_data\`, \`telephony_data\`, \`extracted_data\`) and \`get_execution_raw_logs\` (every prompt/request/response, including \`reasoning_content\` when the model exposes it). The raw logs are the most powerful diagnostic Bolna provides — use them before assuming a platform bug: find a wrong response via \`component: "llm"\` + \`type: "response"\` near the timestamp; find a tool that never fired by grepping for its name in \`llm\` entries; find a tool called with wrong params via \`component: "tool"\` + \`type: "request"\`.

## Symptom → fix

**Agent goes silent for ages before responding** — read \`latency_data\`: \`transcriber\` turn latency > 100ms → switch STT provider or check audio/network; \`llm.time_to_first_token\` > 1000ms → switch LLM (Azure GPT-4.1-mini is fast), shorten the prompt, check provider health; \`synthesizer.time_to_first_token\` > 500ms → switch TTS (ElevenLabs turbo_v2_5, Cartesia) or a lighter voice; high \`time_to_connect\` on any component → cold start (fine on turn one, escalate if chronic). Also tune \`task_config.incremental_delay\` (default 400ms, lower for snappier but riskier partial-transcript commits) and \`transcriber.endpointing\` (default 250ms, lower for quick turns, higher for thoughtful/pausing speakers).

**Agent interrupts the user mid-sentence** — \`task_config.number_of_words_for_interruption\` too low (default 2); bump to 4-5, pair with \`transcriber.endpointing: 500-700\` for pausers.

**Agent never interrupts / talks over the user** — lower \`number_of_words_for_interruption\` (try 1); also confirm the transcriber is actually capturing the user (\`latency_data.transcriber.turns[]\` should grow) — if transcripts are missing, the agent literally can't hear the interruption.

**Call hangs up after user silence** — \`task_config.hangup_after_silence\` (default 10s); for graph agents prefer per-node \`repeat_after_silence_seconds\` plus an expression edge on \`_silence_repeats\` to escalate gracefully instead of hanging up.

**Call ends too soon after the agent speaks** — check \`task_config.hangup_after_LLMCall: true\` (ends right after the first response — one-shot announcements only), \`task_config.call_terminate\` (hard duration cap, default 300s), or an over-eager LLM-prompted hangup trigger in the system prompt.

**Agent sounds robotic / over-narrating** — cap response length in the prompt ("never more than two sentences per turn"), pick a higher-quality voice (ElevenLabs turbo_v2_5/multilingual_v2, Sarvam for Indian languages), enable \`task_config.backchanneling: true\` only where it fits, lower \`temperature\` to 0.2-0.3, and for Indian languages write the prompt in native Devanagari script, not phonetic English.

**Call stuck in \`queued\`** — check agent concurrency limit (\`get_user_info\`), \`calling_guardrails.call_start_hour\`/\`call_end_hour\`, a future \`scheduled_at\`, wallet balance, and \`retry_intervals_minutes\` on a failed-then-retrying call.

**Status \`balance-low\`** — wallet is empty (\`get_user_info\` → \`wallet\`); every \`start_outbound_call\` lands here until topped up.

**Status \`failed\`/\`error\`** — read \`error_message\`: "from_phone_number not owned by account" → use an owned number (\`list_phone_numbers\`); "invalid phone number format" → E.164 only (\`+91...\`); "agent restricted due to disallowed content" → Bolna's content checker flagged the prompt, review and re-save; "concurrency limit reached" → wait or upgrade; "provider auth failed" → re-add provider credentials.

**"No answer"/"busy"** — normal outcomes, not failures; use \`retry_config\` on the call (\`enabled\`, \`max_retries\`, \`retry_on_statuses: ["no-answer","busy"]\`, \`retry_intervals_minutes\`). Don't add \`failed\`/\`error\` to \`retry_on_statuses\` unless the cause is confirmed transient.

**Webhook never fires, or fires but isn't received** — walk in order: is \`webhook_url\` actually set on the agent; is the URL publicly reachable over HTTPS; does the receiver return 2xx (non-2xx triggers retries, then eventually stops); is Bolna's source IP \`13.203.39.153\` firewalled; is the receiver deduping by \`execution_id\`+\`status\` (multiple events per call is normal, one per status transition); does the receiver avoid a ~10s timeout (return 2xx immediately, process async).

**Caller context (e.g. \`{customer_name}\`) is wrong** — outbound: \`user_data\` keys must match prompt variables exactly, case-sensitive; batch CSV: column name = variable name (\`customer_name\`, not \`Customer Name\`); inbound API: endpoint must return matching JSON keys for the exact \`contact_number\` Bolna sends; inbound CSV/Sheet: \`contact_number\` column present, E.164 format.

**Transcript has half-formed agent sentences** — enable Precise Transcript Generation (beta) in the agent's Analytics tab so an interrupted agent utterance is trimmed to what was actually heard, not what the LLM intended to say.

**SIP: call connects, no audio** — classic SRTP mismatch; try \`media_encryption: "no"\` for testing, or \`media_encryption_optimistic: true\` to auto-fall back to clear RTP, and confirm the carrier actually has SRTP enabled if keeping \`sdes\`.

**SIP: outbound INVITE silently fails** — likely UDP fragmentation on large SIP headers; switch \`transport: "transport-tcp"\`.

**Batch: many calls failed / weren't placed** — CSV recipient column must be named \`contact_number\` (other columns become variables); check \`valid_contacts\` vs \`total_contacts\` on the batch for bad numbers; per-call retry configs can blow batch concurrency if they overlap; inspect \`list_batch_executions\` for per-call \`status\`/\`error_message\`.

**Indian 140/160-series numbers rejected** — compliance gap (DLT/header/template registration incomplete); the carrier rejects before Bolna ever dials — not a Bolna API failure.

## Reading raw logs

Each log entry has \`component\` (\`transcriber\`/\`llm\`/\`synthesizer\`/\`tool\`/\`system\`), \`type\` (\`request\`/\`response\`/\`event\`), \`data\`, \`reasoning_content\` (when the model exposes it), and \`timestamp\`. This is almost always faster than guessing from the transcript alone.

Report the diagnosis as: the symptom restated in one line, the pipeline component/field responsible (with the actual \`latency_data\`/\`error_message\` value that proves it), and the exact field/setting to change to fix it — not a general explanation of how the pipeline works.`;

export function registerDebugCallsPrompt(server: McpServer) {
  server.registerPrompt(
    "diagnose_call",
    {
      title: "Diagnose a Bolna call issue",
      description:
        "Runs a symptom-to-fix diagnosis for a Bolna voice-agent issue — robotic/laggy responses, wrong interruption behavior, premature or missing hangups, queued/failed/balance-low calls, webhook misses, wrong caller context, batch failures, or SIP/SRTP no-audio — mapping the symptom to the exact agent field to change and the `latency_data`/`error_message` that confirms it. Pass `symptom` (and `execution_id` if known) to diagnose a specific case; omit to get the full symptom-to-fix map.",
      argsSchema: { symptom: z.string().optional(), execution_id: z.string().optional() },
    },
    async ({ symptom, execution_id }) => {
      const task = symptom
        ? `Diagnose this issue${execution_id ? ` for execution ${execution_id}` : ""}: ${symptom}. Call get_execution${execution_id ? ` (execution_id: ${execution_id})` : ""} and get_execution_raw_logs as needed to confirm the root cause before recommending a fix.`
        : "No specific symptom given yet. Ask for the execution_id and a one-sentence description of what's wrong, then diagnose once given.";
      return {
        messages: [
          {
            role: "user",
            content: { type: "text", text: `${METHODOLOGY}\n\n---\n\n${task}` },
          },
        ],
      };
    }
  );
}
