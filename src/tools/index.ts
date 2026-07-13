/**
 * Endpoint verification against the live Bolna docs
 * (https://www.bolna.ai/docs/api-reference/openapi.yml — the raw file 404s;
 * verified instead against the per-endpoint pages linked from
 * https://www.bolna.ai/docs/llms.txt, fetched 2026-07-13) vs.
 * bolna-mcp-tool-design.md §3–§4. Corrections applied in read.ts/write.ts:
 *
 * - list_batches (§3.6): spec says `GET /batches` (agent-scoped via query).
 *   Actual: `GET /batches/{agent_id}/all` — agent_id is a path segment, not
 *   a query param. Also: the live endpoint has no pagination params, so
 *   page_number/page_size are applied client-side in read.ts.
 *
 * - get_user_info (§3.7): spec says `GET /user`. Actual: `GET /user/me`.
 *
 * - list_agents (§3.1): path `GET /v2/agent/all` confirmed, but the live
 *   endpoint takes no page_number/page_size params (returns the full array).
 *   Paginated client-side in read.ts to honor the tool's schema contract.
 *
 * - list_agent_executions (§3.3): path `GET /v2/agent/{agent_id}/executions`
 *   confirmed, but the live endpoint additionally *requires* `from`/`to`
 *   query params (UTC ISO 8601, max 7-day range) not mentioned in the spec.
 *   read.ts defaults to the last 7 days when omitted so the tool stays
 *   usable without forcing callers to pass dates. Also: the docs page
 *   implied a bare array response; the live endpoint actually returns a
 *   paginated envelope (`{data, total, has_more, page_number, page_size,
 *   filters, sorts}`), confirmed by an end-to-end test call on
 *   2026-07-13 — read.ts unwraps `data` and echoes the server's own
 *   total/has_more rather than re-deriving them client-side.
 *
 * - start_outbound_call (§4.4): spec names the dynamic-variables field
 *   `variables`. Actual request field is `user_data`. write.ts uses the
 *   real field name.
 *
 * - get_execution (§3.4), get_agent (§3.2), create_agent (§4.1),
 *   update_agent (§4.2), delete_agent (§4.3): paths confirmed exactly as
 *   specified.
 *
 * - Error mapping (§5): confirmed live on 2026-07-13 that an invalid API key
 *   returns HTTP 403 (not 401 as the spec assumed), with body shape
 *   `{"detail": "..."}` rather than `{"message": "..."}`. errors.ts maps
 *   both 401 and 403 to the same "invalid or expired key" message and reads
 *   `detail` as a fallback field.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerReadTools } from "./read";
import { registerWriteTools } from "./write";

export function registerAllTools(server: McpServer) {
  registerReadTools(server);
  registerWriteTools(server);
}
