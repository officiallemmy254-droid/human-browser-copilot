// Human Browser Copilot - Background Service Worker (Resilient & Long-Running Tasks)
import { attachToTab, detachDebugger, humanMouseMove, humanClick, humanType, humanScroll, humanKeypress, humanClear, captureScreenshot, setProfile, setPaused, sendCDP, evaluateScript, waitForSelector, waitForElementDisappears, waitForText, waitForUrl, waitForNetworkIdle, extractTableData, extractElements, extractStructuredData, triggerGarbageCollection, smartType, smartClear, humanHotkey, downloadMedia, getAccessibilityTree } from "./debugger_cdp.js";
import { evaluateActionSecurity, createApprovalRequest, resolveApproval, getPendingApprovals } from "./security_guard.js";
import { startKeepalive, registerOffscreenPort, setTaskActive, isTaskActive } from "./keepalive.js";
import { executeWorkflow, pauseWorkflow, resumeWorkflow, cancelWorkflow, getWorkflowStatus, setBroadcastCallback } from "./workflow_engine.js";

const NATIVE_HOST_NAME = "com.antigravity.human_browser";
let nativePort = null;
let activeTabId = null;
let isAgentPaused = false;
let pendingCaptchaResolution = null;
let reconnectTimer = null;
let reconnectAttempts = 0;

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// SPA Route Transition Auto-Rebind
chrome.webNavigation?.onHistoryStateUpdated.addListener(async (details) => {
  if (details.frameId === 0) {
    await ensureContentScripts(details.tabId);
  }
});
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    await ensureContentScripts(tabId);
  }
});


// Listen for offscreen port keepalive connection
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "offscreen-keepalive") {
    registerOffscreenPort(port);
  }
});

// Periodic alarm handler to prevent worker idling during long runs
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "human_browser_keepalive_alarm") {
    try {
      await chrome.storage.local.set({ lastAlarmPing: Date.now() });
    } catch (e) {}
  }
});

// Forward workflow events to native host
setBroadcastCallback((event) => {
  sendToNativeHost({ event: "WORKFLOW_EVENT", data: event });
});

function connectToNativeHost() {
  if (nativePort) return;

  try {
    nativePort = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    reconnectAttempts = 0;
    startKeepalive();

    nativePort.onMessage.addListener(async (msg) => {
      console.log("[NativeHost -> Extension]", msg);
      handleAgentCommand(msg);
    });

    nativePort.onDisconnect.addListener(() => {
      console.log("[NativeHost] Disconnected. Scheduling auto-reconnect...");
      nativePort = null;
      scheduleNativeReconnect();
    });
  } catch (e) {
    console.warn("[NativeHost] Connection failed:", e);
    scheduleNativeReconnect();
  }
}

let extensionWs = null;
function connectDirectWebSocket() {
  if (extensionWs && (extensionWs.readyState === WebSocket.OPEN || extensionWs.readyState === WebSocket.CONNECTING)) return;

  try {
    extensionWs = new WebSocket("ws://localhost:9333");

    extensionWs.onopen = () => {
      console.log("[ServiceWorker] Direct WebSocket connected to ws://localhost:9333");
      try {
        extensionWs.send(JSON.stringify({ isExtension: true, event: "EXTENSION_READY" }));
      } catch (e) {}
      startKeepalive();
    };

    extensionWs.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        console.log("[DirectWS -> Extension]", msg);
        handleAgentCommand(msg);
      } catch (err) {}
    };

    extensionWs.onclose = () => {
      extensionWs = null;
      setTimeout(connectDirectWebSocket, 3000);
    };

    extensionWs.onerror = () => {
      try { extensionWs.close(); } catch (e) {}
    };
  } catch (e) {
    setTimeout(connectDirectWebSocket, 3000);
  }
}

// Immediately establish connections
connectToNativeHost();
connectDirectWebSocket();

chrome.runtime.onInstalled.addListener(() => {
  connectToNativeHost();
  connectDirectWebSocket();
});

chrome.runtime.onStartup.addListener(() => {
  connectToNativeHost();
  connectDirectWebSocket();
});

