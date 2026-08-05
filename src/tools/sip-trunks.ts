import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bolnaFetch } from "../lib/bolna-client";
import { toErrorResult } from "../lib/errors";
import { getApiKey } from "../lib/auth";
import { apiKeyOverrideSchema, trunkIdSchema } from "./schemas";

const jsonResult = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

// Confirmed live 2026-08-05 against a real account: a number added via
// add_trunk_number can take a couple of seconds to become visible to
// list_trunk_numbers/remove_trunk_number (both returned empty/500
// immediately after adding; retrying a few seconds later succeeded). Not a
// bug here — Bolna's backend has a brief propagation delay after adding a
// trunk number.

const errorResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  isError: true as const,
});

const gatewaySchema = z.object({
  gateway_address: z.string().min(1, "gateway_address is required"),
  port: z.number().int().optional().default(5060),
  priority: z.number().int().optional().default(1),
});

const ipIdentifierSchema = z.object({
  ip_address: z.string().min(1, "ip_address is required"),
});

const transportSchema = z.enum(["transport-udp", "transport-tcp", "transport-tls"]);
const mediaEncryptionSchema = z.enum(["no", "sdes"]);

const trunkPhoneNumberSchema = z.object({
  phone_number: z.string().min(1, "phone_number is required"),
  name: z.string().optional(),
  e164_check_enabled: z.boolean().optional().default(false),
});

// media_encryption "sdes" (SRTP) only works over transport-tls — Bolna's API
// rejects the mismatch, checked here first for a clearer error message.
function validateEncryptionTransport(
  media_encryption: string | undefined,
  transport: string | undefined
): string | null {
  if (media_encryption === "sdes" && transport !== "transport-tls") {
    return "media_encryption 'sdes' requires transport to be 'transport-tls'.";
  }
  return null;
}

