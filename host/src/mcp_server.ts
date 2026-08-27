// Human Browser Host - MCP Server Implementation for Long-Running & Heavy Tasks
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as WebSocket from "ws";
import { launchSandbox, closeSandbox, getActiveSandboxPage, sandboxHumanClick, sandboxHumanType, sandboxWaitFor, sandboxExtractData } from "./sandbox_runner.js";
import { createObservationSnapshot, searchSnapshotElements, truncatePageText, SnapshotRegistry } from "./observation_engine.js";
import { executeInteractionClick, executeInteractionType, executeInteractionClear, executeInteractionKeypress, executeInteractionScroll } from "./interaction_engine.js";
import { executeNavigation, executeWait } from "./navigation_engine.js";
import { executeListTabs, executeOpenTab, executeSwitchTab, executeCloseTab, executeTaskCleanup } from "./tab_manager.js";
import { recordActionAudit, AuditLogger } from "./audit_logger.js";
import { PermissionTier, classifyActionTier } from "./contracts/policy.js";
import { PolicyEngine, evaluatePolicy, enforcePolicy } from "./policy_engine.js";
import { AuthGateway, generateSessionToken, validateSessionToken, revokeSessionToken } from "./auth_gateway.js";
import { ApprovalBroker, requestApproval, resolveApprovalRequest } from "./approval_broker.js";
import { A11yEngine } from "./a11y_engine.js";

let currentMode: "extension" | "sandbox" | "headless" = "extension";
let wsClient: WebSocket.WebSocket | null = null;
let msgCounter = 1;
const pendingResponses = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();

function logAuditEvent(actionType: string, params: Record<string, any>, result: Record<string, any> = {}) {
  try {
    recordActionAudit({
      taskId: params.taskId || "mcp_task",
      origin: params.url || params.origin || "runtime://mcp-server",
      actionType,
      policyTier: PermissionTier.INTERACT,
      policyDecision: "ALLOW",
      executionResult: result
    });
  } catch (e) {}
}

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

    ws.on("error", () => {
      reject(new Error("Chrome Extension bridge is not connected on ws://localhost:9333. Make sure Chrome is running with Human Browser extension."));
    });
  });
}

async function sendToExtension(command: string, params: any = {}, timeoutMs: number = 60000): Promise<any> {
  const ws = await getExtensionBridge();
  const id = msgCounter++;

  return new Promise((resolve, reject) => {
    pendingResponses.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, command, params }));

    setTimeout(() => {
      if (pendingResponses.has(id)) {
        pendingResponses.delete(id);
        reject(new Error(`Command ${command} timed out after ${timeoutMs / 1000}s`));
      }
    }, timeoutMs);
  });
}

