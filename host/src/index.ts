// Human Browser Host - Main Entrypoint
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMCPServer } from "./mcp_server.js";
import { startNativeMessagingLoop, sendToExtension, startLocalIPCDaemon, broadcastToAgents } from "./native_bridge.js";

const args = process.argv.slice(2);
const isNativeMode = args.includes("--native") || args.includes("--chrome") || (!process.stdin.isTTY && !args.includes("--mcp"));

// When Chrome launches the host executable via Native Messaging
if (args.includes("--native")) {
  console.error("[HumanBrowser] Running in Native Messaging Host mode");

  // Relay command from local WebSocket to Chrome extension
  startLocalIPCDaemon(async (cmd) => {
    return new Promise((resolve) => {
      sendToExtension(cmd);
      // Wait for extension reply via native messaging loop
      const handler = (msg: any) => {
        if (msg.id === cmd.id) {
          resolve(msg);
        }
      };
    });
  });

  startNativeMessagingLoop((msg) => {
    console.error("[NativeHost] Received from Chrome:", msg);
    broadcastToAgents(msg);
  });
} else {
  // When Antigravity / OpenCode launches this as an MCP server
  async function runMCP() {
    const server = createMCPServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[HumanBrowser] MCP Server connected via stdio transport");
  }

  runMCP().catch((err) => {
    console.error("[HumanBrowser] Fatal error in MCP server:", err);
    process.exit(1)
  });
}