/**
 * SIP trunks: a tenant's own carrier connected to Bolna's SIP edge, at
 * `/trunk/...` on api.bolna.ai. Schemas mirror dashboard-backend's
 * trunk/schemas.py (TrunkCreate, TrunkUpdate, GatewayIn, IpAclIn, NumberIn,
 * NumberAgentIn, TestCallIn, TestInboundIn); paths mirror trunk/routes.py.
 *
 * The legacy Asterisk trunks at `/sip-trunks/...` stay in sip-trunks.ts.
 * `/trunk/admin` and `/trunk/ui-mode` are dashboard-only and not exposed.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bolnaFetch } from "../lib/bolna-client";
import { toErrorResult } from "../lib/errors";
import { getApiKey } from "../lib/auth";
import { apiKeyOverrideSchema, e164Phone, trunkIdSchema } from "./schemas";

const jsonResult = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data) }],
});

const errorResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  isError: true as const,
});

const PRESETS = ["plivo", "telnyx", "twilio", "exotel", "vobiz", "vonage", "custom"] as const;
const CODECS = ["PCMU", "PCMA"] as const;
// The API also accepts "tls" in its enum and then rejects it as unsupported.
const TRANSPORTS = ["udp", "tcp"] as const;
const CALL_DIRECTIONS = ["all", "inbound", "outbound", "failed"] as const;

const MAX_GATEWAYS = 8;
const MAX_IP_ACLS = 32;
const MAX_CHANNELS = 1000;
const MAX_PRIORITY = 100;
const MAX_CALLS_LIMIT = 100;

const gatewayIdSchema = z.string().min(1, "gateway_id is required");
const aclIdSchema = z.string().min(1, "acl_id is required");
const numberIdSchema = z.string().min(1, "number_id is required");

// Factories rather than shared instances, for the $ref-collapsing reason
// documented on e164Phone in schemas.ts.
function presetSchema() {
  return z
    .enum(PRESETS)
    .describe("Carrier label; custom covers any other standards-based SIP carrier. A label only: no gateway or carrier IP is filled in from it.");
}

function transportSchema() {
  return z.enum(TRANSPORTS).describe("Transport for outbound calls to the carrier's gateways. Default udp.");
}

function codecsSchema() {
  return z
    .array(z.enum(CODECS))
    .min(1, "at least one codec is required")
    .describe('Codecs offered on outbound calls. Default ["PCMU", "PCMA"].');
}

function gatewaySchema() {
  return z.object({
    host: z.string().min(1, "host is required").describe("The carrier's SIP host: an IPv4 address or DNS name."),
    port: z.number().int().min(1).max(65535).optional().describe("Default 5060."),
    priority: z
      .number()
      .int()
      .min(0)
      .max(MAX_PRIORITY)
      .optional()
      .describe("Lowest is tried first. Default 0."),
  });
}

function credentialSchema() {
  return z.string().min(1);
}

// The carrier-issued pair is set together or cleared together; the API
// rejects anything else, checked here first for a clearer message.
function credentialsError(username: string | null | undefined, password: string | null | undefined): string | null {
  if ((username === undefined) !== (password === undefined) || (username === null) !== (password === null)) {
    return "auth_username and auth_password are set together, or both set to null to clear them.";
  }
  return null;
}

// The API takes codecs as one comma-separated string.
const joinCodecs = (codecs: string[] | undefined) => codecs?.join(",");

const trunkPath = (trunkId: string) => `/trunk/trunks/${encodeURIComponent(trunkId)}`;

export function registerTrunksTools(server: McpServer) {
  server.registerTool(
    "list_trunks",
    {
      title: "List SIP trunks",
      description:
        "Lists the SIP trunks on the account, each with its health, gateways, carrier IPs (ip_acls) and numbers. Use a trunk's id with the other trunk tools.",
      inputSchema: { api_key: apiKeyOverrideSchema() },
      annotations: { title: "List SIP trunks", readOnlyHint: true, openWorldHint: true },
    },
    async ({ api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch("/trunk/trunks", apiKey);
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "get_trunk",
    {
      title: "Get SIP trunk",
      description:
        "Retrieves one SIP trunk: its settings, health (ready, waiting_for_carrier, degraded or disabled), active call count, gateways, carrier IPs (ip_acls) and numbers. The ids in gateways, ip_acls and numbers are what the remove and assign tools take.",
      inputSchema: { trunk_id: trunkIdSchema, api_key: apiKeyOverrideSchema() },
      annotations: { title: "Get SIP trunk", readOnlyHint: true, openWorldHint: true },
    },
    async ({ trunk_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(trunkPath(trunk_id), apiKey);
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "create_trunk",
    {
      title: "Create SIP trunk",
      description:
        "Creates a SIP trunk that connects your own carrier to Bolna. For inbound calls add the carrier's signalling IPs (add_trunk_carrier_ip), for outbound a gateway (add_trunk_gateway) plus any carrier-issued auth_username/auth_password, then your numbers (add_number_to_trunk); get_trunk_connection_details lists the values to configure at the carrier.",
      inputSchema: {
        name: z.string().min(1, "name is required").max(100),
        description: z.string().max(500).optional(),
        preset: presetSchema().optional(),
        inbound_enabled: z.boolean().optional().describe("Default true."),
        outbound_enabled: z.boolean().optional().describe("Default true."),
        channels: z
          .number()
          .int()
          .min(1)
          .max(MAX_CHANNELS)
          .optional()
          .describe("Concurrent calls the trunk carries. Default 10."),
        default_inbound_agent_id: z
          .string()
          .optional()
          .describe("Agent that answers inbound calls to a number with no agent of its own."),
        auth_username: credentialSchema()
          .optional()
          .describe("Digest username your carrier issued for outbound calls. Set with auth_password."),
        auth_password: credentialSchema().optional().describe("Write-only; never returned."),
        transport: transportSchema().optional(),
        outbound_leading_plus_enabled: z
          .boolean()
          .optional()
          .describe("Send dialled numbers with a leading +. Default false."),
        codecs: codecsSchema().optional(),
        gateways: z.array(gatewaySchema()).max(MAX_GATEWAYS).optional(),
        ip_acls: z
          .array(z.string().min(1))
          .max(MAX_IP_ACLS)
          .optional()
          .describe("Carrier signalling IPs or CIDRs allowed to send inbound calls."),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Create SIP trunk", readOnlyHint: false, destructiveHint: false },
    },
    async ({ api_key, codecs, ...fields }, extra) => {
      const credentials = credentialsError(fields.auth_username, fields.auth_password);
      if (credentials) return errorResult(credentials);

      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch("/trunk/trunks", apiKey, {
          method: "POST",
          body: { ...fields, codecs: joinCodecs(codecs) },
        });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "update_trunk",
    {
      title: "Update SIP trunk",
      description:
        "Partially updates a SIP trunk's settings; only the fields you pass change. Gateways, carrier IPs and numbers have their own add and remove tools; pass null to clear description, preset, default_inbound_agent_id, or both credentials together.",
      inputSchema: {
        trunk_id: trunkIdSchema,
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(500).nullable().optional(),
        preset: presetSchema().nullable().optional(),
        is_active: z.boolean().optional().describe("false stops all calls on the trunk."),
        inbound_enabled: z.boolean().optional(),
        outbound_enabled: z.boolean().optional(),
        channels: z.number().int().min(1).max(MAX_CHANNELS).optional(),
        default_inbound_agent_id: z.string().nullable().optional(),
        auth_username: credentialSchema().nullable().optional(),
        auth_password: credentialSchema().nullable().optional(),
        transport: transportSchema().optional(),
        outbound_leading_plus_enabled: z.boolean().optional(),
        codecs: codecsSchema().optional(),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Update SIP trunk", readOnlyHint: false, destructiveHint: true },
    },
    async ({ trunk_id, api_key, codecs, ...fields }, extra) => {
      const body = { ...fields, codecs: joinCodecs(codecs) };
      if (Object.values(body).every((value) => value === undefined)) {
        return errorResult("Provide at least one field to update.");
      }
      const credentials = credentialsError(fields.auth_username, fields.auth_password);
      if (credentials) return errorResult(credentials);

      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(trunkPath(trunk_id), apiKey, { method: "PATCH", body });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "delete_trunk",
    {
      title: "Delete SIP trunk",
      description:
        "Permanently deletes a SIP trunk with its gateways, carrier IPs and numbers; calls to and from those numbers stop working.",
      inputSchema: { trunk_id: trunkIdSchema, api_key: apiKeyOverrideSchema() },
      annotations: { title: "Delete SIP trunk", readOnlyHint: false, destructiveHint: true },
    },
    async ({ trunk_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(trunkPath(trunk_id), apiKey, { method: "DELETE" });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "add_trunk_gateway",
    {
      title: "Add gateway to SIP trunk",
      description: `Adds an outbound gateway: the carrier's SIP host that Bolna sends calls to. Gateways are tried lowest priority first, moving to the next when the carrier answers with a retryable failure; at most ${MAX_GATEWAYS} per trunk.`,
      inputSchema: {
        trunk_id: trunkIdSchema,
        ...gatewaySchema().shape,
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Add gateway to SIP trunk", readOnlyHint: false, destructiveHint: false },
    },
    async ({ trunk_id, api_key, ...gateway }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(`${trunkPath(trunk_id)}/gateways`, apiKey, {
          method: "POST",
          body: gateway,
        });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "remove_trunk_gateway",
    {
      title: "Remove gateway from SIP trunk",
      description: "Removes an outbound gateway from a SIP trunk. Get gateway_id from get_trunk's gateways.",
      inputSchema: { trunk_id: trunkIdSchema, gateway_id: gatewayIdSchema, api_key: apiKeyOverrideSchema() },
      annotations: { title: "Remove gateway from SIP trunk", readOnlyHint: false, destructiveHint: true },
    },
    async ({ trunk_id, gateway_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(
          `${trunkPath(trunk_id)}/gateways/${encodeURIComponent(gateway_id)}`,
          apiKey,
          { method: "DELETE" }
        );
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "add_trunk_carrier_ip",
    {
      title: "Add carrier IP to SIP trunk",
      description: `Allows a carrier signalling IP or CIDR (public IPv4, /16 or narrower) to send inbound calls to this trunk; calls from any other source are refused with SIP 403. At most ${MAX_IP_ACLS} per trunk.`,
      inputSchema: {
        trunk_id: trunkIdSchema,
        cidr: z.string().min(1, "cidr is required").describe("A bare IP such as 203.0.113.10, or a CIDR such as 203.0.113.0/24."),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Add carrier IP to SIP trunk", readOnlyHint: false, destructiveHint: false },
    },
    async ({ trunk_id, cidr, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(`${trunkPath(trunk_id)}/ip-acls`, apiKey, {
          method: "POST",
          body: { cidr },
        });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "remove_trunk_carrier_ip",
    {
      title: "Remove carrier IP from SIP trunk",
      description:
        "Removes a carrier IP from a SIP trunk, so the trunk stops accepting inbound calls from it. Get acl_id from get_trunk's ip_acls.",
      inputSchema: { trunk_id: trunkIdSchema, acl_id: aclIdSchema, api_key: apiKeyOverrideSchema() },
      annotations: { title: "Remove carrier IP from SIP trunk", readOnlyHint: false, destructiveHint: true },
    },
    async ({ trunk_id, acl_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(
          `${trunkPath(trunk_id)}/ip-acls/${encodeURIComponent(acl_id)}`,
          apiKey,
          { method: "DELETE" }
        );
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "add_number_to_trunk",
    {
      title: "Add number to SIP trunk",
      description:
        "Adds a phone number, in E.164 form (e.g. +918045678901), that your carrier routes to this trunk. For inbound, give it an agent here or with assign_trunk_number_agent; for outbound, set the agent's telephony_provider to 'trunk' (update_agent) and pass this number as from_phone_number to start_outbound_call.",
      inputSchema: {
        trunk_id: trunkIdSchema,
        e164: e164Phone(),
        destination_key: z
          .string()
          .min(1)
          .optional()
          .describe("What the carrier sends as the Request-URI user part for this number. Defaults to the E.164 digits without the +."),
        agent_id: z.string().optional().describe("Agent that answers inbound calls to this number."),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Add number to SIP trunk", readOnlyHint: false, destructiveHint: false },
    },
    async ({ trunk_id, e164, destination_key, agent_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(`${trunkPath(trunk_id)}/numbers`, apiKey, {
          method: "POST",
          body: { e164, destination_key: destination_key ?? e164.replace(/^\+/, ""), agent_id },
        });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "remove_number_from_trunk",
    {
      title: "Remove number from SIP trunk",
      description:
        "Removes a number from a SIP trunk: inbound calls to it are refused and it can no longer be a caller ID. Get number_id from get_trunk's numbers.",
      inputSchema: { trunk_id: trunkIdSchema, number_id: numberIdSchema, api_key: apiKeyOverrideSchema() },
      annotations: { title: "Remove number from SIP trunk", readOnlyHint: false, destructiveHint: true },
    },
    async ({ trunk_id, number_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(
          `${trunkPath(trunk_id)}/numbers/${encodeURIComponent(number_id)}`,
          apiKey,
          { method: "DELETE" }
        );
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "assign_trunk_number_agent",
    {
      title: "Assign agent to SIP trunk number",
      description:
        "Sets the agent that answers inbound calls to a trunk number, or pass agent_id null to unassign it. A number with no agent falls back to the trunk's default_inbound_agent_id; with neither, its inbound calls are refused.",
      inputSchema: {
        number_id: numberIdSchema.describe("From get_trunk's numbers."),
        agent_id: z.string().min(1).nullable().describe("The agent's id, or null to unassign."),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Assign agent to SIP trunk number", readOnlyHint: false, destructiveHint: true },
    },
    async ({ number_id, agent_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(`/trunk/numbers/${encodeURIComponent(number_id)}`, apiKey, {
          method: "PATCH",
          body: { agent_id },
        });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "list_trunk_calls",
    {
      title: "List SIP trunk calls",
      description:
        "Lists recent calls on a SIP trunk's numbers, newest first, with direction, far-end number, duration, outcome and SIP code; each execution_id works with get_execution. direction failed means calls where no conversation took place.",
      inputSchema: {
        trunk_id: trunkIdSchema,
        direction: z.enum(CALL_DIRECTIONS).optional().describe("Default all."),
        number: e164Phone().optional().describe("Only calls on this trunk number."),
        limit: z.number().int().min(1).max(MAX_CALLS_LIMIT).optional().describe("Default 50."),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "List SIP trunk calls", readOnlyHint: true, openWorldHint: true },
    },
    async ({ trunk_id, direction, number, limit, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(`${trunkPath(trunk_id)}/calls`, apiKey, {
          query: { direction, number, limit },
        });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "get_trunk_connection_details",
    {
      title: "Get SIP trunk connection details",
      description:
        "Returns the values to configure at your carrier: Bolna's SIP domain, the IPs to allowlist, the SIP port and transports, and the RTP media port range. The same for every trunk.",
      inputSchema: { api_key: apiKeyOverrideSchema() },
      annotations: { title: "Get SIP trunk connection details", readOnlyHint: true, openWorldHint: true },
    },
    async ({ api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch("/trunk/pop", apiKey);
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "start_trunk_test_call",
    {
      title: "Start SIP trunk test call",
      description:
        "Rings `to` through the trunk's gateway with an echo test: answer and you hear yourself back, for up to 60 seconds. No agent or execution is involved and Bolna does not bill it (your carrier may); at most 5 tests per trunk every 10 minutes, then poll get_trunk_test_call.",
      inputSchema: {
        trunk_id: trunkIdSchema,
        to: e164Phone().describe("The phone to ring."),
        from_number: e164Phone().optional().describe("Caller ID, a number on this trunk. Defaults to its first number."),
        gateway_id: z.string().min(1).optional().describe("Try only this gateway. Defaults to all, by priority."),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Start SIP trunk test call", readOnlyHint: false, destructiveHint: true },
    },
    async ({ trunk_id, to, from_number, gateway_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(`${trunkPath(trunk_id)}/test-call`, apiKey, {
          method: "POST",
          body: { to, from: from_number, gateway_id },
        });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "get_trunk_test_call",
    {
      title: "Get SIP trunk test call",
      description:
        "Reads an outbound test call's state (dialing, ringing, answered, completed or failed) with its SIP status and hangup cause. Omit test_id for the trunk's latest; results are kept for 15 minutes.",
      inputSchema: {
        trunk_id: trunkIdSchema,
        test_id: z.string().min(1).optional().describe("From start_trunk_test_call."),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Get SIP trunk test call", readOnlyHint: true, openWorldHint: true },
    },
    async ({ trunk_id, test_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      const suffix = test_id ? `/${encodeURIComponent(test_id)}` : "";
      try {
        const result = await bolnaFetch(`${trunkPath(trunk_id)}/test-call${suffix}`, apiKey);
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "arm_trunk_inbound_test",
    {
      title: "Arm SIP trunk inbound test",
      description:
        "For the next 5 minutes, answers the next inbound call on this trunk (or only on destination_key) with an echo test instead of an agent. Call one of the trunk's numbers from a phone, then read the result with get_trunk_inbound_test.",
      inputSchema: {
        trunk_id: trunkIdSchema,
        destination_key: z
          .string()
          .min(1)
          .optional()
          .describe("Only this number's destination key (from get_trunk's numbers). Defaults to any number on the trunk."),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Arm SIP trunk inbound test", readOnlyHint: false, destructiveHint: false },
    },
    async ({ trunk_id, destination_key, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(`${trunkPath(trunk_id)}/test-inbound`, apiKey, {
          method: "POST",
          body: { destination_key },
        });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "get_trunk_inbound_test",
    {
      title: "Get SIP trunk inbound test",
      description:
        "Reads whether the trunk is armed for an inbound test and how the test call went: state (waiting, ringing, answered, completed or failed), the caller, and its SIP status and hangup cause.",
      inputSchema: { trunk_id: trunkIdSchema, api_key: apiKeyOverrideSchema() },
      annotations: { title: "Get SIP trunk inbound test", readOnlyHint: true, openWorldHint: true },
    },
    async ({ trunk_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(`${trunkPath(trunk_id)}/test-inbound`, apiKey);
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "disarm_trunk_inbound_test",
    {
      title: "Disarm SIP trunk inbound test",
      description:
        "Cancels an inbound test so the trunk's inbound calls go to agents again; a test call already in progress is marked failed.",
      inputSchema: { trunk_id: trunkIdSchema, api_key: apiKeyOverrideSchema() },
      annotations: { title: "Disarm SIP trunk inbound test", readOnlyHint: false, destructiveHint: true },
    },
    async ({ trunk_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(`${trunkPath(trunk_id)}/test-inbound`, apiKey, { method: "DELETE" });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
