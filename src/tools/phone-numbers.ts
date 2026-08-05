import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bolnaFetch } from "../lib/bolna-client";
import { toErrorResult } from "../lib/errors";
import { getApiKey } from "../lib/auth";
import { apiKeyOverrideSchema, e164Phone, phoneNumberIdSchema } from "./schemas";

const jsonResult = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

const countrySchema = z.enum(["US", "IN"]);
const providerSchema = z.enum(["twilio", "plivo", "vobiz"]);

// Confirmed live 2026-08-05 with a real purchase: search_phone_numbers'
// `price` is in whole dollars (e.g. 5 = $5), but buy_phone_number's `price`
// on the same $5 number is in cents (500). list_phone_numbers separately
// returns price as a formatted string ("$5.0"). Passed through as-is below
// — not normalized, since each field genuinely means something different on
// the live API despite the docs not calling out the unit mismatch.

export function registerPhoneNumbersTools(server: McpServer) {
  server.registerTool(
    "search_phone_numbers",
    {
      title: "Search available phone numbers",
      description:
        "Searches phone numbers available for purchase in a country, optionally filtered by a 3-character prefix pattern or provider. Use buy_phone_number with a result's phone_number to purchase one.",
      inputSchema: {
        country: countrySchema,
        pattern: z.string().length(3, "pattern must be a 3-character prefix").optional(),
        provider: providerSchema.optional(),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Search available phone numbers", readOnlyHint: true, openWorldHint: true },
    },
    async ({ country, pattern, provider, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch("/phone-numbers/search", apiKey, {
          query: { country, pattern, provider },
        });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "buy_phone_number",
    {
      title: "Buy phone number",
      description:
        "Purchases a phone number found via search_phone_numbers. This commits the account to a real, recurring charge (around $5/month per number) that continues until the number is removed with delete_phone_number. Not reversible after purchase.",
      inputSchema: {
        country: countrySchema,
        phone_number: e164Phone(),
        provider: providerSchema.optional(),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Buy phone number", readOnlyHint: false, destructiveHint: true },
    },
    async ({ country, phone_number, provider, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch("/phone-numbers/buy", apiKey, {
          method: "POST",
          body: { country, phone_number, provider },
        });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "delete_phone_number",
    {
      title: "Delete phone number",
      description:
        "Removes a purchased phone number from the account and stops its recurring billing. Permanent: the number is not guaranteed to be recoverable afterward.",
      inputSchema: {
        phone_number_id: phoneNumberIdSchema,
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "Delete phone number", readOnlyHint: false, destructiveHint: true },
    },
    async ({ phone_number_id, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch(
          `/phone-numbers/${encodeURIComponent(phone_number_id)}`,
          apiKey,
          { method: "DELETE" }
        );
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
