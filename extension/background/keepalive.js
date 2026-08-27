// Human Browser Copilot - Service Worker Keepalive & Long-Task Manager

let keepaliveTimer = null;
let isTaskRunning = false;
let activeTaskInfo = null;
let offscreenPort = null;

const OFFSCREEN_DOCUMENT_PATH = "offscreen/offscreen.html";

async function hasOffscreenDocument() {
  if ("getContexts" in chrome.runtime) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
    });
    return contexts.length > 0;
  }
  return false;
}

export async function ensureOffscreenKeepalive() {
  try {
    if (await hasOffscreenDocument()) return;
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ["BLOBS", "MATCH_MEDIA", "AUDIO_PLAYBACK"],
      justification: "Maintain service worker execution during heavy and long-running automation tasks"
    });
    console.log("[Keepalive] Offscreen keepalive document created successfully.");
  } catch (err) {
    // If already exists or unsupported, log gracefully
    if (!err.message?.includes("Only a single offscreen document may be created")) {
      console.warn("[Keepalive] Offscreen document error:", err);
    }
  }
}

export function startKeepalive() {
  ensureOffscreenKeepalive().catch(() => {});

  // Setup chrome.alarms as a secondary fallback
  try {
    chrome.alarms.create("human_browser_keepalive_alarm", { periodInMinutes: 1 });
  } catch (e) {}

  if (keepaliveTimer) clearInterval(keepaliveTimer);
  keepaliveTimer = setInterval(async () => {
    try {
      await chrome.storage.local.set({ lastPing: Date.now() });
      if (offscreenPort) {
        offscreenPort.postMessage({ type: "PING" });
      }
    } catch (e) {}
  }, 10000);
}

export function stopKeepalive() {
  if (keepaliveTimer) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  }
  try {
    chrome.alarms.clear("human_browser_keepalive_alarm");
  } catch (e) {}
}

export function registerOffscreenPort(port) {
  if (port.name === "offscreen-keepalive") {
    offscreenPort = port;
    offscreenPort.onDisconnect.addListener(() => {
      offscreenPort = null;
      ensureOffscreenKeepalive().catch(() => {});
    });
  }
}

export function setTaskActive(active, taskInfo = null) {
  isTaskRunning = active;
  activeTaskInfo = taskInfo;
  startKeepalive();
}

export function isTaskActive() {
  return isTaskRunning;
}

export function getActiveTaskInfo() {
  return activeTaskInfo;
}
