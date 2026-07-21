import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bolnaFetch } from "../lib/bolna-client";
import { toErrorResult } from "../lib/errors";
import { getApiKey } from "../lib/auth";
import {
  agentIdSchema,
  executionIdSchema,
  pageNumberSchema,
  pageSizeSchema,
  paginate,
} from "./schemas";

interface AgentV2Summary {
  id: string;
  agent_name: string;
  agent_status: string;
  created_at: string;
}

interface AgentExecution {
  id: string;
  status: string;
  conversation_duration: number | null;
  created_at: string;
  telephony_data?: {
    to_number?: string;
    from_number?: string;
    provider?: string;
  };
}

// GET /v2/agent/{agent_id}/executions returns a paginated envelope, not a
// bare array (confirmed against the live API — the docs page implied a bare
// array of items).
interface AgentExecutionsPage {
  data: AgentExecution[];
  total: number;
  has_more: boolean;
  page_number: number;
  page_size: number;
}

interface PhoneNumber {
  id: string;
  phone_number: string;
  agent_id: string;
  telephony_provider: string;
  rented: boolean;
  price: string;
  created_at: string;
  renewal_at: string;
}

interface Batch {
  batch_id: string;
  status: string;
  scheduled_at: string | null;
  created_at: string;
}

const jsonResult = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

