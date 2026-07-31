import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Bolna's docs run on Mintlify: llms.txt lists every page as
// `- [Title](https://www.bolna.ai/docs/path.md): Description`, and every
// page URL with a `.md` suffix returns raw markdown (confirmed live
// 2026-07-31: content-type: text/markdown). search_docs parses that index
// for lookup; get_doc fetches a single page's markdown. Both are read-only
// and don't touch a Bolna account, so no API key is involved.
const DOCS_HOST = "www.bolna.ai";
const DOCS_PATH_PREFIX = "/docs";
const LLMS_TXT_URL = `https://${DOCS_HOST}${DOCS_PATH_PREFIX}/llms.txt`;

interface DocEntry {
  title: string;
  url: string;
  description: string;
}

// The index rarely changes; cache it in memory for the life of the
// serverless instance instead of refetching 70KB+ of text on every search.
let cachedIndex: { entries: DocEntry[]; fetchedAt: number } | null = null;
const INDEX_TTL_MS = 10 * 60 * 1000;

async function getDocsIndex(): Promise<DocEntry[]> {
  if (cachedIndex && Date.now() - cachedIndex.fetchedAt < INDEX_TTL_MS) {
    return cachedIndex.entries;
  }

  const res = await fetch(LLMS_TXT_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch Bolna docs index (HTTP ${res.status})`);
  }
  const text = await res.text();

  const entries: DocEntry[] = [];
  const lineRe = /^-\s*\[([^\]]+)\]\(([^)]+)\):\s*(.*)$/;
  for (const line of text.split("\n")) {
    const match = lineRe.exec(line.trim());
    if (!match) continue;
    const [, title, url, description] = match;
    if (!title || !url) continue;
    entries.push({ title, url, description: description ?? "" });
  }

  cachedIndex = { entries, fetchedAt: Date.now() };
  return entries;
}

function scoreEntry(entry: DocEntry, queryWords: string[]): number {
  const haystack = `${entry.title} ${entry.description} ${entry.url}`.toLowerCase();
  return queryWords.reduce((score, word) => (haystack.includes(word) ? score + 1 : score), 0);
}

/**
 * Resolves user input (a bare topic, a /docs path, or a full URL from
 * search_docs) to a fetchable Bolna docs .md URL. Only ever targets
 * www.bolna.ai/docs/* — never an arbitrary host, to avoid this becoming an
 * open URL fetcher.
 */
function resolveDocUrl(input: string): string {
  let path = input.trim();

  if (path.startsWith("http://") || path.startsWith("https://")) {
    const parsed = new URL(path);
    if (parsed.hostname !== DOCS_HOST && parsed.hostname !== "bolna.ai") {
      throw new Error(
        `Only Bolna documentation pages (${DOCS_HOST}) can be fetched with this tool.`
      );
    }
    path = parsed.pathname;
  }

  if (!path.startsWith("/")) path = `/${path}`;
  if (!path.startsWith(DOCS_PATH_PREFIX)) path = `${DOCS_PATH_PREFIX}${path}`;
  if (!path.endsWith(".md")) path = `${path}.md`;

  return `https://${DOCS_HOST}${path}`;
}

const jsonResult = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
});

export function registerDocsTools(server: McpServer) {
  server.registerTool(
    "search_docs",
    {
      title: "Search Bolna documentation",
      description:
        "Searches the Bolna documentation site for pages matching a query. Returns matching page titles, URLs, and descriptions. Use get_doc with a result's URL to fetch the full page content.",
      inputSchema: {
        query: z.string().min(1, "query is required"),
        limit: z.number().int().min(1).max(20).optional().default(8),
      },
      annotations: { title: "Search Bolna documentation", readOnlyHint: true, openWorldHint: true },
    },
    async ({ query, limit }) => {
      try {
        const entries = await getDocsIndex();
        const queryWords = query.toLowerCase().split(/\s+/).filter(Boolean);
        const results = entries
          .map((entry) => ({ entry, score: scoreEntry(entry, queryWords) }))
          .filter((r) => r.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit)
          .map((r) => r.entry);

        return jsonResult({ query, results });
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: err instanceof Error ? err.message : "Failed to search Bolna documentation.",
            },
          ],
          isError: true as const,
        };
      }
    }
  );

  server.registerTool(
    "get_doc",
    {
      title: "Get Bolna documentation page",
      description:
        "Fetches the full content of a Bolna documentation page as markdown, given a URL or path from search_docs (or a guessed /docs path). Use search_docs first if the exact page is unknown.",
      inputSchema: {
        url: z.string().min(1, "url is required"),
      },
      annotations: { title: "Get Bolna documentation page", readOnlyHint: true, openWorldHint: true },
    },
    async ({ url }) => {
      let resolvedUrl: string;
      try {
        resolvedUrl = resolveDocUrl(url);
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: (err as Error).message }],
          isError: true as const,
        };
      }

      try {
        const res = await fetch(resolvedUrl);
        if (!res.ok) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Doc page not found (HTTP ${res.status}): ${resolvedUrl}. Use search_docs to find the correct URL.`,
              },
            ],
            isError: true as const,
          };
        }
        const markdown = await res.text();
        return textResult(markdown);
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to fetch Bolna documentation page: ${
                err instanceof Error ? err.message : String(err)
              }`,
            },
          ],
          isError: true as const,
        };
      }
    }
  );
}
