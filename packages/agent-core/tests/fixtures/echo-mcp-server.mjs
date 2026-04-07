#!/usr/bin/env node
/**
 * Minimal MCP echo server over stdio (JSON-RPC 2.0).
 *
 * Supports: initialize, notifications/initialized, tools/list, tools/call.
 * The single tool "echo" returns whatever text was passed in.
 *
 * Flags:
 *   --crash-after-init   Exit(1) right after initialize handshake
 *   --slow <ms>          Delay every response by <ms> milliseconds
 */
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const crashAfterInit = args.includes("--crash-after-init");
const slowIdx = args.indexOf("--slow");
const slowMs = slowIdx !== -1 ? Number(args[slowIdx + 1]) : 0;

const rl = createInterface({ input: process.stdin });

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function reply(id, result) {
  const msg = { jsonrpc: "2.0", id, result };
  if (slowMs > 0) {
    setTimeout(() => send(msg), slowMs);
  } else {
    send(msg);
  }
}

function replyError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return; // ignore unparseable
  }

  const { id, method, params } = msg;

  // Notifications (no id) — just acknowledge silently
  if (id === undefined) return;

  switch (method) {
    case "initialize":
      reply(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "echo-mcp-server", version: "0.1.0" },
      });
      if (crashAfterInit) {
        setTimeout(() => process.exit(1), 50);
      }
      break;

    case "tools/list":
      reply(id, {
        tools: [
          {
            name: "echo",
            description: "Echo back the input text",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string" } },
              required: ["text"],
            },
          },
        ],
      });
      break;

    case "tools/call": {
      const toolName = params?.name;
      if (toolName !== "echo") {
        replyError(id, -32601, `Unknown tool: ${toolName}`);
        break;
      }
      const text = params?.arguments?.text ?? "";
      reply(id, {
        content: [{ type: "text", text: `echo: ${text}` }],
      });
      break;
    }

    default:
      replyError(id, -32601, `Method not found: ${method}`);
  }
});
