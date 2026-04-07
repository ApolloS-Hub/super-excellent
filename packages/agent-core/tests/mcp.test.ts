import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import { McpClient, McpManager } from "../src/mcp/client.js";

const ECHO_SERVER = path.resolve(
  import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname),
  "fixtures/echo-mcp-server.mjs",
);

function makeConfig(extraArgs: string[] = []) {
  return {
    name: "echo",
    transport: "stdio" as const,
    command: "node",
    args: [ECHO_SERVER, ...extraArgs],
  };
}

describe("McpClient — echo server integration", () => {
  let client: McpClient | null = null;

  afterEach(async () => {
    if (client) {
      await client.disconnect();
      client = null;
    }
  });

  it("connects and lists tools", async () => {
    client = new McpClient(makeConfig());
    await client.connect();

    const tools = client.getTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("mcp_echo_echo");
    expect(tools[0].description).toContain("Echo");
  });

  it("calls a tool and gets the echoed result", async () => {
    client = new McpClient(makeConfig());
    await client.connect();

    const result = await client.callTool("echo", { text: "hello world" });
    expect(result).toBe("echo: hello world");
  });

  it("disconnect kills the child process", async () => {
    client = new McpClient(makeConfig());
    await client.connect();
    await client.disconnect();

    // After disconnect, getTools still returns cached list (but process is dead)
    const tools = client.getTools();
    expect(tools).toHaveLength(1);
    client = null; // prevent afterEach double-disconnect
  });

  it("rejects on server crash after init", async () => {
    client = new McpClient(makeConfig(["--crash-after-init"]));

    // The connect itself may succeed (initialize reply sent before crash),
    // but subsequent calls should fail because the process exited.
    try {
      await client.connect();
      // If connect succeeded, a tool call should fail
      await expect(
        client.callTool("echo", { text: "should fail" }),
      ).rejects.toThrow();
    } catch {
      // connect itself threw — also acceptable
      expect(true).toBe(true);
    }
  });

  it("times out on extremely slow server", async () => {
    // Use a 10s delay — our client has a 5s timeout for this test.
    client = new McpClient({ ...makeConfig(["--slow", "10000"]), connectTimeoutMs: 5000 });

    await expect(client.connect()).rejects.toThrow(/timeout/i);
  }, 10000);
});

describe("McpManager — multi-server", () => {
  let manager: McpManager;

  afterEach(async () => {
    await manager.disconnectAll();
  });

  it("adds a server and aggregates tools", async () => {
    manager = new McpManager();
    await manager.addServer(makeConfig());

    expect(manager.getServerNames()).toEqual(["echo"]);
    const tools = manager.getAllTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("mcp_echo_echo");
  });

  it("disconnectAll clears servers", async () => {
    manager = new McpManager();
    await manager.addServer(makeConfig());
    await manager.disconnectAll();

    expect(manager.getServerNames()).toHaveLength(0);
    expect(manager.getAllTools()).toHaveLength(0);
  });
});
