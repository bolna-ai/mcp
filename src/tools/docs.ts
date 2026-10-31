import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Bolna's docs run on Mintlify: llms.txt lists every page as
// `- [Title](https://www.bolna.ai/docs/path.md): Description`, and every
// page URL with a `.md` suffix returns raw markdown (confirmed live
// 2026-07-31: content-type: text/markdown). search_docs parses that index
// for lookup; get_doc fetches a single page's markdown. Both are read-only
// and don't touch a Bolna account, so no API key is involved.
//
// Every page therefore has two URLs, and they are not interchangeable:
//   - `/docs/path.md`  -> text/markdown, the raw source. For machines.
//   - `/docs/path`     -> text/html, the published page. For people.
// search_docs results get read back to a human (in Ask Bolna, in Claude
// Desktop), and a `.md` link is a dead end there: it renders as unstyled
// markdown with no nav, search or images. So the index stores the page
// form, and get_doc converts back to `.md` when it fetches.
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

/**
 * The published page URL for a docs entry: `/docs/path.md` -> `/docs/path`.
 * This is the form that gets shown to and clicked by a human, so it is what
 * search_docs returns. get_doc's resolveDocUrl reverses it.
 */
function toPageUrl(url: string): string {
  return url.replace(/\.mdx?$/, "");
}

// Mintlify only inlines part of the site in llms.txt; whole tabs are
// collapsed into `- [Voice Agents (156 pages)](.../_llms/voice-agents.txt)`
// sub-indexes (seen live 2026-10-12). Those must be followed, or every page
// behind them — workflows, AiSensy, graph agents — is invisible to search.
const SUB_INDEX_RE = /\/_llms\/[^/]+\.txt$/;
const MAX_SUB_INDEXES = 20;

async function fetchIndexText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch Bolna docs index (HTTP ${res.status})`);
  }
  return res.text();
}

async function getDocsIndex(): Promise<DocEntry[]> {
  if (cachedIndex && Date.now() - cachedIndex.fetchedAt < INDEX_TTL_MS) {
    return cachedIndex.entries;
  }

  const entries: DocEntry[] = [];
  const seenPages = new Set<string>();
  const seenIndexes = new Set<string>([LLMS_TXT_URL]);
  const lineRe = /^-\s*\[([^\]]+)\]\(([^)]+)\):\s*(.*)$/;

  const parse = (text: string): string[] => {
    const subIndexes: string[] = [];
    for (const line of text.split("\n")) {
      const match = lineRe.exec(line.trim());
      if (!match) continue;
      const [, title, url, description] = match;
      if (!title || !url) continue;
      if (SUB_INDEX_RE.test(url)) {
        if (!seenIndexes.has(url) && seenIndexes.size <= MAX_SUB_INDEXES) {
          seenIndexes.add(url);
          subIndexes.push(url);
        }
        continue;
      }
      const pageUrl = toPageUrl(url);
      if (seenPages.has(pageUrl)) continue;
      seenPages.add(pageUrl);
      entries.push({ title, url: pageUrl, description: description ?? "" });
    }
    return subIndexes;
  };

  let pending = parse(await fetchIndexText(LLMS_TXT_URL));
  while (pending.length > 0) {
    // A broken sub-index shouldn't take down search over the rest.
    const texts = await Promise.all(pending.map((url) => fetchIndexText(url).catch(() => "")));
    pending = texts.flatMap(parse);
  }

  cachedIndex = { entries, fetchedAt: Date.now() };
  return entries;
}

/**
 * Pages to rank above everything else that matches a topic. The plain word
 * count favours third-party tutorials whose titles repeat the query
 * ("send WhatsApp after a call with Make.com") over the native feature, so
 * the assistant ends up recommending a Make.com scenario instead of the
 * built-in node. When the query contains any of `terms`, the page's score is
 * multiplied by `factor`.
 */
const SEARCH_BOOSTS: { path: string; terms: string[]; factor: number }[] = [
  { path: "/workflows/aisensy-whatsapp", terms: ["whatsapp", "aisensy", "wa"], factor: 3 },
  { path: "/workflows/introduction", terms: ["whatsapp", "workflow", "workflows"], factor: 1.5 },
];

// Where a word matches says a lot about relevance: a hit in the title beats
// one in the URL slug, which beats one buried in the description.
const TITLE_WEIGHT = 3;
const URL_WEIGHT = 2;
const DESCRIPTION_WEIGHT = 1;

/** "messages" should still find "message"; keep short words like "sms" whole. */
function normalizeWord(word: string): string {
  return word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word;
}

function scoreEntry(entry: DocEntry, queryWords: string[]): number {
  const title = entry.title.toLowerCase();
  const url = entry.url.toLowerCase();
  const description = entry.description.toLowerCase();

  let score = 0;
  for (const word of queryWords.map(normalizeWord)) {
    if (title.includes(word)) score += TITLE_WEIGHT;
    if (url.includes(word)) score += URL_WEIGHT;
    if (description.includes(word)) score += DESCRIPTION_WEIGHT;
  }
  if (score === 0) return 0;

  const path = new URL(entry.url).pathname.replace(DOCS_PATH_PREFIX, "");
  for (const boost of SEARCH_BOOSTS) {
    if (boost.path === path && boost.terms.some((term) => queryWords.includes(term))) {
      score *= boost.factor;
    }
  }
  return score;
}

/**
 * Resolves user input (a bare topic, a /docs path, or a page URL from
 * search_docs) to a fetchable Bolna docs .md URL. Only ever targets
 * www.bolna.ai/docs/* — never an arbitrary host, to avoid this becoming an
 * open URL fetcher.
 *
 * Accepts either URL form: search_docs now hands out the extension-less page
 * URL, but callers still pass `.md` links from older results, bookmarks or a
 * guess, and both must fetch the same page.
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
  path = `${toPageUrl(path)}.md`;

  return `https://${DOCS_HOST}${path}`;
}

const jsonResult = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data) }],
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
        "Searches the Bolna documentation site for pages matching a query. Returns matching page titles, URLs, and descriptions. Each URL is the public documentation page — link users straight to it. Use get_doc with a result's URL to fetch the full page content.",
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
