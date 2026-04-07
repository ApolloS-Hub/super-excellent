/**
 * MCP Client — Connect to external MCP servers
 * 
 * Supports stdio and SSE transport (inspired by open-agent-sdk).
 * Allows extending the tool system with external capabilities.
 */
import { spawn, type ChildProcess } from "child_process";
import http from "http";
import https from "https";
import type { ToolDefinitionFull } from "../tools/types.js";

export interface McpServerConfig {
  /** Server name */
  name: string;
  /** Transport type */
  transport: "stdio" | "sse";
  /** For stdio: command to run */
  command?: string;
  /** For stdio: command arguments */
  args?: string[];
  /** For SSE: endpoint URL */
  url?: string;
  /** Environment variables */
  env?: Record<string, string>;
}

interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export class McpClient {
  private config: McpServerConfig;
  private process: ChildProcess | null = null;
  private sseAbort: AbortController | null = null;
  private ssePostUrl: string | null = null;
  private tools: McpTool[] = [];
  private requestId = 0;
  private pendingRequests = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
  }>();
  private buffer = "";

  constructor(config: McpServerConfig) {
    this.config = config;
  }

  /** Connect to the MCP server */
  async connect(): Promise<void> {
    if (this.config.transport === "stdio") {
      await this.connectStdio();
    } else {
      await this.connectSse();
    }
  }

  /** Get tools from the MCP server as ToolDefinitions */
  getTools(): ToolDefinitionFull[] {
    return this.tools.map(t => ({
      name: `mcp_${this.config.name}_${t.name}`,
      description: `[MCP: ${this.config.name}] ${t.description}`,
      inputSchema: t.inputSchema,
      isReadOnly: false, // Conservative: assume write
      execute: async (input: Record<string, unknown>) => {
        return this.callTool(t.name, input);
      },
    }));
  }

  /** Call a tool on the MCP server */
  async callTool(name: string, input: Record<string, unknown>): Promise<string> {
    const response = await this.sendRequest("tools/call", { name, arguments: input });
    
    if (response && typeof response === "object" && "content" in response) {
      const content = (response as { content: Array<{ text?: string }> }).content;
      return content.map(c => c.text || "").join("\n");
    }
    return JSON.stringify(response);
  }

  /** Disconnect from the MCP server */
  async disconnect(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    if (this.sseAbort) {
      this.sseAbort.abort();
      this.sseAbort = null;
    }
  }

  private async connectStdio(): Promise<void> {
    if (!this.config.command) {
      throw new Error("No command specified for stdio MCP server");
    }

    this.process = spawn(this.config.command, this.config.args || [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...this.config.env },
    });

    this.process.stdout?.on("data", (data: Buffer) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      console.error(`[MCP ${this.config.name}]`, data.toString());
    });

    // Initialize
    await this.sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "super-excellent", version: "0.1.0" },
    });

    // Send initialized notification
    this.sendNotification("notifications/initialized", {});

    // List tools
    const toolsResponse = await this.sendRequest("tools/list", {});
    if (toolsResponse && typeof toolsResponse === "object" && "tools" in toolsResponse) {
      this.tools = (toolsResponse as { tools: McpTool[] }).tools;
    }
  }

  private async connectSse(): Promise<void> {
    if (!this.config.url) {
      throw new Error("No URL specified for SSE MCP server");
    }

    const baseUrl = this.config.url;
    this.sseAbort = new AbortController();

    // Connect to SSE endpoint and wait for the "endpoint" event
    // which tells us where to POST JSON-RPC messages.
    const postUrl = await new Promise<string>((resolve, reject) => {
      const mod = baseUrl.startsWith("https") ? https : http;
      const req = mod.get(baseUrl, { signal: this.sseAbort!.signal }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`SSE connection failed with status ${res.statusCode}`));
          return;
        }
        let sseBuf = "";
        let eventType = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          sseBuf += chunk;
          const lines = sseBuf.split("\n");
          sseBuf = lines.pop() || "";
          for (const line of lines) {
            if (line.startsWith("event:")) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              const data = line.slice(5).trim();
              if (eventType === "endpoint") {
                // Resolve the POST URL (may be relative)
                const resolved = data.startsWith("http")
                  ? data
                  : new URL(data, baseUrl).toString();
                this.ssePostUrl = resolved;
                resolve(resolved);
              } else if (eventType === "message") {
                try {
                  const msg = JSON.parse(data);
                  if ("id" in msg && this.pendingRequests.has(msg.id)) {
                    const pending = this.pendingRequests.get(msg.id)!;
                    this.pendingRequests.delete(msg.id);
                    if ("error" in msg) {
                      pending.reject(new Error(msg.error.message || "MCP error"));
                    } else {
                      pending.resolve(msg.result);
                    }
                  }
                } catch {
                  // skip unparseable
                }
              }
              eventType = "";
            }
          }
        });
        res.on("error", (err) => reject(err));
      });
      req.on("error", (err) => reject(err));

      // Timeout waiting for endpoint event
      setTimeout(() => reject(new Error("SSE endpoint event timeout")), 30000);
    });

    // Initialize
    await this.sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "super-excellent", version: "0.1.0" },
    });

    this.sendNotification("notifications/initialized", {});

    // List tools
    const toolsResponse = await this.sendRequest("tools/list", {});
    if (toolsResponse && typeof toolsResponse === "object" && "tools" in toolsResponse) {
      this.tools = (toolsResponse as { tools: McpTool[] }).tools;
    }
  }

  private sendRequest(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      this.pendingRequests.set(id, { resolve, reject });

      const message = JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params,
      });

      if (this.ssePostUrl) {
        this.postJsonRpc(message).catch((err) => {
          this.pendingRequests.delete(id);
          reject(err);
        });
      } else {
        this.process?.stdin?.write(message + "\n");
      }

      // Timeout after 30s
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`MCP request timeout: ${method}`));
        }
      }, 30000);
    });
  }

  private sendNotification(method: string, params: unknown): void {
    const message = JSON.stringify({
      jsonrpc: "2.0",
      method,
      params,
    });
    if (this.ssePostUrl) {
      this.postJsonRpc(message).catch((err) => {
        console.error(`[MCP ${this.config.name}] notification error:`, err);
      });
    } else {
      this.process?.stdin?.write(message + "\n");
    }
  }

  private postJsonRpc(body: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.ssePostUrl!);
      const mod = url.protocol === "https:" ? https : http;
      const req = mod.request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }, (res) => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          res.resume();
          resolve();
        } else {
          reject(new Error(`POST failed with status ${res.statusCode}`));
        }
      });
      req.on("error", reject);
      req.end(body);
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if ("id" in msg && this.pendingRequests.has(msg.id)) {
          const pending = this.pendingRequests.get(msg.id)!;
          this.pendingRequests.delete(msg.id);
          if ("error" in msg) {
            pending.reject(new Error(msg.error.message || "MCP error"));
          } else {
            pending.resolve(msg.result);
          }
        }
      } catch {
        // Skip unparseable lines
      }
    }
  }
}

/**
 * MCP Manager — manages multiple MCP server connections
 */
export class McpManager {
  private clients = new Map<string, McpClient>();

  async addServer(config: McpServerConfig): Promise<void> {
    const client = new McpClient(config);
    await client.connect();
    this.clients.set(config.name, client);
  }

  /** Get all tools from all connected MCP servers */
  getAllTools(): ToolDefinitionFull[] {
    const tools: ToolDefinitionFull[] = [];
    for (const client of this.clients.values()) {
      tools.push(...client.getTools());
    }
    return tools;
  }

  async disconnectAll(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.disconnect();
    }
    this.clients.clear();
  }

  getServerNames(): string[] {
    return [...this.clients.keys()];
  }
}