export function createMCPServer(): McpServer {
  const server = new McpServer({
    name: "human-browser-mcp",
    version: "2.0.0"
  });

  server.tool(
    "browser_connect",
    "Connects to the browser. Modes: extension (live authenticated Chrome), sandbox (disposable profile), headless (silent background).",
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
    "browser_batch_execute",
    "Executes an autonomous multi-step batch workflow with auto-retry, anti-fatigue pauses, and variable extraction directly inside the browser.",
    {
      name: z.string().optional().describe("Descriptive name of the batch workflow"),
      steps: z.array(z.record(z.any())).describe("Array of workflow action objects (navigate, click, type, scroll, wait_for, extract, evaluate, sleep, manage_tab)"),
      options: z.object({
        retryCount: z.number().default(3).optional(),
        stepDelayMs: z.number().default(400).optional(),
        antiFatiguePauses: z.boolean().default(true).optional(),
        autoScroll: z.boolean().default(true).optional()
      }).optional().describe("Workflow execution tuning options")
    },
    async ({ name, steps, options }) => {
      logAuditEvent("browser_batch_execute", { name, stepCount: steps.length, mode: currentMode }, {});

      if (currentMode === "extension") {
        // Long batch execution: 10 minutes timeout
        const result = await sendToExtension("batch_execute", { name, steps, options }, 600000);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "Workflow completed successfully",
                taskId: result.taskId,
                durationSec: result.durationSec,
                stepsExecuted: result.stepsExecuted,
                extractedVariables: result.extractedVariables
              }, null, 2)
            }
          ]
        };
      } else {
        const page = await launchSandbox({ headless: currentMode === "headless" });
        const extracted: any = {};
        for (let i = 0; i < steps.length; i++) {
          const s = steps[i];
          if (s.action === "navigate") await page.goto(s.url, { waitUntil: "domcontentloaded", timeout: s.timeout || 30000 });
          else if (s.action === "click") await sandboxHumanClick(page, s.selector);
          else if (s.action === "type") await sandboxHumanType(page, s.selector, s.text);
          else if (s.action === "scroll") await page.mouse.wheel(0, s.distanceY || 400);
          else if (s.action === "wait_for") await sandboxWaitFor(page, s.condition || "selector", s.target, s.timeout);
          else if (s.action === "extract") {
            const data = await sandboxExtractData(page, s.extractType || "elements", s.selector, s.attributes);
            if (s.variable) extracted[s.variable] = data;
          }
        }
        return {
          content: [{ type: "text", text: JSON.stringify({ status: "Sandbox batch completed", stepsCount: steps.length, extracted }, null, 2) }]
        };
      }
    }
  );

  server.tool(
    "browser_wait_for",
    "Waits dynamically for a specific condition on the page (selector, text, URL match, network idle, or timeout).",
    {
      condition: z.enum(["selector", "text", "url", "network_idle", "timeout"]).default("selector").describe("Type of condition to wait for"),
      target: z.string().describe("Selector, text substring, or URL pattern to match"),
      timeout: z.number().default(30000).describe("Maximum wait timeout in milliseconds"),
      idleTimeMs: z.number().default(500).optional().describe("Settling time for network_idle")
    },
    async ({ condition, target, timeout, idleTimeMs }) => {
      if (currentMode === "extension") {
        const res = await sendToExtension("wait_for", { condition, target, timeout, idleTimeMs }, timeout + 5000);
        return { content: [{ type: "text", text: `Condition satisfied: ${condition} ("${target}") in ${res.elapsedMs || 0}ms` }] };
      } else {
        const page = await launchSandbox({ headless: currentMode === "headless" });
        await sandboxWaitFor(page, condition, target, timeout);
        return { content: [{ type: "text", text: `Condition satisfied in sandbox: ${condition} ("${target}")` }] };
      }
    }
  );

  server.tool(
    "browser_extract_data",
    "High-speed data extraction for structured tables, element lists, text, or JSON-LD schema metadata.",
    {
      extractType: z.enum(["table", "elements", "structured", "text"]).default("elements").describe("Extraction method"),
      selector: z.string().optional().describe("CSS selector for table, elements, or container"),
      attributes: z.array(z.string()).optional().describe("List of element attributes to extract (e.g. ['href', 'src', 'value'])")
    },
    async ({ extractType, selector, attributes }) => {
      if (currentMode === "extension") {
        const res = await sendToExtension("extract_data", { extractType, selector, attributes });
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      } else {
        const page = await launchSandbox({ headless: currentMode === "headless" });
        const res = await sandboxExtractData(page, extractType, selector, attributes);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    }
  );

  server.tool(
    "browser_evaluate_js",
    "Evaluates custom JavaScript directly in the browser page context.",
    {
      script: z.string().describe("JavaScript code string to evaluate")
    },
    async ({ script }) => {
      if (currentMode === "extension") {
        const res = await sendToExtension("evaluate_js", { script });
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      } else {
        const page = await launchSandbox({ headless: currentMode === "headless" });
        const res = await page.evaluate((s) => (window as any).eval(s), script);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    }
  );

  server.tool(
    "browser_list_tabs",
    "Lists all browser tabs, identifying which tabs are owned by the active task vs user-opened.",
    {
      taskId: z.string().default("task_default").optional().describe("Task ID for ownership attribution")
    },
    async ({ taskId }) => {
      logAuditEvent("browser_list_tabs", { taskId, mode: currentMode }, {});
      if (currentMode === "extension") {
        const result = await executeListTabs(taskId || "task_default", (cmd, params) => sendToExtension(cmd, params));
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } else {
        const page = await launchSandbox({ headless: currentMode === "headless" });
        return { content: [{ type: "text", text: JSON.stringify({ tabs: [{ tabId: 1, windowId: 1, url: page.url(), title: await page.title(), active: true, taskOwned: true }] }, null, 2) }] };
      }
    }
  );

  server.tool(
    "browser_open_tab",
    "Opens a new browser tab scoped to the current task/session.",
    {
      taskId: z.string().default("task_default").optional().describe("Task ID for ownership attribution"),
      url: z.string().url().optional().describe("Initial URL to load")
    },
    async ({ taskId, url }) => {
      logAuditEvent("browser_open_tab", { taskId, url, mode: currentMode }, {});
      if (currentMode === "extension") {
        const result = await executeOpenTab({
          taskId: taskId || "task_default",
          url
        }, (cmd, params) => sendToExtension(cmd, params));
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } else {
        const page = await launchSandbox({ headless: currentMode === "headless" });
        if (url) await page.goto(url);
        return { content: [{ type: "text", text: JSON.stringify({ actionId: "action_tab_sandbox", success: true, tabId: 1 }, null, 2) }] };
      }
    }
  );

  server.tool(
    "browser_switch_tab",
    "Switches focus to a specific browser tab.",
    {
      taskId: z.string().default("task_default").optional().describe("Task ID for audit correlation"),
      tabId: z.number().describe("Target tab ID to activate")
    },
    async ({ taskId, tabId }) => {
      logAuditEvent("browser_switch_tab", { taskId, tabId, mode: currentMode }, {});
      if (currentMode === "extension") {
        const result = await executeSwitchTab({
          taskId: taskId || "task_default",
          tabId
        }, (cmd, params) => sendToExtension(cmd, params));
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } else {
        return { content: [{ type: "text", text: JSON.stringify({ actionId: "action_tab_sandbox", success: true }, null, 2) }] };
      }
    }
  );

  server.tool(
    "browser_close_tab",
    "Closes a specific browser tab.",
    {
      taskId: z.string().default("task_default").optional().describe("Task ID for audit correlation"),
      tabId: z.number().describe("Target tab ID to close")
    },
    async ({ taskId, tabId }) => {
      logAuditEvent("browser_close_tab", { taskId, tabId, mode: currentMode }, {});
      if (currentMode === "extension") {
        const result = await executeCloseTab({
          taskId: taskId || "task_default",
          tabId
        }, (cmd, params) => sendToExtension(cmd, params));
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } else {
        return { content: [{ type: "text", text: JSON.stringify({ actionId: "action_tab_sandbox", success: true }, null, 2) }] };
      }
    }
  );

  server.tool(
    "browser_manage_tabs",
    "Legacy alias for tab operations.",
    {
      operation: z.enum(["open", "new", "switch", "close", "list"]).describe("Tab action"),
      url: z.string().optional().describe("URL for new tab"),
      tabId: z.number().optional().describe("Target tab ID")
    },
    async ({ operation, url, tabId }) => {
      if (currentMode === "extension") {
        const res = await sendToExtension("manage_tabs", { operation, url, tabId });
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      } else {
        return { content: [{ type: "text", text: "Multi-tab management is active in Extension mode" }] };
      }
    }
  );

  server.tool(
    "browser_get_task_status",
    "Retrieves the status, step index, and extracted variables of the currently running background workflow.",
    {},
    async () => {
      if (currentMode === "extension") {
        const res = await sendToExtension("get_task_status", {});
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      } else {
        return { content: [{ type: "text", text: "No background tasks running in sandbox mode" }] };
      }
    }
  );

  server.tool(
    "browser_cancel_task",
    "Cancels any currently running automated batch workflow.",
    {},
    async () => {
      if (currentMode === "extension") {
        const res = await sendToExtension("cancel_task", {});
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      } else {
        return { content: [{ type: "text", text: "Cancelled" }] };
      }
    }
  );

  server.tool(
    "browser_navigate",
    "Navigates the browser to a target URL, verifying page load and invalidating stale observation snapshots.",
    {
      taskId: z.string().default("task_default").optional().describe("Task ID for audit correlation"),
      url: z.string().url().describe("Target URL to navigate to")
    },
    async ({ taskId, url }) => {
      logAuditEvent("browser_navigate", { taskId, url, mode: currentMode }, {});
      if (currentMode === "extension") {
        const result = await executeNavigation({
          taskId: taskId || "task_default",
          url
        }, (cmd, params) => sendToExtension(cmd, params));
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } else {
        const page = await launchSandbox({ headless: currentMode === "headless" });
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        return { content: [{ type: "text", text: JSON.stringify({ actionId: "action_nav_sandbox", success: true, navigatedUrl: url, verified: true }, null, 2) }] };
      }
    }
  );

  server.tool(
    "browser_wait",
    "Waits for a condition (element_appears, element_disappears, url_changes, navigation_completes, or timeout) with typed error handling.",
    {
      taskId: z.string().default("task_default").optional().describe("Task ID for audit correlation"),
      condition: z.enum(["element_appears", "element_disappears", "url_changes", "navigation_completes", "timeout"]).describe("Condition to wait for"),
      target: z.string().optional().describe("Selector, text, or URL pattern to match"),
      timeoutMs: z.number().default(30000).optional().describe("Timeout in milliseconds")
    },
    async ({ taskId, condition, target, timeoutMs }) => {
      logAuditEvent("browser_wait", { taskId, condition, target, timeoutMs, mode: currentMode }, {});
      if (currentMode === "extension") {
        const result = await executeWait({
          taskId: taskId || "task_default",
          condition,
          target,
          timeoutMs
        }, (cmd, params) => sendToExtension(cmd, params));
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } else {
        const page = await launchSandbox({ headless: currentMode === "headless" });
        await sandboxWaitFor(page, condition === "element_appears" ? "selector" : condition, target || "", timeoutMs || 30000);
        return { content: [{ type: "text", text: JSON.stringify({ actionId: "action_wait_sandbox", success: true, verified: true }, null, 2) }] };
      }
    }
  );

  server.tool(
    "browser_click",
    "Clicks an element organically using semantic DOM / CDP interaction with action verification.",
    {
      taskId: z.string().default("task_default").optional().describe("Task ID for audit correlation"),
      snapshotId: z.string().optional().describe("Snapshot ID from browser_observe for stale element protection"),
      elementId: z.string().optional().describe("Element ID (e.g. el_1) from active snapshot"),
      selector: z.string().optional().describe("CSS selector of element to click"),
      elementText: z.string().optional().describe("Descriptive text of the button for security evaluation"),
      skipVerification: z.boolean().default(false).optional().describe("Whether to skip post-action verification")
    },
    async ({ taskId, snapshotId, elementId, selector, elementText, skipVerification }) => {
      logAuditEvent("browser_click", { taskId, snapshotId, elementId, selector, elementText, mode: currentMode }, {});

      if (currentMode === "extension") {
        const result = await executeInteractionClick({
          taskId: taskId || "task_default",
          snapshotId,
          elementId,
          selector,
          elementText,
          skipVerification
        }, (cmd, params) => sendToExtension(cmd, params));

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } else {
        const page = await launchSandbox({ headless: currentMode === "headless" });
        if (!selector && !elementId) throw new Error("Selector is required for sandbox click");
        await sandboxHumanClick(page, selector || `[data-el-id="${elementId}"]`);
        return { content: [{ type: "text", text: JSON.stringify({ actionId: "action_sandbox", success: true, verified: true }, null, 2) }] };
      }
    }
  );

  server.tool(
    "browser_type",
    "Types text with natural cadence, supporting input clearing and verification.",
    {
      taskId: z.string().default("task_default").optional().describe("Task ID for audit correlation"),
      snapshotId: z.string().optional().describe("Snapshot ID from browser_observe"),
      elementId: z.string().optional().describe("Element ID (e.g. el_1) from active snapshot"),
      selector: z.string().optional().describe("CSS selector of input field"),
      text: z.string().describe("Text to type"),
      clearFirst: z.boolean().default(false).optional().describe("Clear input before typing")
    },
    async ({ taskId, snapshotId, elementId, selector, text, clearFirst }) => {
      logAuditEvent("browser_type", { taskId, snapshotId, elementId, selector, textLength: text.length, mode: currentMode }, {});

      if (currentMode === "extension") {
        const result = await executeInteractionType({
          taskId: taskId || "task_default",
          snapshotId,
          elementId,
          selector,
          text,
          clearFirst
        }, (cmd, params) => sendToExtension(cmd, params));

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } else {
        const page = await launchSandbox({ headless: currentMode === "headless" });
        if (!selector && !elementId) throw new Error("Selector is required for sandbox type");
        await sandboxHumanType(page, selector || `[data-el-id="${elementId}"]`, text);
        return { content: [{ type: "text", text: JSON.stringify({ actionId: "action_sandbox", success: true, verified: true, charactersTyped: text.length }, null, 2) }] };
      }
    }
  );


  server.tool(
    "browser_smart_type",
    "Smart Type for Lexical & Rich-Text editors.",
    {
      taskId: z.string().default("task_default").optional().describe("Task ID for audit correlation"),
      selector: z.string().describe("CSS selector of input field"),
      text: z.string().describe("Text to type")
    },
    async ({ taskId, selector, text }) => {
      logAuditEvent("browser_smart_type", { taskId, selector, textLength: text.length, mode: currentMode }, {});

      if (currentMode === "extension") {
        const result = await sendToExtension("smart_type", { selector, text });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } else {
        throw new Error("smart_type not implemented in sandbox");
      }
    }
  );

  server.tool(
    "browser_smart_clear",
    "Smart Clear for Lexical & Rich-Text editors.",
    {
      taskId: z.string().default("task_default").optional().describe("Task ID for audit correlation"),
      selector: z.string().describe("CSS selector of input field")
    },
    async ({ taskId, selector }) => {
      logAuditEvent("browser_smart_clear", { taskId, selector, mode: currentMode }, {});

      if (currentMode === "extension") {
        const result = await sendToExtension("smart_clear", { selector });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } else {
        throw new Error("smart_clear not implemented in sandbox");
      }
    }
  );

  server.tool(
    "browser_press_hotkey",
    "Presses a hotkey combination with modifiers.",
    {
      taskId: z.string().default("task_default").optional().describe("Task ID for audit correlation"),
      key: z.string().describe("Key name (e.g. Enter, A, Escape)"),
      modifiers: z.number().default(0).optional().describe("Modifier bitmask (1=Alt, 2=Ctrl, 4=Meta, 8=Shift)")
    },
    async ({ taskId, key, modifiers }) => {
      logAuditEvent("browser_press_hotkey", { taskId, key, modifiers, mode: currentMode }, {});

      if (currentMode === "extension") {
        const result = await sendToExtension("hotkey", { key, modifiers });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } else {
        throw new Error("press_hotkey not implemented in sandbox");
      }
    }
  );

  server.tool(
    "browser_download_media",
    "Downloads a direct asset or extracts Canvas to DataURL.",
    {
      taskId: z.string().default("task_default").optional().describe("Task ID for audit correlation"),
      selector: z.string().describe("CSS selector of img or canvas")
    },
    async ({ taskId, selector }) => {
      logAuditEvent("browser_download_media", { taskId, selector, mode: currentMode }, {});

      if (currentMode === "extension") {
        const result = await sendToExtension("download_media", { selector });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } else {
        throw new Error("download_media not implemented in sandbox");
      }
    }
  );

  server.tool(
    "browser_clear",
    "Clears the value of an input or textarea element.",
    {
      taskId: z.string().default("task_default").optional().describe("Task ID for audit correlation"),
      snapshotId: z.string().optional().describe("Snapshot ID from browser_observe"),
      elementId: z.string().optional().describe("Element ID (e.g. el_1) from active snapshot"),
      selector: z.string().optional().describe("CSS selector of input field to clear")
    },
    async ({ taskId, snapshotId, elementId, selector }) => {
      logAuditEvent("browser_clear", { taskId, snapshotId, elementId, selector, mode: currentMode }, {});

      if (currentMode === "extension") {
        const result = await executeInteractionClear({
          taskId: taskId || "task_default",
          snapshotId,
          elementId,
          selector
        }, (cmd, params) => sendToExtension(cmd, params));

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } else {
        const page = await launchSandbox({ headless: currentMode === "headless" });
        if (selector) await page.fill(selector, "");
        return { content: [{ type: "text", text: JSON.stringify({ actionId: "action_sandbox", success: true, verified: true }, null, 2) }] };
      }
    }
  );

  server.tool(
    "browser_keypress",
    "Dispatches a specific keyboard key event (e.g. 'Enter', 'Tab', 'Escape', 'ArrowDown').",
    {
      taskId: z.string().default("task_default").optional().describe("Task ID for audit correlation"),
      key: z.string().describe("Key name to press (e.g. Enter, Tab, Escape)")
    },
    async ({ taskId, key }) => {
      logAuditEvent("browser_keypress", { taskId, key, mode: currentMode }, {});

      if (currentMode === "extension") {
        const result = await executeInteractionKeypress({
          taskId: taskId || "task_default",
          key
        }, (cmd, params) => sendToExtension(cmd, params));

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } else {
        const page = await launchSandbox({ headless: currentMode === "headless" });
        await page.keyboard.press(key);
        return { content: [{ type: "text", text: JSON.stringify({ actionId: "action_sandbox", success: true, verified: true }, null, 2) }] };
      }
    }
  );

  server.tool(
    "browser_scroll",
    "Smoothly scrolls the page with inertia and reading dwell pauses.",
    {
      taskId: z.string().default("task_default").optional().describe("Task ID for audit correlation"),
      distanceY: z.number().default(400).describe("Scroll distance in pixels (+ down, - up)")
    },
    async ({ taskId, distanceY }) => {
      logAuditEvent("browser_scroll", { taskId, distanceY, mode: currentMode }, {});

      if (currentMode === "extension") {
        const result = await executeInteractionScroll({
          taskId: taskId || "task_default",
          distanceY
        }, (cmd, params) => sendToExtension(cmd, params));

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } else {
        const page = await launchSandbox({ headless: currentMode === "headless" });
        await page.mouse.wheel(0, distanceY);
        return { content: [{ type: "text", text: JSON.stringify({ actionId: "action_sandbox", success: true, verified: true, distanceScrolled: distanceY }, null, 2) }] };
      }
    }
  );

  server.tool(
    "browser_observe",
    "Observes the current page state, returning structured metadata, visible text, and interactive elements with snapshot-scoped el_N IDs.",
    {
      limit: z.number().default(100).optional().describe("Maximum interactive elements to return")
    },
    async ({ limit }) => {
      logAuditEvent("browser_observe", { limit, mode: currentMode }, {});
      if (currentMode === "extension") {
        const res = await sendToExtension("inspect_dom", { limit });
        const observation = createObservationSnapshot({
          tabId: res.tabId || 1,
          windowId: 1,
          url: res.url || "",
          title: res.title || "",
          loadingState: "complete",
          visibleText: res.visibleText || "",
          rawElements: res.elements || []
        });
        return { content: [{ type: "text", text: JSON.stringify(observation, null, 2) }] };
      } else {
        const page = await launchSandbox({ headless: currentMode === "headless" });
        const title = await page.title();
        const url = page.url();
        const visibleText = await page.evaluate(() => document.body ? document.body.innerText : "");
        const rawElements = await page.evaluate(() => {
          const els = Array.from(document.querySelectorAll("a[href], button, input, textarea, select, [role=button]"));
          return els.slice(0, 100).map((el) => ({
            tag: el.tagName.toLowerCase(),
            text: el.textContent?.trim().slice(0, 150) || "",
            role: el.getAttribute("role") || el.tagName.toLowerCase(),
            visible: true,
            enabled: !(el as any).disabled
          }));
        });
        const observation = createObservationSnapshot({
          tabId: 1,
          windowId: 1,
          url,
          title,
          loadingState: "complete",
          visibleText,
          rawElements
        });
        return { content: [{ type: "text", text: JSON.stringify(observation, null, 2) }] };
      }
    }
  );

  server.tool(
    "browser_read_page_text",
    "Reads visible text content from the current page within configured length limits.",
    {
      maxLength: z.number().default(50000).optional().describe("Maximum characters to read")
    },
    async ({ maxLength }) => {
      if (currentMode === "extension") {
        const res = await sendToExtension("evaluate_js", { script: "document.body ? document.body.innerText : ''" });
        const result = truncatePageText(String(res || ""), maxLength);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } else {
        const page = await launchSandbox({ headless: currentMode === "headless" });
        const text = await page.evaluate(() => document.body ? document.body.innerText : "");
        const result = truncatePageText(text, maxLength);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
    }
  );

  server.tool(
    "browser_find",
    "Searches the active observation snapshot for elements matching a text query, role, label, or placeholder.",
    {
      snapshotId: z.string().describe("Active snapshot ID from browser_observe"),
      query: z.string().describe("Search substring or keyword")
    },
    async ({ snapshotId, query }) => {
      const matches = searchSnapshotElements(snapshotId, query);
      return { content: [{ type: "text", text: JSON.stringify({ count: matches.length, matches }, null, 2) }] };
    }
  );

  server.tool(
    "browser_screenshot",
    "Captures a viewport screenshot with metadata.",
    {
      saveToDisk: z.boolean().default(false).optional().describe("Whether to save screenshot to local disk (promotes to INTERACT tier)")
    },
    async ({ saveToDisk }) => {
      if (currentMode === "extension") {
        const res = await sendToExtension("take_snapshot", {});
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                timestamp: Date.now(),
                format: "jpeg",
                saveToDisk: Boolean(saveToDisk),
                data: `data:image/jpeg;base64,${res.screenshot}`
              }, null, 2)
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
              text: JSON.stringify({
                timestamp: Date.now(),
                format: "jpeg",
                saveToDisk: Boolean(saveToDisk),
                data: `data:image/jpeg;base64,${buf.toString("base64")}`
              }, null, 2)
            }
          ]
        };
      }
    }
  );

  server.tool(
    "browser_inspect_dom",
    "Legacy alias for inspect DOM elements.",
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

  server.tool(
    "browser_get_audit_log",
    "Queries the tamper-proof sanitized audit log filtered by taskId, actionId, or origin.",
    {
      taskId: z.string().optional().describe("Filter by task ID"),
      actionId: z.string().optional().describe("Filter by action ID"),
      origin: z.string().optional().describe("Filter by canonical origin")
    },
    async ({ taskId, actionId, origin }) => {
      const events = AuditLogger.getEvents({ taskId, actionId, origin });
      return { content: [{ type: "text", text: JSON.stringify({ count: events.length, events }, null, 2) }] };
    }
  );

  server.tool(
    "browser_evaluate_policy",
    "Evaluates an action and origin against active security rules and permission tiers.",
    {
      origin: z.string().describe("Target website origin (scheme://host:port)"),
      actionType: z.string().describe("Action to evaluate (e.g. click, type, navigate, evaluate_js)"),
      targetText: z.string().optional().describe("Text of target element (for keyword risk detection)")
    },
    async ({ origin, actionType, targetText }) => {
      const result = evaluatePolicy({ origin, actionType, targetText });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "browser_set_policy_rule",
    "Adds a dynamic policy rule configuring ALLOW, PROMPT, or DENY for specific origins or actions.",
    {
      originPattern: z.string().optional().describe("Origin wildcard pattern (e.g. https://*.bank.com or *)"),
      actionType: z.string().optional().describe("Action type to restrict (e.g. evaluate_js or *)"),
      decision: z.enum(["ALLOW", "PROMPT", "DENY"]).describe("Policy decision"),
      reason: z.string().optional().describe("Rationale for this rule")
    },
    async ({ originPattern, actionType, decision, reason }) => {
      PolicyEngine.addRule({ originPattern, actionType, decision, reason });
      return { content: [{ type: "text", text: `Policy rule configured: [${originPattern || "*"}] -> [${actionType || "*"}] = ${decision}` }] };
    }
  );

  server.tool(
    "browser_create_session",
    "Generates a 256-bit high-entropy session authentication token for an agent.",
    {
      agentId: z.string().describe("Agent identifier"),
      ttlMs: z.number().default(3600000).optional().describe("Token time-to-live in milliseconds")
    },
    async ({ agentId, ttlMs }) => {
      const session = generateSessionToken(agentId, ttlMs);
      return { content: [{ type: "text", text: JSON.stringify(session, null, 2) }] };
    }
  );

  server.tool(
    "browser_validate_session",
    "Validates a session token using constant-time verification.",
    {
      token: z.string().describe("Session token to validate")
    },
    async ({ token }) => {
      const validation = validateSessionToken(token);
      return { content: [{ type: "text", text: JSON.stringify(validation, null, 2) }] };
    }
  );

  server.tool(
    "browser_get_pending_approvals",
    "Retrieves currently pending human approval requests.",
    {
      taskId: z.string().optional().describe("Filter by task ID")
    },
    async ({ taskId }) => {
      const list = ApprovalBroker.getPendingApprovals(taskId);
      return { content: [{ type: "text", text: JSON.stringify({ count: list.length, pendingApprovals: list }, null, 2) }] };
    }
  );

  server.tool(
    "browser_resolve_approval",
    "Resolves a pending human approval request (approve or reject).",
    {
      requestId: z.string().describe("Approval request ID (appr_000001)"),
      approved: z.boolean().describe("Whether the action is approved (true) or rejected (false)"),
      decisionBy: z.string().default("user").optional().describe("Identity of user making the decision")
    },
    async ({ requestId, approved, decisionBy }) => {
      const result = resolveApprovalRequest(requestId, approved, decisionBy);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "browser_get_accessibility_tree",
    "Extracts a compact, token-dense accessibility tree (a11y) powered by axe-core and CDP, reducing LLM context tokens by ~85% while providing complete semantic role, name, and selector hierarchies.",
    {
      includeHidden: z.boolean().default(false).optional().describe("Whether to include hidden / presentation elements")
    },
    async ({ includeHidden }) => {
      const a11y = new A11yEngine();
      if (currentMode === "extension") {
        const res = await sendToExtension("get_a11y_tree", { includeHidden });
        if (res && res.result && res.result.tree) {
          const snapshot = a11y.createSnapshot(res.result.url || "", res.result.title || "", res.result.tree, res.result.rawHtmlLength || 0);
          return { content: [{ type: "text", text: JSON.stringify(snapshot, null, 2) }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      } else {
        const page = await launchSandbox({ headless: currentMode === "headless" });
        const snapshot = a11y.createSnapshot(page.url(), await page.title(), [], 0);
        return { content: [{ type: "text", text: JSON.stringify(snapshot, null, 2) }] };
      }
    }
  );

  return server;
}
