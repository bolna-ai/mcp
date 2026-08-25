---
name: bolna-extraction-designer
description: Design Bolna post-call extraction templates (dispositions) — turn a use-case brief into copy-paste-ready Category/Name/Extraction-Prompt/Answer-Type blocks matching Bolna's UI, and optionally push them live through the Bolna MCP connector's create_disposition / bulk_create_dispositions / test_dispositions tools. Use whenever the user wants to define what structured data to pull from call transcripts — lead qualification, sentiment, objections, call outcome, scheduling/callback, application status, referrals, scholarship need, contact validity, etc. — or asks for "an extraction", "a disposition", "post-call data capture", or mentions Bolna analytics/extractions. This skill supplies the prompt-engineering methodology (categories, the 7-part prompt skeleton, condition-writing rules, mandatory edge-case buckets, naming conventions, archetypes, anti-patterns); for the underlying API/field mechanics (endpoints, validation types, confidence scoring, copy-on-write) see `create-disposition` instead — the two compose.
---

# Bolna Extraction Template Designer

Dispositions are Bolna's post-call structured-extraction objects: one question evaluated by an LLM (default `gpt-4.1-mini`) against every call transcript, surfaced in `extracted_data` on executions and webhooks. This skill is the design layer — it produces the actual `question` text and `objective_options[]` conditions well. `create-disposition` is the mechanics layer — schema, endpoints, validation types, confidence scoring, copy-on-write. Load it (or point the user to it) when the conversation turns to API/webhook plumbing rather than prompt quality.

## Relationship to the Bolna MCP tools

Everything this skill produces is written to be handed straight to:

- `create_disposition` — one extraction, linked to one `agent_id`
- `bulk_create_dispositions` — N extractions atomically for one `agent_id` (all-or-nothing — if any is invalid, none are created)
- `test_dispositions` — run an agent's linked extractions against a pasted transcript, no real call needed
- `list_dispositions` — inspect what's already on an agent or account-wide

See `references/field-mapping.md` for the exact block → tool-param mapping. Read it before calling any of these tools so the JSON you construct is schema-correct on the first try.

## Operating principle: produce, don't interrogate

- **Rich brief** (≥2 sentences covering use case + signal + any edge cases): produce the full template immediately. State assumptions inline, don't ask.
- **Thin brief** (one line, just an extraction name, or no use case given): ask a *single* round of optional questions (below), once. Then produce with whatever came back — including "skip all."
- Never a second round of clarifying questions. Iterate only via the user's next message.

### One-shot optional form (thin briefs only)

Pick 4-8 of these — whichever would actually change the output — frame as "answer any you want, skip the rest, I'll produce either way":

1. Call's purpose/use case (cart recovery, lead qual, appointment booking, CSAT, collections, recruitment, support...)?
2. What is the agent trying to accomplish? (1-2 lines, or paste the agent prompt/script)
3. What signal/data does this extraction capture, in one line?
4. Why does it matter — what downstream decision or CRM field does it feed?
5. Free Text, Pre-defined, or both?
6. If Pre-defined: suggest values, or do you have a list?
7. Which `agent_id` is this for, and do you want it pushed live or just the copy-paste block?
8. Any deployment runtime variables (`{name}`, `{product}`...)? Never invent one that isn't confirmed.
9. Transcript languages (English/Hindi/Hinglish/Kannada/other)?
10. Specific edge cases to handle (e.g. "already enrolled ≠ not interested", "default to X if agent never asked")?

## Output format

Two equivalent representations — produce the text block always; produce the tool-call JSON only when the user is pushing live (agent_id known).

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CATEGORY: [Title_Case_With_Underscores]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

NAME:
[extraction_name_snake_case]

EXTRACTION PROMPT:
[full prompt — role, scope, classification, per-value/format definitions, guardrails, tie-breakers, default — see skeleton below]

ANSWER TYPE:
[Free Text / Pre-defined / Both]

