// Human Browser Host - MCP Server Implementation
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as WebSocket from "ws";
import { launchSandbox, closeSandbox, getActiveSandboxPage, sandboxHumanClick, sandboxHumanType } from "./sandbox_runner.js";
import { logAuditEvent } from "./security_policy.js";

let currentMode: "extension" | "sandbox" | "headless" = "extension";
let wsClient: WebSocket.WebSocket | null = null;
let msgCounter = 1;
const pendingResponses = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();

async function getExtensionBridge(): Promise<WebSocket.WebSocket> {
  if (wsClient && wsClient.readyState === WebSocket.WebSocket.OPEN) {
    return wsClient;
  }

  return new Promise((resolve, reject) => {
    const ws = new WebSocket.WebSocket("ws://localhost:9333");

    ws.on("open", () => {
      wsClient = ws;
      resolve(ws);
    });

    ws.on("message", (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.id && pendingResponses.has(msg.id)) {
          const { resolve: res, reject: rej } = pendingResponses.get(msg.id)!;
          pendingResponses.delete(msg.id);
          if (msg.ok) res(msg.result);
          else rej(new Error(msg.error || "Extension command failed"));
        }
      } catch (e) {}
    });

    ws.on("error", (err) => {
      reject(new Error("Chrome Extension bridge is not connected on ws://localhost:9333. Make sure Chrome is running with Human Browser extension."));
    });
  });
}

async function sendToExtension(command: string, params: any = {}): Promise<any> {
  const ws = await getExtensionBridge();
  const id = msgCounter++;

  return new Promise((resolve, reject) => {
    pendingResponses.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, command, params }));

    setTimeout(() => {
      if (pendingResponses.has(id)) {
        pendingResponses.delete(id);
        reject(new Error("Command timed out after 60s"));
      }
    }, 60000);
  });
}

