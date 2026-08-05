import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bolnaFetch } from "../lib/bolna-client";
import { toErrorResult } from "../lib/errors";
import { getApiKey } from "../lib/auth";
import { apiKeyOverrideSchema } from "./schemas";

const jsonResult = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

export function registerVoiceTools(server: McpServer) {
  server.registerTool(
    "list_tts_providers",
    {
      title: "List TTS providers and models",
      description:
        "Lists every text-to-speech provider and model Bolna supports for a BCP-47 language code (e.g. 'en', 'hi'). Returns provider and model IDs needed by list_voices, plus any custom voices already on the account. Despite the docs implying it's optional, the live API requires language — confirmed live 2026-08-05.",
      inputSchema: {
        language: z.string().min(1, "language is required (e.g. 'en', 'hi')"),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "List TTS providers and models", readOnlyHint: true, openWorldHint: true },
    },
    async ({ language, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch("/api/v1/voice-config/tts", apiKey, {
          query: { language },
        });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );

  server.registerTool(
    "list_voices",
    {
      title: "List TTS voices",
      description:
        "Lists available voices for a specific TTS provider, model, and BCP-47 language code. Call list_tts_providers first to get the required provider_id and model_id. Despite the docs implying language is optional, the live API requires it — confirmed live 2026-08-05.",
      inputSchema: {
        provider_id: z.string().min(1, "provider_id is required"),
        model_id: z.string().min(1, "model_id is required"),
        language: z.string().min(1, "language is required (e.g. 'en', 'hi')"),
        page: z.number().int().min(1).optional().default(1),
        page_size: z.number().int().min(1).max(100).optional().default(100),
        api_key: apiKeyOverrideSchema(),
      },
      annotations: { title: "List TTS voices", readOnlyHint: true, openWorldHint: true },
    },
    async ({ provider_id, model_id, language, page, page_size, api_key }, extra) => {
      const apiKey = getApiKey(extra as any, api_key);
      try {
        const result = await bolnaFetch("/api/v1/voice-config/tts/voices", apiKey, {
          query: { provider_id, model_id, language, page, page_size },
        });
        return jsonResult(result);
      } catch (err) {
        return toErrorResult(err);
      }
    }
  );
}