[if Free Text present:]
EXPECTED FORMAT: [Text / Timestamp / Numeric / Boolean / Email / Custom Regex]

[if Pre-defined present:]
POSSIBLE ANSWERS:

  Answer Value: [Value1]
  Condition: [4-8 behavioral signals]

  Answer Value: [Value2]
  Condition: [...]

  └─ Answer Value: [NestedValue] (only under its parent, when nesting applies)
     Condition: [...]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

After the block, 2-3 lines max: assumptions made, any deployment variable used and its source, one sentence on what call moment this focuses on. No rationale essays unless asked.

## Naming conventions

- Category: `Title_Case_With_Underscores` (`Call_Outcome`, `User_Data`, `Feedback_QA`).
- Extraction name: `snake_case` (`purchase_intent`, `scheduled_callback_time`).
- Pre-defined values: `Title_Case_With_Underscores` for multi-word (`Do_Not_Contact`, `Already_Enrolled`); simple single words stay simple (`Yes`, `No`, `Maybe`). One convention per value list — never mixed.

## The extraction prompt skeleton (7 parts, every time)

1. **Role** — "You are an assistant scanning the transcript to [extract X / determine whether Y / classify Z]."
2. **Scope** — "Use the full conversation for context, but base the decision only on [the customer's own statements / responses to the agent's questions about X / the most recent clear intent]."
3. **Classification statement** — "Classify as A, B, or C." or the free-text output shape.
4. **Per-value / per-format definitions** — plain behavioral terms, not abstract labels.
5. **Guardrails** — what NOT to infer from (politeness, generic curiosity, the agent's own offer, hypotheticals).
6. **Tie-breakers** — most recent clear intent wins; most specific wins; explicit priority order when several conditions could match.
7. **Default for incomplete/unclear** — a safe fallback bucket, always.

Skipping 5-7 is the most common failure mode in prompts found in the wild. Never skip them, even in a 4-line prompt.

## Condition prompts (Pre-defined `objective_options[].condition`)

Form: `Yield this value if the customer/user [4-8 distinct behavioral signals, comma-separated].` Behavioral, not abstract ("says they are busy, will buy later, not now, salary hasn't come, timing is the issue" — not "shows time-related hesitation"). Mutually exclusive across values in the same list — two conditions must never legitimately match the same transcript behavior. Collectively exhaustive once the default/NA bucket is included.

## Mandatory "couldn't determine" bucket

Every Pre-defined extraction gets a third bucket beyond affirmative/negative, unless the user explicitly forbids it:
- Question may not have been asked → `NA` / `No_Answer`
- Vague/non-committal → `Unclear` / `Undecided` / `Maybe`
- Missing info → `Follow_Up_Required`
- Default under a Yes/objection parent → `No_Particular_Reason`

Never force the LLM to pick a wrong value for lack of an escape hatch. `create_disposition` also requires this structurally to some degree — `objective_options` has no built-in null, so an unhandled case just gets misclassified into whatever's left. Same rule for Free Text: state what happens when nothing is found (usually: return empty string).

## Archetypes

Match the brief to one of these, then customize. Full skeletons + worked examples in `references/patterns-library.md`.

- **Binary intent/agreement** — Yes/No/third-bucket. Often paired with conditional free text (Sub-pattern A: pre-defined gates whether free text captures detail).
- **Sentiment classifier** — Positive/Neutral/Negative(+Busy). Dominant-by-call-end, not intermediate fluctuation.
- **Outcome/disposition** — 3-6 values mapping to the call's closing branches; include a Follow_Up_Required-equivalent.
- **Objection categorizer (nested)** — parent Yes/No, children are objection categories under Yes. Maps to `sub_options`.
- **Structured-format extraction** — Free Text with strict shape (date/time/ID) + heavy normalization rules in the prompt; usually the longest prompts you'll write.
- **Subjective + objective dual output** (Sub-pattern B) — Free Text = one-sentence factual reasoning, Pre-defined = verdict. Both flags true.
- **Free-text data capture** — no classification, just extraction with clear empty-output rules.
- **Synthesis/meta-extraction** — one outcome combining signals from several conversational topics (e.g. `call_outcome` = interest + location + documents combined).
- **Priority-rule classifier** — multiple conditions could match; resolve with explicit If/Else-if/Else, one value always reached (see `contact_validity_status` / `call_outcome` in the ed-tech catalog for worked priority-rule prompts).

## Multilingual transcripts

If the user says transcripts mix languages, add: "Transcripts may contain Hindi, Hinglish, English, or [other] mixed together. Interpret meaning semantically regardless of script or language." Inline known variant phrases when useful ("not interested, nahi chahiye, dropped, declined").

## Anti-patterns (full detail + before/after in `references/patterns-library.md`)

Thin one-liners without scope/guardrails/default · overlapping conditions two values could both legitimately match · missing couldn't-determine bucket · conflating distinct states (already-purchased ≠ not-interested) · referencing the agent prompt or "Section 4" (the extraction LLM never sees the agent prompt — describe behavior, not flow structure) · inventing runtime variables not confirmed for the deployment · mixed naming conventions in one value list · hallucinated specifics the user never gave you.

## Pushing live

Producing the block never requires an `agent_id`. Pushing it live does. After producing, note in one line that you can push it once they give you the `agent_id` — don't block on asking.

When they do:
1. Map the block(s) to tool params per `references/field-mapping.md`.
2. One extraction → `create_disposition`. Several at once → `bulk_create_dispositions` (remember: atomic — one bad item blocks the whole batch, so validate the mapping table mentally before calling).
3. If they hand you (or you have) a sample transcript, run `test_dispositions` first and show them the `extracted_data` shape before/after — this catches a misfiring condition before it's live on real calls.
4. Report plainly: what got created, under which category, and if updating later, flag the copy-on-write nuance (`create-disposition` covers this: editing a disposition shared across agents creates a new id rather than editing in place).

### Ed-tech starter pack

`assets/edtech_dispositions/*.json` is a complete, schema-ready 34-extraction pack (the full v1 master doc: User_Data, Scheduling_Next_Steps, Call_Success — ed-tech-specific — plus Feedback_QA and Referral, which are generic and reusable for any voice-agent vertical by analogy). One file per category, each a JSON array ready to drop into `bulk_create_dispositions`'s `dispositions` array (just add `agent_id`). See `references/edtech-catalog.md` for the summary table and the consolidation notes (callback vs. future_scheduling, raw-data vs. funnel-signal fields, nested dispositions, priority-ordered classifiers) — those notes are reusable design judgment, not just ed-tech trivia, and worth reading before designing a fresh vertical's pack from scratch.

If a user in a non-ed-tech vertical asks for a "standard pack," don't copy ed-tech specifics (exam names, hostel requirement) verbatim — use the catalog's *category shape* (User Data / Scheduling / Outcome funnel / Feedback / Referral) as the template and re-derive values for their vertical.

## Pre-output self-check (run silently before producing)

- [ ] All 7 skeleton parts present in the extraction prompt
- [ ] Pre-defined conditions mutually exclusive, collectively exhaustive with the default bucket
- [ ] Couldn't-determine bucket present
- [ ] No reference to the agent prompt, section numbers, or flow branches the extraction LLM can't see
- [ ] Only specifics the user actually gave (no invented cities/products/companies/variables)
- [ ] One naming convention per value list
- [ ] If Free Text + Pre-defined coexist, prompt scopes both outputs in separate labeled sections
- [ ] `is_subjective` / `is_objective` — at least one true, matching the produced Answer Type
- [ ] Conditional-branch extraction → NA/Not_Asked value included

## Tone

Direct, fast. No rationale essays, no praising the brief, no apologizing before clarifying. Produce.