export function createMCPServer(): McpServer {
  const server = new McpServer({
    name: "human-browser-mcp",
    version: "1.0.0"
  });

  server.tool(
    "browser_connect",
    "Connects to the browser. Modes: extension (live Chrome), sandbox (disposable profile), headless (silent background).",
    {
      mode: z.enum(["extension", "sandbox", "headless"]).default("extension").describe("Browser execution mode"),
      profile: z.enum(["natural", "speedy", "deep_reader", "ghost_stealth"]).default("natural").describe("Kinematics behavior profile")
    },
    async ({ mode, profile }) => {
      currentMode = mode;
      logAuditEvent("browser_connect", { mode, profile }, { ok: true });

      if (mode === "extension") {
        try {
          await sendToExtension("attach", {});
          await sendToExtension("set_profile", { profile });
          return { content: [{ type: "text", text: `Connected to active Chrome extension (Profile: ${profile})` }] };
        } catch (e: any) {
          return { content: [{ type: "text", text: `Extension bridge note: ${e.message}. You can also use mode="sandbox" or mode="headless".` }] };
        }
      } else {
        const page = await launchSandbox({
          headless: mode === "headless",
          isEphemeral: mode === "sandbox"
        });
        return { content: [{ type: "text", text: `Launched ${mode} browser at ${page.url()}` }] };
      }
    }
  );

  server.tool(
    "browser_navigate",
    "Navigates the browser to a URL.",
    {
      url: z.string().describe("Target URL to navigate to")
    },
    async ({ url }) => {
      logAuditEvent("browser_navigate", { url, mode: currentMode }, {});
      if (currentMode === "extension") {
        await sendToExtension("navigate", { url });
        return { content: [{ type: "text", text: `Navigated active Chrome tab to: ${url}` }] };
      } else {
        const page = await launchSandbox({ headless: currentMode === "headless" });
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        return { content: [{ type: "text", text: `Navigated to: ${url} (Title: ${await page.title()})` }] };
      }
    }
  );

  server.tool(
    "browser_click",
    "Clicks an element organically using Bézier mouse curves and natural click dwell time.",
    {
      selector: z.string().optional().describe("CSS selector of element to click"),
      elementId: z.number().optional().describe("Numeric element ID from browser_inspect_dom"),
      elementText: z.string().optional().describe("Descriptive text of the button for security evaluation")
    },
    async ({ selector, elementId, elementText }) => {
      logAuditEvent("browser_click", { selector, elementId, elementText, mode: currentMode }, {});
      if (currentMode === "extension") {
        const res = await sendToExtension("click", { selector, elementId, elementText });
        return { content: [{ type: "text", text: `Successfully clicked element (X: ${res.x}, Y: ${res.y})` }] };
      } else {
        const page = await launchSandbox({ headless: currentMode === "headless" });
        if (!selector) throw new Error("Selector is required for sandbox click");
        await sandboxHumanClick(page, selector);
        return { content: [{ type: "text", text: `Clicked selector: ${selector}` }] };
      }
    }
  );

  server.tool(
    "browser_type",
    "Types text with human cadence, variable WPM delays, and natural keystroke rhythm.",
    {
      selector: z.string().optional().describe("CSS selector of input field"),
      elementId: z.number().optional().describe("Numeric element ID from browser_inspect_dom"),
      text: z.string().describe("Text to type")
    },
    async ({ selector, elementId, text }) => {
      logAuditEvent("browser_type", { selector, elementId, textLength: text.length, mode: currentMode }, {});
      if (currentMode === "extension") {
        await sendToExtension("type", { selector, elementId, text });
        return { content: [{ type: "text", text: `Typed ${text.length} characters with natural cadence` }] };
      } else {
        const page = await launchSandbox({ headless: currentMode === "headless" });
        if (!selector) throw new Error("Selector is required for sandbox type");
        await sandboxHumanType(page, selector, text);
        return { content: [{ type: "text", text: `Typed text into: ${selector}` }] };
      }
    }
  );

  server.tool(
    "browser_scroll",
    "Smoothly scrolls the page with inertia and reading dwell pauses.",
    {
      distanceY: z.number().default(400).describe("Scroll distance in pixels (+ down, - up)")
    },
    async ({ distanceY }) => {
      logAuditEvent("browser_scroll", { distanceY, mode: currentMode }, {});
      if (currentMode === "extension") {
        await sendToExtension("scroll", { distanceY });
        return { content: [{ type: "text", text: `Scrolled ${distanceY}px smoothly with reading pause` }] };
      } else {
        const page = await launchSandbox({ headless: currentMode === "headless" });
        await page.mouse.wheel(0, distanceY);
        return { content: [{ type: "text", text: `Scrolled ${distanceY}px` }] };
      }
    }
  );

  server.tool(
    "browser_inspect_dom",
    "Inspects visible interactive elements (buttons, links, inputs) and returns numbered IDs and descriptions.",
    {
      limit: z.number().default(80).describe("Maximum interactive elements to return")
    },
    async ({ limit }) => {
      if (currentMode === "extension") {
        const res = await sendToExtension("inspect_dom", { limit });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                title: res.title,
                url: res.url,
                elementCount: (res.elements || []).length,
                elements: (res.elements || []).map((e: any) => ({
                  id: e.id,
                  tag: e.tag,
                  text: e.text,
                  type: e.type,
                  role: e.role
                }))
              }, null, 2)
            }
          ]
        };
      } else {
        const page = await launchSandbox({ headless: currentMode === "headless" });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                title: await page.title(),
                url: page.url()
              }, null, 2)
            }
          ]
        };
      }
    }
  );

  server.tool(
    "browser_take_snapshot",
    "Captures a JPEG screenshot of the current browser viewport.",
    {},
    async () => {
      if (currentMode === "extension") {
        const res = await sendToExtension("take_snapshot", {});
        return {
          content: [
            {
              type: "text",
              text: `data:image/jpeg;base64,${res.screenshot}`
            }
          ]
        };
      } else {
        const page = await launchSandbox({ headless: currentMode === "headless" });
        const buf = await page.screenshot({ type: "jpeg", quality: 85 });
        return {
          content: [
            {
              type: "text",
              text: `data:image/jpeg;base64,${buf.toString("base64")}`
            }
          ]
        };
      }
    }
  );

  server.tool(
    "browser_solve_captcha_wait",
    "Pauses agent execution and waits until the user finishes solving an in-browser CAPTCHA / Cloudflare challenge.",
    {},
    async () => {
      if (currentMode === "extension") {
        await sendToExtension("wait_for_captcha", {});
        return { content: [{ type: "text", text: "CAPTCHA solved by user. Resuming workflow." }] };
      } else {
        return { content: [{ type: "text", text: "No CAPTCHA challenge in sandbox mode." }] };
      }
    }
  );

  return server;
}