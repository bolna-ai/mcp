import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Short enough to be a genuine "hint," per the MCP spec's intent for the
// server-level `instructions` field — not a full methodology dump. Clients
// that read `InitializeResult.instructions` (confirmed: Claude Code; not
// yet: claude.ai's web connector) inject this as context on every session
// that connects to this server, with zero setup on the caller's part.
export const SERVER_INSTRUCTIONS = `This server manages Bolna Voice AI: agents, calls, batches, phone numbers, knowledge bases, SIP trunks, sub-accounts, and post-call extraction (dispositions).

Dispositions (create_disposition / bulk_create_dispositions / test_dispositions / list_dispositions / update_disposition / delete_disposition) are structured extraction questions an LLM evaluates against every call transcript. When asked to design one, don't write a thin one-line question — the \`question\` field should state: (1) role/scope — what to look at and what to ignore, (2) the classification or output shape, (3) plain-behavioral per-value definitions, (4) guardrails against over-inferring from politeness or generic curiosity, (5) a tie-breaker for conflicting signals, (6) a safe default.

Every Pre-defined (\`is_objective: true\`) extraction needs a "couldn't determine" bucket (e.g. NA / Not_Specified / Unclear) alongside the real answers — never force a choice when the underlying question was never reached in the call. Use snake_case for \`name\`; Title_Case_With_Underscores for \`category\` and multi-word \`objective_options[].value\` (single words like Yes/No stay simple). Nested classification uses \`objective_options[].sub_options[]\`, evaluated only when its parent value is selected — at least one of \`is_subjective\`/\`is_objective\` must be true.

Dispositions are grouped into extraction categories — a category is the set of dispositions evaluated together in one LLM pass per call, run on the category's model. Manage categories with list_extraction_categories / create_extraction_category / update_extraction_category / delete_extraction_category (deleting a category deletes its dispositions). Disposition create/update tools accept category_id (preferred) or a category name that is resolved or created on the agent.

For the full worked methodology — archetypes, anti-patterns, condition-writing rules, and a brief-gathering flow for thin requests — invoke this server's \`design_extraction\` prompt.

Three more invokable prompts cover the rest of Bolna Agent Skills' methodology: \`design_voice_prompt\` (the rigid section structure, Hindi-first/English-second scripted lines, and variable notation a GPT-4.1 mini voice-agent prompt needs — also fixes an existing prompt from a pasted transcript), \`design_graph_agent\` (node/edge schema, deterministic-first routing, expression operators, and event injection for a multi-step graph agent), and \`diagnose_call\` (symptom-to-fix map for latency, interruption, hangup, webhook, and SIP issues, backed by \`latency_data\`/raw logs).`;

