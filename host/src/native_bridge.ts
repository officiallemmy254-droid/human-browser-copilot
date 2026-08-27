// Human Browser Host - Chrome Native Messaging Protocol & IPC Daemon
import * as net from "net";
import { WebSocketServer, WebSocket } from "ws";

const WS_PORT = 9333;
let activeExtensionPort: any = null;
let wsServer: WebSocketServer | null = null;
let activeSockets: Set<WebSocket> = new Set();

/**
 * Reads 32-bit length-prefixed JSON packet from Chrome Native Messaging stdio
 */
export function startNativeMessagingLoop(onMessage: (msg: any) => void) {
  let buffer = Buffer.alloc(0);

  process.stdin.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length >= 4) {
      const msgLen = buffer.readUInt32LE(0);
      if (buffer.length < 4 + msgLen) {
        break; // Wait for full packet
      }

      const rawJson = buffer.subarray(4, 4 + msgLen).toString("utf8");
      buffer = buffer.subarray(4 + msgLen);

      try {
        const parsed = JSON.parse(rawJson);
        onMessage(parsed);
      } catch (err) {
        console.error("[NativeBridge] Failed to parse message:", err);
      }
    }
  });

  process.stdin.on("end", () => {
    process.exit(0);
  });
}

/**
 * Sends 32-bit length-prefixed JSON packet to Chrome Extension stdio
 */
export function sendToExtension(msg: any) {
  const jsonStr = JSON.stringify(msg);
  const payload = Buffer.from(jsonStr, "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);

  process.stdout.write(Buffer.concat([header, payload]));
}

/**
 * Starts local WebSocket server so MCP servers / CLI agents can talk to the Native Host
 */
export function startLocalIPCDaemon(onAgentCommand: (cmd: any) => Promise<any>) {
  wsServer = new WebSocketServer({ port: WS_PORT });

  wsServer.on("connection", (socket: WebSocket) => {
    activeSockets.add(socket);

    socket.on("message", async (data: Buffer) => {
      try {
        const cmd = JSON.parse(data.toString());
        const response = await onAgentCommand(cmd);
        socket.send(JSON.stringify(response));
      } catch (e: any) {
        socket.send(JSON.stringify({ ok: false, error: e.message }));
      }
    });

    socket.on("close", () => {
      activeSockets.delete(socket);
    });
  });

  console.error(`[NativeBridge] Local IPC server listening on ws://localhost:${WS_PORT}`);
}

/**
 * Broadcasts an event from Chrome extension to all connected agent clients
 */
export function broadcastToAgents(event: any) {
  const json = JSON.stringify(event);
  for (const socket of activeSockets) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(json);
    }
  }
}
