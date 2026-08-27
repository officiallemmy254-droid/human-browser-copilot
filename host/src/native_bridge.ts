// Human Browser Host - Chrome Native Messaging Protocol & IPC Bridge
import { WebSocketServer, WebSocket } from "ws";

const WS_PORT = 9333;
let wsServer: WebSocketServer | null = null;
let activeSockets: Set<WebSocket> = new Set();
let extensionSocket: WebSocket | null = null;
const pendingRequests = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void; timer: NodeJS.Timeout }>();

/**
 * Reads 32-bit length-prefixed JSON packets from Chrome Native Messaging stdio
 */
export function startNativeMessagingLoop(onEvent?: (msg: any) => void) {
  let buffer = Buffer.alloc(0);

  process.stdin.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length >= 4) {
      const msgLen = buffer.readUInt32LE(0);
      if (buffer.length < 4 + msgLen) {
        break; // Wait for complete packet
      }

      const rawJson = buffer.subarray(4, 4 + msgLen).toString("utf8");
      buffer = buffer.subarray(4 + msgLen);

      try {
        const parsed = JSON.parse(rawJson);
        handleIncomingChromeMessage(parsed, onEvent);
      } catch (err) {
        console.error("[NativeBridge] Failed to parse JSON message:", err);
      }
    }
  });

  process.stdin.on("end", () => {
    console.error("[NativeBridge] Chrome stdio stream ended. Exiting host.");
    process.exit(0);
  });
}

function handleIncomingChromeMessage(msg: any, onEvent?: (msg: any) => void) {
  // If this message is a reply to a pending request with an ID
  if (msg && typeof msg.id === "number" && pendingRequests.has(msg.id)) {
    const entry = pendingRequests.get(msg.id)!;
    clearTimeout(entry.timer);
    pendingRequests.delete(msg.id);

    if (msg.ok !== false) {
      entry.resolve(msg);
    } else {
      entry.reject(new Error(msg.error || "Extension command failed"));
    }
  }

  // Also broadcast all messages/events to connected MCP/CLI agents
  broadcastToAgents(msg);
  if (onEvent) onEvent(msg);
}

/**
 * Sends 32-bit length-prefixed JSON packet to Chrome Extension stdio or active WebSocket
 */
export function sendToExtension(msg: any): boolean {
  // Try direct Extension WebSocket first if available
  if (extensionSocket && extensionSocket.readyState === WebSocket.OPEN) {
    try {
      extensionSocket.send(JSON.stringify(msg));
      return true;
    } catch (e) {}
  }

  // Fallback to stdio
  try {
    const jsonStr = JSON.stringify(msg);
    const payload = Buffer.from(jsonStr, "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32LE(payload.length, 0);

    process.stdout.write(Buffer.concat([header, payload]));
    return true;
  } catch (err) {
    console.error("[NativeBridge] Failed to write to stdout:", err);
    return false;
  }
}

/**
 * Dispatches a command to the extension and returns a promise for the reply
 */
export function sendToExtensionAsync(cmd: any, timeoutMs: number = 60000): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = cmd.id;
    const timer = setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error(`Command ${cmd.command || "action"} timed out after ${timeoutMs / 1000}s`));
      }
    }, timeoutMs);

    pendingRequests.set(id, { resolve, reject, timer });
    const sent = sendToExtension(cmd);
    if (!sent) {
      clearTimeout(timer);
      pendingRequests.delete(id);
      reject(new Error("Failed to send command to Chrome Extension"));
    }
  });
}

/**
 * Starts local WebSocket server for MCP server / CLI agents & Extension direct link
 */
export function startLocalIPCDaemon() {
  if (wsServer) return;

  wsServer = new WebSocketServer({ port: WS_PORT });

  wsServer.on("connection", (socket: WebSocket) => {
    activeSockets.add(socket);
    console.error(`[NativeBridge] Client connected (Total: ${activeSockets.size})`);

    socket.on("message", async (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());

        // Check if this connection is the Chrome Extension
        if (msg && (msg.isExtension || msg.role === "extension" || (typeof msg.id === "number" && (msg.ok !== undefined || msg.pong !== undefined || msg.event !== undefined)))) {
          extensionSocket = socket;
          handleIncomingChromeMessage(msg);
          return;
        }

        // Otherwise it is an Agent / CLI command request
        const timeout = msg.command === "batch_execute" ? 600000 : 60000;
        const res = await sendToExtensionAsync(msg, timeout);
        socket.send(JSON.stringify(res));
      } catch (err: any) {
        socket.send(JSON.stringify({ ok: false, error: err.message }));
      }
    });

    socket.on("close", () => {
      activeSockets.delete(socket);
      if (extensionSocket === socket) {
        extensionSocket = null;
        console.error("[NativeBridge] Extension WebSocket disconnected");
      }
      console.error(`[NativeBridge] Client disconnected (Remaining: ${activeSockets.size})`);
    });
  });

  console.error(`[NativeBridge] Local IPC daemon active on ws://localhost:${WS_PORT}`);
}

/**
 * Broadcasts an event from Chrome extension to all connected agent clients
 */
export function broadcastToAgents(event: any) {
  const json = JSON.stringify(event);
  for (const socket of activeSockets) {
    if (socket !== extensionSocket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(json);
      } catch (e) {}
    }
  }
}
