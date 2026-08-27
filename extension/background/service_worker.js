// Human Browser Copilot - Main Background Service Worker
import { attachToTab, detachDebugger, humanMouseMove, humanClick, humanType, humanScroll, captureScreenshot, setProfile, setPaused, sendCDP } from "./debugger_cdp.js";
import { evaluateActionSecurity, createApprovalRequest, resolveApproval, getPendingApprovals } from "./security_guard.js";
import { startKeepalive } from "./keepalive.js";

const NATIVE_HOST_NAME = "com.antigravity.human_browser";
let nativePort = null;
let activeTabId = null;
let isAgentPaused = false;
let pendingCaptchaResolution = null;

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

function connectToNativeHost() {
  try {
    nativePort = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    startKeepalive();

    nativePort.onMessage.addListener(async (msg) => {
      console.log("[NativeHost -> Extension]", msg);
      handleAgentCommand(msg);
    });

    nativePort.onDisconnect.addListener(() => {
      console.log("[NativeHost] Disconnected.");
      nativePort = null;
    });
  } catch (e) {
    console.warn("[NativeHost] Connection failed:", e);
  }
}

function sendToNativeHost(msg) {
  if (nativePort) {
    try {
      nativePort.postMessage(msg);
      return;
    } catch (e) {}
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab) return tab;
  const [anyTab] = await chrome.tabs.query({ active: true });
  return anyTab;
}

function isRestrictedUrl(url = "") {
  return url.startsWith("chrome://") ||
         url.startsWith("brave://") ||
         url.startsWith("edge://") ||
         url.startsWith("chrome-extension://") ||
         url.startsWith("devtools://") ||
         url.startsWith("about:");
}

async function handleAgentCommand(msg) {
  const { id, command, params = {} } = msg;

  try {
    if (command === "ping") {
      sendToNativeHost({ id, ok: true, pong: true, timestamp: Date.now() });
      return;
    }

    let tab = await getActiveTab();

    // If command is navigate, execute navigation directly on active tab or create new tab
    if (command === "navigate") {
      if (!tab || !tab.id) {
        tab = await chrome.tabs.create({ url: params.url, active: true });
      } else {
        await chrome.tabs.update(tab.id, { url: params.url });
      }
      activeTabId = tab.id;
      sendToNativeHost({ id, ok: true, result: { navigated: true, url: params.url } });
      return;
    }

    if (!tab || !tab.id) {
      sendToNativeHost({ id, ok: false, error: "No active browser tab found" });
      return;
    }
    activeTabId = tab.id;

    if (isRestrictedUrl(tab.url)) {
      sendToNativeHost({
        id,
        ok: false,
        error: `Current active tab is on an internal browser page (${tab.url}). Please navigate to a web URL first.`
      });
      return;
    }

    try {
      await attachToTab(activeTabId);
    } catch (e) {
      console.warn("[Debugger] Attach warning:", e);
    }

    const sec = evaluateActionSecurity(command, params, tab.url || "");
    if (sec.requiresApproval) {
      chrome.tabs.sendMessage(activeTabId, {
        type: "STATUS_UPDATE",
        state: "paused",
        message: `Paused: ${sec.reason}`
      }).catch(() => {});

      createApprovalRequest(command, params, sec.reason, async ({ approved }) => {
        if (!approved) {
          sendToNativeHost({ id, ok: false, error: `User rejected action: ${sec.reason}` });
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
    sendToNativeHost({ id, ok: false, error: err.message });
  }
}

async function executeAction(command, params, tabId) {
  switch (command) {
    case "attach":
      return await attachToTab(tabId);

    case "set_profile":
      setProfile(params.profile);
      return { profile: params.profile };

    case "click": {
      let x = params.x;
      let y = params.y;
      if (x === undefined || y === undefined) {
        const res = await chrome.tabs.sendMessage(tabId, {
          type: "GET_ELEMENT_COORDINATES",
          id: params.elementId,
          selector: params.selector
        });
        if (!res || !res.ok) throw new Error(`Element not found: ${params.selector || params.elementId}`);
        x = res.x;
        y = res.y;
      }
      await humanClick(tabId, x, y);
      return { clicked: true, x, y };
    }

    case "type": {
      if (params.selector || params.elementId) {
        const res = await chrome.tabs.sendMessage(tabId, {
          type: "GET_ELEMENT_COORDINATES",
          id: params.elementId,
          selector: params.selector
        });
        if (res && res.ok) {
          await humanClick(tabId, res.x, res.y);
        }
      }
      await humanType(tabId, params.text);
      return { typed: true, length: params.text.length };
    }

    case "scroll": {
      const distance = params.distanceY !== undefined ? params.distanceY : 400;
      await humanScroll(tabId, distance);
      return { scrolled: true, distanceY: distance };
    }

    case "inspect_dom": {
      const res = await chrome.tabs.sendMessage(tabId, {
        type: "HIGHLIGHT_ELEMENTS",
        limit: params.limit || 80
      });
      return res || { elements: [] };
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

connectToNativeHost();