// Human Browser Copilot - Chrome DevTools Protocol (CDP) Controller with Kinematics
import { generateBezierPath, getKeystrokeDelay, generateScrollSteps, PROFILES } from "./kinematics.js";

let attachedTabId = null;
let currentMouseX = 100;
let currentMouseY = 100;
let activeProfile = "natural";
let isPaused = false;

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

export function setProfile(profileKey) {
  if (PROFILES[profileKey]) {
    activeProfile = profileKey;
    return true;
  }
  return false;
}

export function setPaused(paused) {
  isPaused = paused;
}

export async function attachToTab(tabId) {
  if (attachedTabId === tabId) return { ok: true, tabId };

  if (attachedTabId) {
    try {
      await chrome.debugger.detach({ tabId: attachedTabId });
    } catch (e) {}
    attachedTabId = null;
  }

  const target = { tabId };
  await chrome.debugger.attach(target, "1.3");
  attachedTabId = tabId;

  // Enable necessary CDP domains
  await sendCDP(tabId, "Page.enable");
  await sendCDP(tabId, "DOM.enable");
  await sendCDP(tabId, "Runtime.enable");

  // Apply stealth evasion patches
  await applyStealthPatches(tabId);

  return { ok: true, tabId };
}

export async function detachDebugger() {
  if (attachedTabId) {
    try {
      await chrome.debugger.detach({ tabId: attachedTabId });
    } catch (e) {}
    attachedTabId = null;
  }
}

export function sendCDP(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message));
      }
      resolve(result);
    });
  });
}

async function applyStealthPatches(tabId) {
  const stealthScript = `
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    window.chrome = { runtime: {} };
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
      parameters.name === "notifications" ?
        Promise.resolve({ state: Notification.permission }) :
        originalQuery(parameters)
    );
  `;

  await sendCDP(tabId, "Page.addScriptToEvaluateOnNewDocument", {
    source: stealthScript
  });
}

/**
 * Organically moves the mouse cursor along a Bézier curve to target coordinates
 */
export async function humanMouseMove(tabId, targetX, targetY) {
  if (isPaused) throw new Error("Agent is currently paused by user");

  const path = generateBezierPath(currentMouseX, currentMouseY, targetX, targetY, activeProfile);

  for (const pt of path) {
    if (isPaused) throw new Error("Agent paused during mouse movement");

    await sendCDP(tabId, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: pt.x,
      y: pt.y,
      button: "none"
    });

    currentMouseX = pt.x;
    currentMouseY = pt.y;

    // Send visual position to content script HUD
    chrome.tabs.sendMessage(tabId, { type: "CURSOR_MOVE", x: pt.x, y: pt.y }).catch(() => {});

    await sleep(pt.delay);
  }
}

/**
 * Performs a human-like click with Bézier approach and natural click dwell time
 */
export async function humanClick(tabId, targetX, targetY) {
  if (isPaused) throw new Error("Agent is currently paused by user");

  // Move smoothly to target
  await humanMouseMove(tabId, targetX, targetY);

  // Natural pause before pressing mouse button
  await sleep(30 + Math.random() * 40);

  // Mouse Down
  await sendCDP(tabId, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: targetX,
    y: targetY,
    button: "left",
    clickCount: 1
  });

  // Visual click ripple
  chrome.tabs.sendMessage(tabId, { type: "CLICK_RIPPLE", x: targetX, y: targetY }).catch(() => {});

  // Natural human click hold dwell time (60-110ms)
  await sleep(65 + Math.random() * 45);

  // Mouse Up
  await sendCDP(tabId, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: targetX,
    y: targetY,
    button: "left",
    clickCount: 1
  });

  // Short recovery pause
  await sleep(40 + Math.random() * 60);
}

/**
 * Types text with organic human cadence, dynamic WPM delays, and pauses
 */
export async function humanType(tabId, text) {
  if (isPaused) throw new Error("Agent is currently paused by user");

  for (let i = 0; i < text.length; i++) {
    if (isPaused) throw new Error("Agent paused during typing");

    const char = text[i];
    const delay = getKeystrokeDelay(char, activeProfile);

    // Key Down & Char event
    await sendCDP(tabId, "Input.dispatchKeyEvent", {
      type: "keyDown",
      text: char,
      unmodifiedText: char
    });

    // Key Up
    await sendCDP(tabId, "Input.dispatchKeyEvent", {
      type: "keyUp",
      text: char,
      unmodifiedText: char
    });

    await sleep(delay);
  }
}

/**
 * Smoothly scrolls with momentum and human reading dwell time
 */
export async function humanScroll(tabId, distanceY) {
  if (isPaused) throw new Error("Agent is currently paused by user");

  const steps = generateScrollSteps(distanceY, activeProfile);

  for (const step of steps) {
    if (isPaused) throw new Error("Agent paused during scroll");

    await sendCDP(tabId, "Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: currentMouseX,
      y: currentMouseY,
      deltaX: 0,
      deltaY: step.deltaY
    });

    await sleep(step.delay);
  }

  // Reading dwell pause after scroll
  const profile = PROFILES[activeProfile] || PROFILES.natural;
  await sleep(profile.readingDwellPerCharMs * 35 + 200);
}

/**
 * Captures high-quality screenshot of active viewport
 */
export async function captureScreenshot(tabId) {
  const res = await sendCDP(tabId, "Page.captureScreenshot", {
    format: "jpeg",
    quality: 85
  });
  return res.data; // Base64 JPEG
}