export function registerReadTools(server: McpServer) {
  server.registerTool(
    "list_agents",
    {
      title: "List agents",
      description:
        "Lists voice AI agents in the connected Bolna account with their IDs, names, statuses, and creation dates. Use this to find an agent's ID before fetching details, updating it, or placing a call. Paginated.",
      inputSchema: {
        page_number: pageNumberSchema,
        page_size: pageSizeSchema,
      },
      annotations: { title: "List agents", readOnlyHint: true, openWorldHint: true },
    },
    async ({ page_number, page_size }, extra) => {
      const apiKey = getApiKey(extra as any);
      try {
        const agents = await bolnaFetch<
          Array<{ id: string; agent_name: string; agent_status: string; created_at: string }>
        >("/v2/agent/all", apiKey);
        const page = paginate(agents, page_number, page_size);
        const summaries: AgentV2Summary[] = page.map((a) => ({
          id: a.id,
          agent_name: a.agent_name,
          agent_status: a.agent_status,
          created_at: a.created_at,
        }));
        return jsonResult({
          page_number,
          page_size,
          total: agents.length,
          agents: summaries,
        });
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "get_agent",
    {
      title: "Get agent details",
      description:
        "Retrieves the full configuration of a single Bolna voice AI agent by ID, including prompts, model settings, voice settings, and tasks. Use list_agents first if the agent ID is unknown.",
      inputSchema: {
        agent_id: agentIdSchema,
      },
      annotations: { title: "Get agent details", readOnlyHint: true, openWorldHint: true },
    },
    async ({ agent_id }, extra) => {
      const apiKey = getApiKey(extra as any);
      try {
        const agent = await bolnaFetch(
          `/v2/agent/${encodeURIComponent(agent_id)}`,
          apiKey
        );
        return jsonResult(agent);
      } catch (err) {
        return toErrorResult(err, { agentId: agent_id });
      }
    }
  );

  server.registerTool(
    "list_agent_executions",
    {
      title: "List agent call history",
      description:
        "Lists past call executions for a specific Bolna agent, including call status, duration, and timestamps. Use this to review an agent's call history or find an execution ID for transcript lookup. Paginated. Defaults to the last 7 days if from/to are not given (the Bolna API requires a date range no wider than 7 days).",
      inputSchema: {
        agent_id: agentIdSchema,
        from: z
          .string()
          .datetime({ message: "from must be an ISO 8601 UTC timestamp" })
          .optional(),
        to: z
          .string()
          .datetime({ message: "to must be an ISO 8601 UTC timestamp" })
          .optional(),
        page_number: pageNumberSchema,
        page_size: pageSizeSchema,
      },
      annotations: { title: "List agent call history", readOnlyHint: true, openWorldHint: true },
    },
    async ({ agent_id, from, to, page_number, page_size }, extra) => {
      const apiKey = getApiKey(extra as any);
      try {
        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const toParam = to ?? now.toISOString();
        const fromParam = from ?? sevenDaysAgo.toISOString();

        const page = await bolnaFetch<AgentExecutionsPage>(
          `/v2/agent/${encodeURIComponent(agent_id)}/executions`,
          apiKey,
          {
            query: {
              from: fromParam,
              to: toParam,
              page_number,
              page_size,
            },
          }
        );

        const summaries = page.data.map((e) => ({
          id: e.id,
          status: e.status,
          conversation_duration: e.conversation_duration,
          created_at: e.created_at,
          telephony_data: e.telephony_data
            ? {
                to_number: e.telephony_data.to_number,
                from_number: e.telephony_data.from_number,
                provider: e.telephony_data.provider,
              }
            : undefined,
        }));

        return jsonResult({
          agent_id,
          from: fromParam,
          to: toParam,
          page_number: page.page_number,
          page_size: page.page_size,
          total: page.total,
          has_more: page.has_more,
          executions: summaries,
        });
      } catch (err) {
        return toErrorResult(err, { agentId: agent_id });
      }
    }
  );

  server.registerTool(
    "get_execution",
    {
      title: "Get call details",
      description:
        "Retrieves full details of a single call execution by ID, including the conversation transcript, call status, duration, telephony data, and cost. Use list_agent_executions to find execution IDs.",
      inputSchema: {
        execution_id: executionIdSchema,
      },
      annotations: { title: "Get call details", readOnlyHint: true, openWorldHint: true },
    },
    async ({ execution_id }, extra) => {
      const apiKey = getApiKey(extra as any);
      try {
        const execution = await bolnaFetch(
          `/executions/${encodeURIComponent(execution_id)}`,
          apiKey
        );
        return jsonResult(execution);
      } catch (err) {
        return toErrorResult(err, { executionId: execution_id });
      }
    }
  );

  server.registerTool(
    "list_phone_numbers",
    {
      title: "List phone numbers",
      description:
        "Lists all phone numbers in the connected Bolna account, including the telephony provider and creation date. Use this to find a from-number when placing outbound calls or to check available numbers.",
      inputSchema: {},
      annotations: { title: "List phone numbers", readOnlyHint: true, openWorldHint: true },
    },
    async (_args, extra) => {
      const apiKey = getApiKey(extra as any);
      try {
        const numbers = await bolnaFetch<
          Array<{
            id: string;
            phone_number: string;
            agent_id: string;
            telephony_provider: string;
            rented: boolean;
            price: string;
            created_at: string;
            renewal_at: string;
          }>
        >("/phone-numbers/all", apiKey);
        const trimmed: PhoneNumber[] = numbers.map((n) => ({
          id: n.id,
          phone_number: n.phone_number,
          agent_id: n.agent_id,
          telephony_provider: n.telephony_provider,
          rented: n.rented,
          price: n.price,
          created_at: n.created_at,
          renewal_at: n.renewal_at,
        }));
        return jsonResult({ phone_numbers: trimmed });
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "list_batches",
    {
      title: "List call batches",
      description:
        "Lists call batches for a specific Bolna agent, including batch status and schedule. Read-only; batch creation and scheduling are not available through this connector yet.",
      inputSchema: {
        agent_id: agentIdSchema,
        page_number: pageNumberSchema,
        page_size: pageSizeSchema,
      },
      annotations: { title: "List call batches", readOnlyHint: true, openWorldHint: true },
    },
    async ({ agent_id, page_number, page_size }, extra) => {
      const apiKey = getApiKey(extra as any);
      try {
        const batches = await bolnaFetch<
          Array<{
            batch_id: string;
            status: string;
            scheduled_at: string | null;
            created_at: string;
          }>
        >(`/batches/${encodeURIComponent(agent_id)}/all`, apiKey);
        const page = paginate(batches, page_number, page_size);
        const summaries: Batch[] = page.map((b) => ({
          batch_id: b.batch_id,
          status: b.status,
          scheduled_at: b.scheduled_at,
          created_at: b.created_at,
        }));
        return jsonResult({
          agent_id,
          page_number,
          page_size,
          total: batches.length,
          batches: summaries,
        });
      } catch (err) {
        return toErrorResult(err, { agentId: agent_id });
      }
    }
  );

  server.registerTool(
    "get_user_info",
    {
      title: "Get account info",
      description:
        "Retrieves the connected Bolna account's profile, current wallet balance, and concurrency limits. Use this to check remaining balance before placing calls.",
      inputSchema: {},
      annotations: { title: "Get account info", readOnlyHint: true, openWorldHint: true },
    },
    async (_args, extra) => {
      const apiKey = getApiKey(extra as any);
      try {
        const user = await bolnaFetch("/user/me", apiKey);
        return jsonResult(user);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
