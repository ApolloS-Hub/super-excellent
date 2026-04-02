/**
 * WebSearch tool — search the web (using DuckDuckGo lite)
 */
import type { ToolDefinitionFull } from "../types.js";

export const webSearchTool: ToolDefinitionFull = {
  name: "WebSearch",
  description: "Search the web and return results with titles, URLs, and snippets.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      count: { type: "number", description: "Number of results (default: 5)" },
    },
    required: ["query"],
  },
  isReadOnly: true,
  execute: async (input) => {
    const query = input.query as string;
    const count = (input.count as number) ?? 5;

    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const response = await fetch(url, {
        headers: { "User-Agent": "SuperExcellent/1.0" },
      });
      const html = await response.text();

      // Parse DuckDuckGo HTML results
      const results: string[] = [];
      const linkRegex = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
      const snippetRegex = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

      let linkMatch;
      const links: Array<{ url: string; title: string }> = [];
      while ((linkMatch = linkRegex.exec(html)) !== null && links.length < count) {
        const href = linkMatch[1].replace(/.*uddg=/, "").split("&")[0];
        const title = linkMatch[2].replace(/<[^>]+>/g, "").trim();
        links.push({ url: decodeURIComponent(href), title });
      }

      let snippetMatch;
      const snippets: string[] = [];
      while ((snippetMatch = snippetRegex.exec(html)) !== null && snippets.length < count) {
        snippets.push(snippetMatch[1].replace(/<[^>]+>/g, "").trim());
      }

      for (let i = 0; i < links.length; i++) {
        results.push(`${i + 1}. ${links[i].title}\n   ${links[i].url}\n   ${snippets[i] || ""}`);
      }

      return results.length ? results.join("\n\n") : "(no results found)";
    } catch (error) {
      return `Error searching: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};