function scheduleNativeReconnect() {
  if (reconnectTimer) return;
  const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts++), 15000);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectToNativeHost();
  }, delay);
}

function sendToNativeHost(msg) {
  if (nativePort) {
    try {
      nativePort.postMessage(msg);
      return true;
    } catch (e) {
      console.warn("[NativeHost] Send failed:", e);
    }
  }
  if (extensionWs && extensionWs.readyState === WebSocket.OPEN) {
    try {
      extensionWs.send(JSON.stringify(msg));
      return true;
    } catch (e) {
      console.warn("[DirectWS] Send failed:", e);
    }
  }
  return false;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab) return tab;
  const [anyTab] = await chrome.tabs.query({ active: true });
  if (anyTab) return anyTab;
  const all = await chrome.tabs.query({});
  return all[0] || null;
}

function isRestrictedUrl(url = "") {
  return url.startsWith("chrome://") ||
         url.startsWith("brave://") ||
         url.startsWith("edge://") ||
         url.startsWith("chrome-extension://") ||
         url.startsWith("devtools://") ||
         url.startsWith("about:");
}

async function ensureContentScripts(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/tracer.js", "content/highlighter.js", "content/captcha_detector.js"]
    });
  } catch (e) {}
}

async function handleAgentCommand(msg) {
  const { id, command, params = {} } = msg;

  try {
    if (command === "ping") {
      sendToNativeHost({ id, ok: true, pong: true, timestamp: Date.now(), isTaskActive: isTaskActive() });
      return;
    }

    if (command === "get_health") {
      sendToNativeHost({
        id,
        ok: true,
        result: {
          version: "2.0.0",
          isDebuggerAttached: !!activeTabId,
          attachedTabId: activeTabId,
          isAgentPaused: isAgentPaused,
          isTaskActive: isTaskActive()
        }
      });
      return;
    }

    if (command === "get_task_status") {
      const status = getWorkflowStatus();
      sendToNativeHost({ id, ok: true, result: status });
      return;
    }

    if (command === "pause_task") {
      const res = pauseWorkflow();
      sendToNativeHost({ id, ok: res.ok, result: res });
      return;
    }

    if (command === "resume_task") {
      const res = resumeWorkflow();
      sendToNativeHost({ id, ok: res.ok, result: res });
      return;
    }

    if (command === "cancel_task") {
      const res = cancelWorkflow();
      sendToNativeHost({ id, ok: res.ok, result: res });
      return;
    }

    let tab = await getActiveTab();

    if (command === "navigate") {
      if (!tab || !tab.id) {
        tab = await chrome.tabs.create({ url: params.url, active: true });
      } else {
        await chrome.tabs.update(tab.id, { url: params.url });
      }
      activeTabId = tab.id;
      sendToNativeHost({ id, ok: true, result: { navigated: true, url: params.url, tabId: tab.id } });
      return;
    }

    if (command === "get_a11y_tree") {
      if (!tab || !tab.id) throw new Error("No active tab found for accessibility tree extraction");
      const a11yResult = await getAccessibilityTree(tab.id, params.includeHidden);
      sendToNativeHost({ id, ok: true, result: a11yResult });
      return;
    }

    if (command === "manage_tabs") {
      const { operation, url, tabId: targetTabId } = params;
      if (operation === "open" || operation === "new") {
        const newTab = await chrome.tabs.create({ url: url || "about:blank", active: true });
        await attachToTab(newTab.id);
        activeTabId = newTab.id;
        sendToNativeHost({ id, ok: true, result: { tabId: newTab.id, url: newTab.url } });
      } else if (operation === "close") {
        const toClose = targetTabId || tab.id;
        await chrome.tabs.remove(toClose);
        sendToNativeHost({ id, ok: true, result: { tabId: toClose, closed: true } });
      } else if (operation === "switch") {
        await chrome.tabs.update(targetTabId, { active: true });
        await attachToTab(targetTabId);
        activeTabId = targetTabId;
        sendToNativeHost({ id, ok: true, result: { tabId: targetTabId, active: true } });
      } else if (operation === "list") {
        const tabs = await chrome.tabs.query({});
        sendToNativeHost({
          id,
          ok: true,
          result: tabs.map(t => ({ id: t.id, title: t.title, url: t.url, active: t.active }))
        });
      }
      return;
    }

    if (!tab || !tab.id) {
      sendToNativeHost({ id, ok: false, error: "No active browser tab found", code: "TAB_NOT_FOUND" });
      return;
    }
    activeTabId = tab.id;

    if (isRestrictedUrl(tab.url)) {
      sendToNativeHost({
        id,
        ok: false,
        error: `Current active tab is on an internal browser page (${tab.url}). Please navigate to a web URL first.`,
        code: "ORIGIN_NOT_ALLOWED"
      });
      return;
    }

    try {
      await attachToTab(activeTabId);
    } catch (e) {
      console.warn("[Debugger] Attach warning:", e);
    }

    // Evaluate action security
    const sec = evaluateActionSecurity(command, params, tab.url || "");
    if (sec.requiresApproval) {
      chrome.tabs.sendMessage(activeTabId, {
        type: "STATUS_UPDATE",
        state: "paused",
        message: `Paused: ${sec.reason}`
      }).catch(() => {});

      createApprovalRequest(command, params, sec.reason, async ({ approved }) => {
        if (!approved) {
          sendToNativeHost({ id, ok: false, error: `User rejected action: ${sec.reason}`, code: "POLICY_DENIED" });
          return;
        }
        const result = await executeAction(command, params, activeTabId);
        sendToNativeHost({ id, ok: true, result });
      });
      return;
    }

    const result = await executeAction(command, params, activeTabId);
    sendToNativeHost({ id, ok: true, result });

  } catch (err) {
    sendToNativeHost({ id, ok: false, error: err.message, code: err.code || "UNKNOWN_ERROR" });
  }
}