export function registerSipTrunksTools(server: McpServer) {
  server.registerTool(
    "create_sip_trunk",
    {
      title: "Create SIP trunk",
      description:
        "Creates a new SIP trunk (bring-your-own-telephony) with gateway and authentication details. Use auth_type 'userpass' with auth_username/auth_password, or 'ip-based' with ip_identifiers. media_encryption 'sdes' requires transport 'transport-tls'.",
      inputSchema: {
        name: z.string().min(1, "name is required"),
        provider: z.string().min(1, "provider is required"),
        description: z.string().optional(),
        auth_type: z.enum(["userpass", "ip-based"]),
        auth_username: z.string().optional(),
        auth_password: z.string().optional(),
        gateways: z.array(gatewaySchema).min(1, "at least one gateway is required"),
        ip_identifiers: z.array(ipIdentifierSchema).optional(),
        allow: z.string().optional().default("ulaw,alaw"),
        disallow: z.string().optional().default("all"),
        transport: transportSchema.optional().default("transport-udp"),
        direct_media: z.boolean().optional().default(false),
        rtp_symmetric: z.boolean().optional().default(true),
        force_rport: z.boolean().optional().default(true),
        media_encryption: mediaEncryptionSchema.optional().default("no"),
        media_encryption_optimistic: z.boolean().optional().default(false),
        qualify_frequency: z.number().int().optional().default(60),
        inbound_enabled: z.boolean().optional().default(false),
        outbound_leading_plus_enabled: z.boolean().optional().default(true),
        phone_numbers: z.array(trunkPhoneNumberSchema).optional(),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Create SIP trunk", readOnlyHint: false, destructiveHint: false },
    },
    async (args, extra) => {
      if (args.auth_type === "userpass" && (!args.auth_username || !args.auth_password)) {
        return errorResult("auth_username and auth_password are required when auth_type is 'userpass'.");
      }
      if (args.auth_type === "ip-based" && (!args.ip_identifiers || args.ip_identifiers.length === 0)) {
        return errorResult("ip_identifiers is required when auth_type is 'ip-based'.");
      }
      const encryptionError = validateEncryptionTransport(args.media_encryption, args.transport);
      if (encryptionError) return errorResult(encryptionError);

      const { api_key, ...body } = args;
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch("/sip-trunks/trunks", apiKey, {
          method: "POST",
          body,
        });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "get_sip_trunk",
    {
      title: "Get SIP trunk",
      description: "Retrieves full details of a single SIP trunk by ID.",
      inputSchema: { trunk_id: trunkIdSchema, api_key: apiKeyOverrideSchema() },
      annotations: { title: "Get SIP trunk", readOnlyHint: true, openWorldHint: true },
    },
    async ({ trunk_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(`/sip-trunks/trunks/${encodeURIComponent(trunk_id)}`, apiKey);
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "list_sip_trunks",
    {
      title: "List SIP trunks",
      description: "Lists all SIP trunks on the account, optionally filtered by active status.",
      inputSchema: { is_active: z.boolean().optional(), api_key: apiKeyOverrideSchema() },
      annotations: { title: "List SIP trunks", readOnlyHint: true, openWorldHint: true },
    },
    async ({ is_active, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch("/sip-trunks/trunks", apiKey, { query: { is_active: is_active === undefined ? undefined : String(is_active) } });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "update_sip_trunk",
    {
      title: "Update SIP trunk",
      description:
        "Partially updates a SIP trunk. gateways and ip_identifiers, if provided, fully replace the existing list rather than merging — resend the complete array. provider and auth_type cannot be changed after creation.",
      inputSchema: {
        trunk_id: trunkIdSchema,
        name: z.string().optional(),
        description: z.string().optional(),
        auth_username: z.string().optional(),
        auth_password: z.string().optional(),
        gateways: z.array(gatewaySchema).optional(),
        ip_identifiers: z.array(ipIdentifierSchema).optional(),
        allow: z.string().optional(),
        disallow: z.string().optional(),
        inbound_enabled: z.boolean().optional(),
        outbound_leading_plus_enabled: z.boolean().optional(),
        is_active: z.boolean().optional(),
        qualify_frequency: z.number().int().optional(),
        transport: transportSchema.optional(),
        media_encryption: mediaEncryptionSchema.optional(),
        media_encryption_optimistic: z.boolean().optional(),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Update SIP trunk", readOnlyHint: false, destructiveHint: true },
    },
    async ({ trunk_id, api_key, ...fields }, extra) => {
      const encryptionError = validateEncryptionTransport(fields.media_encryption, fields.transport);
      if (encryptionError) return errorResult(encryptionError);

      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(`/sip-trunks/trunks/${encodeURIComponent(trunk_id)}`, apiKey, {
          method: "PATCH",
          body: fields,
        });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "delete_sip_trunk",
    {
      title: "Delete SIP trunk",
      description:
        "Permanently deletes a SIP trunk and cascades to all its gateways, IP identifiers, and phone numbers.",
      inputSchema: { trunk_id: trunkIdSchema, api_key: apiKeyOverrideSchema() },
      annotations: { title: "Delete SIP trunk", readOnlyHint: false, destructiveHint: true },
    },
    async ({ trunk_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(`/sip-trunks/trunks/${encodeURIComponent(trunk_id)}`, apiKey, {
          method: "DELETE",
        });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "add_trunk_number",
    {
      title: "Add number to SIP trunk",
      description:
        "Adds a DID phone number to a SIP trunk. After adding, patch the agent's telephony provider to 'sip-trunk' (via update_agent) to actually route calls through this number.",
      inputSchema: {
        trunk_id: trunkIdSchema,
        phone_number: z.string().min(1, "phone_number is required"),
        name: z.string().optional(),
        e164_check_enabled: z.boolean().optional().default(false),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Add number to SIP trunk", readOnlyHint: false, destructiveHint: false },
    },
    async ({ trunk_id, api_key, ...fields }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(
          `/sip-trunks/trunks/${encodeURIComponent(trunk_id)}/numbers`,
          apiKey,
          { method: "POST", body: fields }
        );
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "remove_trunk_number",
    {
      title: "Remove number from SIP trunk",
      description:
        "Removes a phone number from a SIP trunk. If it was mapped to an agent, that mapping is removed too.",
      inputSchema: {
        trunk_id: trunkIdSchema,
        phone_number_id: z.string().min(1, "phone_number_id is required"),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Remove number from SIP trunk", readOnlyHint: false, destructiveHint: true },
    },
    async ({ trunk_id, phone_number_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(
          `/sip-trunks/trunks/${encodeURIComponent(trunk_id)}/numbers/${encodeURIComponent(phone_number_id)}`,
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
    "list_trunk_numbers",
    {
      title: "List numbers on SIP trunk",
      description: "Lists all phone numbers assigned to a SIP trunk.",
      inputSchema: { trunk_id: trunkIdSchema, api_key: apiKeyOverrideSchema() },
      annotations: { title: "List numbers on SIP trunk", readOnlyHint: true, openWorldHint: true },
    },
    async ({ trunk_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(
          `/sip-trunks/trunks/${encodeURIComponent(trunk_id)}/numbers`,
          apiKey
        );
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
