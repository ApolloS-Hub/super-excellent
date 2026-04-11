/**
 * Browser tool — open URLs, take screenshots, fetch page content, and extract structured data
 * Uses system browser via shell commands (cross-platform)
 */
import { exec } from "child_process";
import type { ToolDefinitionFull } from "../types.js";

/**
 * Strip script/style tags and HTML markup, return plain text.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract <title> content from raw HTML.
 */
function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].trim() : "";
}

/**
 * Extract meta description from HTML.
 */
function extractMetaDescription(html: string): string {
  const match = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*?)["']/i)
    || html.match(/<meta[^>]*content=["']([^"']*?)["'][^>]*name=["']description["']/i);
  return match ? match[1].trim() : "";
}

/**
 * Extract Open Graph metadata from HTML.
 */
function extractOGMeta(html: string): Record<string, string> {
  const og: Record<string, string> = {};
  const regex = /<meta[^>]*property=["']og:(\w+)["'][^>]*content=["']([^"']*?)["']/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    og[match[1]] = match[2];
  }
  return og;
}

/**
 * Extract main content area (readability-like heuristic).
 * Looks for article, main, or the largest content div.
 */
function extractMainContent(html: string): string {
  // Try <article> first
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch) return stripHtml(articleMatch[1]);

  // Try <main>
  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (mainMatch) return stripHtml(mainMatch[1]);

  // Try common content class names
  const contentPatterns = [
    /<div[^>]*class="[^"]*(?:content|article|post|entry|text)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*id="[^"]*(?:content|article|main|post)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  ];
  for (const pattern of contentPatterns) {
    const match = html.match(pattern);
    if (match && match[1].length > 200) return stripHtml(match[1]);
  }

  // Fallback: strip everything
  return stripHtml(html);
}

/**
 * Extract links from HTML.
 */
function extractLinks(html: string, baseUrl: string): Array<{ text: string; href: string }> {
  const links: Array<{ text: string; href: string }> = [];
  const regex = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const href = match[1];
    const text = stripHtml(match[2]).trim();
    if (text && href && !href.startsWith("#") && !href.startsWith("javascript:")) {
      try {
        const fullUrl = href.startsWith("http") ? href : new URL(href, baseUrl).toString();
        links.push({ text: text.slice(0, 100), href: fullUrl });
      } catch {
        // skip invalid URLs
      }
    }
  }
  return links.slice(0, 20); // Limit to 20 links
}

export const browserFetchTool: ToolDefinitionFull = {
  name: "BrowserFetch",
  description:
    "Fetch a web page, extract its content with readability heuristics, and return structured output including title, description, main body text, and links.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "URL to fetch" },
      maxChars: {
        type: "number",
        description: "Maximum body characters to return (default: 5000)",
      },
      extractLinks: {
        type: "boolean",
        description: "Whether to extract and return page links (default: false)",
      },
      rawMode: {
        type: "boolean",
        description: "If true, return raw HTML instead of extracted text (default: false)",
      },
    },
    required: ["url"],
  },
  isReadOnly: true,
  execute: async (input) => {
    const url = input.url as string;
    const maxChars = (input.maxChars as number) ?? 5000;
    const shouldExtractLinks = (input.extractLinks as boolean) ?? false;
    const rawMode = (input.rawMode as boolean) ?? false;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; SuperExcellent/1.0; +https://github.com/ApolloS-Hub/super-excellent)",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
        },
      });
      clearTimeout(timeout);

      if (!response.ok) {
        return `HTTP ${response.status}: ${response.statusText}`;
      }

      const contentType = response.headers.get("content-type") || "";

      // Handle non-HTML content
      if (!contentType.includes("html") && !contentType.includes("text")) {
        const size = response.headers.get("content-length");
        return `Non-HTML content: ${contentType}${size ? ` (${size} bytes)` : ""}`;
      }

      const html = await response.text();

      if (rawMode) {
        return html.slice(0, maxChars * 2);
      }

      // Extract structured data
      const title = extractTitle(html);
      const description = extractMetaDescription(html);
      const og = extractOGMeta(html);
      const mainContent = extractMainContent(html).slice(0, maxChars);

      const parts: string[] = [];

      if (title) parts.push(`# ${title}`);
      if (description) parts.push(`> ${description}`);
      if (og.image) parts.push(`Image: ${og.image}`);

      parts.push("");
      parts.push(mainContent);

      if (shouldExtractLinks) {
        const links = extractLinks(html, url);
        if (links.length > 0) {
          parts.push("");
          parts.push("## Links");
          for (const link of links) {
            parts.push(`- [${link.text}](${link.href})`);
          }
        }
      }

      return parts.join("\n");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return `Timeout: Page took longer than 30 seconds to respond`;
      }
      return `Error fetching URL: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

export { stripHtml as _stripHtml, extractTitle as _extractTitle };

export const browserOpenTool: ToolDefinitionFull = {
  name: "BrowserOpen",
  description: "Open a URL in the system default browser.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "URL to open" },
    },
    required: ["url"],
  },
  isReadOnly: false,
  execute: async (input) => {
    const url = input.url as string;
    const cmd = process.platform === "darwin"
      ? `open "${url}"`
      : process.platform === "win32"
        ? `start "${url}"`
        : `xdg-open "${url}"`;

    return new Promise<string>((resolve) => {
      exec(cmd, { timeout: 10000 }, (error) => {
        resolve(error ? `Error: ${error.message}` : `Opened ${url} in browser`);
      });
    });
  },
};

export const screenshotTool: ToolDefinitionFull = {
  name: "Screenshot",
  description: "Take a screenshot of the current screen (macOS only for now).",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Output file path (default: /tmp/screenshot.png)" },
    },
  },
  isReadOnly: true,
  execute: async (input) => {
    const outPath = (input.path as string) || "/tmp/se-screenshot.png";

    if (process.platform !== "darwin") {
      return "Screenshot currently only supported on macOS";
    }

    return new Promise<string>((resolve) => {
      exec(`screencapture -x "${outPath}"`, { timeout: 10000 }, (error) => {
        resolve(error ? `Error: ${error.message}` : `Screenshot saved to ${outPath}`);
      });
    });
  },
};
