// Human Browser Host - Main Entrypoint
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMCPServer } from "./mcp_server.js";
import { startNativeMessagingLoop, startLocalIPCDaemon } from "./native_bridge.js";

const args = process.argv.slice(2);
const isNativeMode = args.includes("--native") || args.includes("--chrome") || (!process.stdin.isTTY && !args.includes("--mcp"));

if (isNativeMode) {
  console.error("[HumanBrowser] Starting in Chrome Native Messaging Host mode...");
  startLocalIPCDaemon();
  startNativeMessagingLoop((msg) => {
    // Optional logging of chrome extension events
  });
} else {
  async function runMCP() {
    const server = createMCPServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[HumanBrowser] MCP Server connected via stdio transport");
  }

  runMCP().catch((err) => {
    console.error("[HumanBrowser] Fatal error in MCP server:", err);
    process.exit(1);
  });
}