// The richer, invokable counterpart to SERVER_INSTRUCTIONS above. Clients
// that surface MCP `prompts` as user-invokable actions (confirmed: Claude
// Code, as a `/mcp__<server>__design_extraction` slash command) let a user
// pull this in on demand, args and all, without any file-based Skill
// installed and without sharing a claude.ai Project.
const METHODOLOGY = `You are designing a Bolna disposition (post-call structured extraction). Produce a complete, ready-to-submit design — don't ask a round of clarifying questions unless the brief below is genuinely too thin to proceed (in which case ask once, briefly, then produce regardless of what comes back).

## Naming
- \`category\`: Title_Case_With_Underscores (e.g. Call_Outcome, User_Data).
- \`name\`: snake_case (e.g. purchase_intent, scheduled_callback_time).
- \`objective_options[].value\`: Title_Case_With_Underscores for multi-word (Do_Not_Contact); simple single words stay simple (Yes, No, Maybe). One convention per value list, never mixed.

## The question field — 7 parts, every time
1. Role: "You are an assistant scanning the transcript to [extract X / determine whether Y / classify Z]."
2. Scope: "Use the full conversation for context, but base the decision only on [the customer's own statements / responses to the agent's questions about X / the most recent clear intent]."
3. Classification statement: "Classify as A, B, or C" (or the free-text output shape).
4. Per-value / per-format definitions, in plain behavioral terms — not abstract labels.
5. Guardrails: what NOT to infer from (politeness, generic curiosity, the agent's own offer, hypotheticals).
6. Tie-breakers: most recent clear intent wins, or an explicit priority order when several conditions could match.
7. Default for incomplete/unclear: a safe fallback bucket, always.
Skipping 5-7 is the most common real-world failure mode — never skip them, even in a short prompt.

## Condition prompts (objective_options[].condition)
Form: "Yield this value if the customer/user [4-8 distinct behavioral signals, comma-separated]." Mutually exclusive across values in the same list — two conditions must never legitimately match the same transcript behavior. Collectively exhaustive once the default/NA bucket is included.

## Mandatory "couldn't determine" bucket
Every Pre-defined extraction gets a third bucket beyond affirmative/negative: NA/No_Answer (question maybe never asked), Unclear/Undecided/Maybe (vague response), Follow_Up_Required (missing info), or No_Particular_Reason (default under a Yes/objection parent). Never force a wrong value for lack of an escape hatch.

## Archetypes (pick the closest, then customize)
Binary intent/agreement (Yes/No/third-bucket) · Sentiment classifier (Positive/Neutral/Negative[/Busy], dominant-by-call-end) · Outcome/disposition (3-6 values = closing branches) · Objection categorizer (nested: parent Yes/No, children under Yes) · Structured-format extraction (strict date/time/ID shape + normalization rules) · Subjective+objective dual output (Free Text reasoning + Pre-defined verdict) · Free-text data capture (clear empty-output rule) · Synthesis/meta-extraction (one outcome combining several topics) · Priority-rule classifier (explicit If/Else-if/Else, operational blockers like Wrong_Number/Do_Not_Contact outrank sales-funnel outcomes).

## Anti-patterns to avoid
Thin one-liners with no scope/guardrails/default · overlapping conditions two values could both match · missing couldn't-determine bucket · conflating distinct states (e.g. already-purchased ≠ not-interested) · referencing the agent prompt or "Section 4" (the extraction LLM never sees the agent prompt or call flow — describe observable behavior instead) · inventing runtime variables not confirmed for the deployment · mixing naming conventions in one value list · hallucinating specifics (cities, products, companies) the user never gave you.

## Field mapping to the tool call
category→\`category\` (or \`category_id\` to target an existing category — see list_extraction_categories), name→\`name\`, the full prompt above→\`question\` (self-contained — nothing else reaches the extraction LLM), Free Text→\`is_subjective\`+\`subjective_type\` (text/timestamp/numeric/boolean/email/regex — regex needs \`subjective_type_config.pattern\`), Pre-defined→\`is_objective\`+\`objective_options[]\`, nested values→\`sub_options[]\`. One extraction: \`create_disposition\`. Several at once: \`bulk_create_dispositions\` (atomic — one bad item blocks the whole batch). Preview against a sample transcript before going live: \`test_dispositions\`.

Produce the finished design as: category, name, the full question text, answer type, and (if Pre-defined) each value with its condition — ready to hand straight to the tool call.`;

export function registerExtractionPrompts(server: McpServer) {
  server.registerPrompt(
    "design_extraction",
    {
      title: "Design a Bolna extraction",
      description:
        "Generates a complete, ready-to-submit Bolna disposition design (category, name, question prompt, answer type, and — for Pre-defined — condition-scored values) from a use-case brief, following a 7-part prompt skeleton, mandatory couldn't-determine bucket, and naming conventions. Optionally pass `brief` describing what to extract; omit it to get the full methodology plus a short brief-gathering flow.",
      argsSchema: { brief: z.string().optional() },
    },
    async ({ brief }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: brief
              ? `${METHODOLOGY}\n\n---\n\nDesign an extraction for this brief: ${brief}`
              : `${METHODOLOGY}\n\n---\n\nNo specific brief was given yet. Ask, in one shot, whichever of these would actually change the output — purpose/use case, what signal this captures, why it matters downstream, Free Text vs Pre-defined (or both), a values list if Pre-defined, transcript languages, and any edge cases — then produce the design regardless of what comes back, even if everything is skipped.`,
          },
        },
      ],
    })
  );
}