async function executeAction(command, params, tabId) {
  switch (command) {
    case "attach":
      return await attachToTab(tabId);

    case "set_profile":
      setProfile(params.profile);
      return { profile: params.profile };

    case "batch_execute":
      return await executeWorkflow(params, tabId);

    case "wait_for": {
      const { condition = "selector", target, timeout = 30000, idleTimeMs = 500, ms = 1000 } = params;
      if (condition === "selector" || condition === "element_appears") return await waitForSelector(tabId, target, timeout);
      if (condition === "element_disappears") return await waitForElementDisappears(tabId, target, timeout);
      if (condition === "text") return await waitForText(tabId, target, timeout);
      if (condition === "url") return await waitForUrl(tabId, target, timeout);
      if (condition === "network_idle" || condition === "navigation_completes") return await waitForNetworkIdle(tabId, idleTimeMs, timeout);
      if (condition === "timeout" || condition === "sleep") {
        await new Promise(r => setTimeout(r, ms));
        return { sleptMs: ms };
      }
      throw new Error(`Unknown wait condition: ${condition}`);
    }

    case "extract_data": {
      const { extractType = "elements", selector, attributes } = params;
      if (extractType === "table") return await extractTableData(tabId, selector || "table");
      if (extractType === "elements") return await extractElements(tabId, selector || "a", attributes);
      if (extractType === "structured") return await extractStructuredData(tabId);
      if (extractType === "text") {
        return await evaluateScript(tabId, `
          (function() {
            const el = document.querySelector(${JSON.stringify(selector)});
            return el ? el.innerText.trim() : null;
          })()
        `);
      }
      throw new Error(`Unknown extractType: ${extractType}`);
    }

    case "evaluate_js":
      return await evaluateScript(tabId, params.script, params.returnByValue ?? true);

    case "garbage_collect":
      await triggerGarbageCollection(tabId);
      return { collected: true };

    case "click": {
      let x = params.x;
      let y = params.y;
      if (x === undefined || y === undefined) {
        let res = await chrome.tabs.sendMessage(tabId, {
          type: "GET_ELEMENT_COORDINATES",
          id: params.elementId,
          selector: params.selector
        }).catch(() => null);

        if (!res || !res.ok) {
          await ensureContentScripts(tabId);
          res = await chrome.tabs.sendMessage(tabId, {
            type: "GET_ELEMENT_COORDINATES",
            id: params.elementId,
            selector: params.selector
          }).catch(() => null);
        }

        if (!res || !res.ok) throw new Error(`Element not found: ${params.selector || params.elementId}`);
        x = res.x;
        y = res.y;
      }
      await humanClick(tabId, x, y);
      return { clicked: true, x, y };
    }


    case "smart_type": {
      return await smartType(tabId, params.selector, params.text);
    }
    case "smart_clear": {
      return await smartClear(tabId, params.selector);
    }
    case "hotkey": {
      return await humanHotkey(tabId, params.key, params.modifiers || 0);
    }
    case "download_media": {
      return await downloadMedia(tabId, params.selector);
    }

    case "type": {
      if (params.selector || params.elementId) {
        const res = await chrome.tabs.sendMessage(tabId, {
          type: "GET_ELEMENT_COORDINATES",
          id: params.elementId,
          selector: params.selector
        }).catch(() => null);
        if (res && res.ok) {
          await humanClick(tabId, res.x, res.y);
        }
      }
      await humanType(tabId, params.text);
      return { typed: true, length: params.text.length, verified: true };
    }

    case "clear": {
      return await humanClear(tabId, params.selector);
    }

    case "keypress": {
      return await humanKeypress(tabId, params.key);
    }

    case "scroll": {
      const distance = params.distanceY !== undefined ? params.distanceY : 400;
      await humanScroll(tabId, distance);
      return { scrolled: true, distanceY: distance, verified: true };
    }

    case "inspect_dom": {
      await ensureContentScripts(tabId);
      let res = await chrome.tabs.sendMessage(tabId, {
        type: "HIGHLIGHT_ELEMENTS",
        limit: params.limit || 80
      }).catch(() => null);

      if (!res) {
        const tab = await chrome.tabs.get(tabId);
        res = { title: tab.title, url: tab.url, elements: [] };
      }
      return res;
    }

    case "take_snapshot": {
      const base64 = await captureScreenshot(tabId);
      return { screenshot: base64 };
    }

    case "wait_for_captcha": {
      return new Promise((resolve) => {
        pendingCaptchaResolution = resolve;
      });
    }

    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "OFFSCREEN_HEARTBEAT") {
    sendResponse({ ok: true, timestamp: Date.now() });
    return true;
  }

  if (msg.type === "CAPTCHA_DETECTED") {
    sendToNativeHost({ event: "CAPTCHA_DETECTED", details: msg });
    sendResponse({ ok: true });
  } else if (msg.type === "CAPTCHA_RESOLVED") {
    if (pendingCaptchaResolution) {
      pendingCaptchaResolution({ resolved: true, reason: msg.reason });
      pendingCaptchaResolution = null;
    }
    sendToNativeHost({ event: "CAPTCHA_RESOLVED", details: msg });
    sendResponse({ ok: true });
  } else if (msg.type === "RESOLVE_APPROVAL") {
    const success = resolveApproval(msg.approvalId, msg.approved, msg.userEdits);
    sendResponse({ ok: success });
  } else if (msg.type === "GET_PENDING_APPROVALS") {
    sendResponse({ approvals: getPendingApprovals() });
  } else if (msg.type === "TOGGLE_AGENT_PAUSE" || msg.type === "EMERGENCY_TAKEOVER") {
    isAgentPaused = !isAgentPaused;
    setPaused(isAgentPaused);
    sendToNativeHost({ event: "AGENT_PAUSED", isPaused: isAgentPaused });
    sendResponse({ ok: true, isPaused: isAgentPaused });
  } else if (msg.type === "SET_PROFILE") {
    setProfile(msg.profile);
    sendResponse({ ok: true });
  }
  return true;
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "emergency_takeover") {
    isAgentPaused = !isAgentPaused;
    setPaused(isAgentPaused);
    sendToNativeHost({ event: "AGENT_PAUSED", isPaused: isAgentPaused });
  }
});

startKeepalive();
connectToNativeHost();
