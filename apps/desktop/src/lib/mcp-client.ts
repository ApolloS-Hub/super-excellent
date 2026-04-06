/**
 * MCP (Model Context Protocol) Client — connect to MCP servers via stdio or SSE
 * Implements the client-side of the MCP spec for tool discovery and execution
 */

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export type MCPAuthType = "none" | "bearer" | "basic";

export interface MCPAuthConfig {
  type: MCPAuthType;
  token?: string;
  username?: string;
  password?: string;
}

export interface MCPServer {
  name: string;
  command?: string;    // stdio transport
  args?: string[];
  url?: string;        // SSE transport
  tools: MCPTool[];
  resources: MCPResource[];
  status: "connected" | "disconnected" | "error";
  error?: string;
}

export interface MCPConfig {
  servers: Array<{
    name: string;
    transport: "stdio" | "sse";
    command?: string;
    args?: string[];
    url?: string;
    env?: Record<string, string>;
  }>;
}

let servers: MCPServer[] = [];

const serverAuthMap = new Map<string, MCPAuthConfig>();

export function setServerAuth(serverName: string, auth: MCPAuthConfig): void {
  serverAuthMap.set(serverName, auth);
}

export function getServerAuth(serverName: string): MCPAuthConfig {
  return serverAuthMap.get(serverName) ?? { type: "none" };
}

function buildAuthHeaders(serverName: string): Record<string, string> {
  const auth = serverAuthMap.get(serverName);
  if (!auth || auth.type === "none") return {};
  if (auth.type === "bearer" && auth.token) {
    return { Authorization: `Bearer ${auth.token}` };
  }
  if (auth.type === "basic" && auth.username && auth.password) {
    return { Authorization: `Basic ${btoa(`${auth.username}:${auth.password}`)}` };
  }
  return {};
}

export function getServers(): MCPServer[] {
  return [...servers];
}

export function getAllMCPTools(): MCPTool[] {
  return servers.flatMap(s => s.tools);
}

/**
 * Connect to an MCP server via Tauri backend (stdio) or fetch (SSE)
 */
export async function connectServer(config: MCPConfig["servers"][0]): Promise<MCPServer> {
  const server: MCPServer = {
    name: config.name,
    command: config.command,
    url: config.url,
    tools: [],
    resources: [],
    status: "disconnected",
  };

  try {
    if (config.transport === "sse" && config.url) {
      const authHeaders = buildAuthHeaders(config.name);
      const baseHeaders = { "Content-Type": "application/json", ...authHeaders };

      // SSE transport — direct HTTP
      const initResp = await fetch(`${config.url}/initialize`, {
        method: "POST",
        headers: baseHeaders,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            clientInfo: { name: "super-excellent", version: "0.1.0" },
            capabilities: {},
          },
        }),
      });
      if (!initResp.ok) throw new Error(`MCP init failed: ${initResp.status}`);

      // List tools
      const toolsResp = await fetch(`${config.url}/tools/list`, {
        method: "POST",
        headers: baseHeaders,
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
      });
      if (toolsResp.ok) {
        const data = await toolsResp.json();
        server.tools = (data.result?.tools || []).map((t: Record<string, unknown>) => ({
          name: t.name as string,
          description: (t.description || "") as string,
          inputSchema: (t.inputSchema || {}) as Record<string, unknown>,
        }));
      }

      // List resources (best-effort)
      try {
        const resResp = await fetch(`${config.url}/resources/list`, {
          method: "POST",
          headers: baseHeaders,
          body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "resources/list", params: {} }),
        });
        if (resResp.ok) {
          const rdata = await resResp.json();
          server.resources = (rdata.result?.resources || []).map((r: Record<string, unknown>) => ({
            uri: r.uri as string,
            name: (r.name || r.uri) as string,
            description: r.description as string | undefined,
            mimeType: r.mimeType as string | undefined,
          }));
        }
      } catch { /* resources endpoint is optional */ }

      server.status = "connected";
    } else if (config.transport === "stdio" && config.command) {
      // Stdio transport — requires Tauri backend
      const { isTauriAvailable } = await import("./tauri-bridge");
      if (!isTauriAvailable()) {
        throw new Error("Stdio MCP requires Tauri desktop app");
      }
      // TODO: implement stdio MCP via Tauri sidecar
      server.status = "error";
      server.error = "Stdio MCP transport not yet implemented";
    }
  } catch (e) {
    server.status = "error";
    server.error = e instanceof Error ? e.message : String(e);
  }

  // Register server
  const idx = servers.findIndex(s => s.name === server.name);
  if (idx >= 0) servers[idx] = server;
  else servers.push(server);

  return server;
}

/**
 * Call an MCP tool
 */
export async function callMCPTool(
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const server = servers.find(s => s.name === serverName);
  if (!server) throw new Error(`MCP server '${serverName}' not found`);
  if (server.status !== "connected") throw new Error(`MCP server '${serverName}' not connected`);

  if (server.url) {
    // SSE transport
    const resp = await fetch(`${server.url}/tools/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...buildAuthHeaders(serverName) },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: { name: toolName, arguments: args },
      }),
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    const content = data.result?.content || [];
    return content.map((c: Record<string, unknown>) => c.text || JSON.stringify(c)).join("\n");
  }

  throw new Error("Stdio MCP call not implemented");
}

/**
 * List resources exposed by an MCP server
 */
export async function listResources(serverName: string): Promise<MCPResource[]> {
  const server = servers.find(s => s.name === serverName);
  if (!server || server.status !== "connected" || !server.url) return [];

  try {
    const resp = await fetch(`${server.url}/resources/list`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...buildAuthHeaders(serverName) },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "resources/list", params: {} }),
    });
    if (!resp.ok) return server.resources;
    const data = await resp.json();
    const fresh: MCPResource[] = (data.result?.resources || []).map((r: Record<string, unknown>) => ({
      uri: r.uri as string,
      name: (r.name || r.uri) as string,
      description: r.description as string | undefined,
      mimeType: r.mimeType as string | undefined,
    }));
    server.resources = fresh;
    return fresh;
  } catch {
    return server.resources;
  }
}

/**
 * Read a resource from an MCP server by URI
 */
export async function readResource(serverName: string, uri: string): Promise<string> {
  const server = servers.find(s => s.name === serverName);
  if (!server || server.status !== "connected") {
    throw new Error(`MCP server '${serverName}' not connected`);
  }
  if (!server.url) throw new Error("Stdio resource reading not supported");

  const resp = await fetch(`${server.url}/resources/read`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...buildAuthHeaders(serverName) },
    body: JSON.stringify({
      jsonrpc: "2.0", id: Date.now(),
      method: "resources/read", params: { uri },
    }),
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  const contents: Array<Record<string, unknown>> = data.result?.contents || [];
  return contents.map(c => (typeof c.text === "string" ? c.text : JSON.stringify(c))).join("\n");
}

/**
 * Load MCP config and connect all servers
 */
export async function loadMCPConfig(): Promise<void> {
  try {
    const raw = localStorage.getItem("mcp-config");
    if (!raw) return;
    const config = JSON.parse(raw) as MCPConfig;
    for (const sc of config.servers) {
      await connectServer(sc);
    }
  } catch (e) {
    console.error("MCP config load failed:", e);
  }
}

/**
 * Convert MCP tools to OpenAI function calling format
 */
export function mcpToolsAsOpenAI(): Array<{ type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }> {
  return getAllMCPTools().map(t => ({
    type: "function" as const,
    function: {
      name: `mcp_${t.name}`,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}
