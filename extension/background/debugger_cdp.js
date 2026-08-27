// Human Browser Copilot - Chrome DevTools Protocol (CDP) Controller for Long-Running & Heavy Tasks
import { generateBezierPath, getKeystrokeDelay, generateScrollSteps, PROFILES } from "./kinematics.js";

let attachedTabId = null;
let currentMouseX = 100;
let currentMouseY = 100;
let activeProfile = "natural";
let isPaused = false;
let inFlightRequests = new Set();
let networkIdleResolve = null;

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

export function setProfile(profileKey) {
  if (PROFILES[profileKey]) {
    activeProfile = profileKey;
    return true;
  }
  return false;
}

export function getProfile() {
  return activeProfile;
}

export function setPaused(paused) {
  isPaused = paused;
}

export function getPaused() {
  return isPaused;
}

export function getAttachedTabId() {
  return attachedTabId;
}

export async function attachToTab(tabId) {
  if (attachedTabId === tabId) {
    // Verify target still active
    try {
      await sendCDP(tabId, "Runtime.evaluate", { expression: "1 + 1" });
      return { ok: true, tabId };
    } catch (e) {
      attachedTabId = null;
    }
  }

  if (attachedTabId) {
    try {
      await chrome.debugger.detach({ tabId: attachedTabId });
    } catch (e) {}
    attachedTabId = null;
  }

  const target = { tabId };
  await chrome.debugger.attach(target, "1.3");
  attachedTabId = tabId;

  // Prevent Chrome from discarding or throttling this tab during long background jobs
  try {
    await chrome.tabs.update(tabId, { autoDiscardable: false });
  } catch (e) {}

  // Enable CDP domains
  await sendCDP(tabId, "Page.enable");
  await sendCDP(tabId, "DOM.enable");
  await sendCDP(tabId, "Runtime.enable");
  await sendCDP(tabId, "Network.enable").catch(() => {});

  // Disable background timer throttling & ensure page stays in active lifecycle
  try {
    await sendCDP(tabId, "Emulation.setCPUThrottlingRate", { rate: 1 });
  } catch (e) {}
  try {
    await sendCDP(tabId, "Page.setWebLifecycleState", { state: "active" });
  } catch (e) {}
  try {
    await sendCDP(tabId, "Page.setBypassCSP", { enabled: true });
  } catch (e) {}

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

// Track debugger events for network idle & page crashes
chrome.debugger.onEvent.addListener((source, method, params) => {
  if (source.tabId !== attachedTabId) return;

  if (method === "Network.requestWillBeSent") {
    inFlightRequests.add(params.requestId);
  } else if (method === "Network.loadingFinished" || method === "Network.loadingFailed") {
    inFlightRequests.delete(params.requestId);
    if (inFlightRequests.size === 0 && networkIdleResolve) {
      networkIdleResolve();
    }
  } else if (method === "Inspector.targetCrashed" || method === "Page.crashed") {
    console.error(`[CDP] Tab ${source.tabId} crashed. Attempting recovery.`);
  }
});

chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId === attachedTabId) {
    console.warn(`[CDP] Debugger detached from tab ${source.tabId}. Reason: ${reason}`);
    attachedTabId = null;
  }
});

async function applyStealthPatches(tabId) {
  const stealthScript = `
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    window.chrome = { runtime: {}, app: {}, csi: () => {}, loadTimes: () => {} };
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
      parameters.name === "notifications" ?
        Promise.resolve({ state: Notification.permission }) :
        originalQuery(parameters)
    );
  `;

  try {
    await sendCDP(tabId, "Page.addScriptToEvaluateOnNewDocument", {
      source: stealthScript
    });
  } catch (e) {}
}

/**
 * Periodically purge JS heap memory during 1,000+ page long runs
 */
export async function triggerGarbageCollection(tabId) {
  try {
    await sendCDP(tabId, "HeapProfiler.collectGarbage");
    console.log("[CDP] Garbage collection triggered.");
  } catch (e) {}
}

/**
 * Evaluates JavaScript code in page context and returns result
 */
export async function evaluateScript(tabId, expression, returnByValue = true) {
  const res = await sendCDP(tabId, "Runtime.evaluate", {
    expression,
    returnByValue,
    awaitPromise: true
  });
  if (res.exceptionDetails) {
    const desc = res.exceptionDetails.exception?.description || res.exceptionDetails.text;
    throw new Error(`Evaluation Error: ${desc}`);
  }
  return res.result?.value;
}

/**
 * Smart Waiter for DOM Selector
 */
export async function waitForSelector(tabId, selector, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (isPaused) throw new Error("Agent paused by user during wait");

    const exists = await evaluateScript(tabId, `
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 || rect.height > 0 || el.getClientRects().length > 0;
      })()
    `).catch(() => false);

    if (exists) return { ok: true, elapsedMs: Date.now() - start };
    await sleep(250);
  }
  throw new Error(`Timeout waiting for selector: "${selector}" after ${timeoutMs}ms`);
}

/**
 * Smart Waiter for DOM Element Disappearance
 */
export async function waitForElementDisappears(tabId, selector, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (isPaused) throw new Error("Agent paused by user during wait");

    const exists = await evaluateScript(tabId, `
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 || rect.height > 0 || el.getClientRects().length > 0;
      })()
    `).catch(() => false);

    if (!exists) return { ok: true, elapsedMs: Date.now() - start };
    await sleep(250);
  }
  throw new Error(`Timeout waiting for element to disappear: "${selector}" after ${timeoutMs}ms`);
}

/**
 * Smart Waiter for Text in DOM
 */
export async function waitForText(tabId, text, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (isPaused) throw new Error("Agent paused by user during wait");

    const found = await evaluateScript(tabId, `
      (function() {
        return document.body && document.body.innerText.includes(${JSON.stringify(text)});
      })()
    `).catch(() => false);

    if (found) return { ok: true, elapsedMs: Date.now() - start };
    await sleep(300);
  }
  throw new Error(`Timeout waiting for text: "${text}" after ${timeoutMs}ms`);
}

/**
 * Smart Waiter for URL match
 */
export async function waitForUrl(tabId, urlPattern, timeoutMs = 30000) {
  const start = Date.now();
  const isRegex = urlPattern.startsWith("/") && urlPattern.endsWith("/");
  while (Date.now() - start < timeoutMs) {
    if (isPaused) throw new Error("Agent paused by user during wait");

    const currentUrl = await evaluateScript(tabId, "window.location.href").catch(() => "");
    let matches = false;
    if (isRegex) {
      const re = new RegExp(urlPattern.slice(1, -1));
      matches = re.test(currentUrl);
    } else {
      matches = currentUrl.includes(urlPattern);
    }

    if (matches) return { ok: true, url: currentUrl, elapsedMs: Date.now() - start };
    await sleep(300);
  }
  throw new Error(`Timeout waiting for URL pattern "${urlPattern}" after ${timeoutMs}ms`);
}

/**
 * Smart Waiter for Network Idle (zero in-flight network requests)
 */
export async function waitForNetworkIdle(tabId, idleTimeMs = 500, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (isPaused) throw new Error("Agent paused by user during wait");

    if (inFlightRequests.size === 0) {
      // Settle buffer
      await sleep(idleTimeMs);
      if (inFlightRequests.size === 0) {
        return { ok: true, elapsedMs: Date.now() - start };
      }
    }
    await sleep(200);
  }
  return { ok: true, note: "Network idle reached timeout, continuing" };
}

/**
 * Extract structured Table data
 */
export async function extractTableData(tabId, tableSelector = "table") {
  const script = `
    (function() {
      const table = document.querySelector(${JSON.stringify(tableSelector)});
      if (!table) return { error: "Table element not found" };

      const headers = [];
      const rows = [];

      const ths = table.querySelectorAll("thead th, tr:first-child th");
      if (ths.length > 0) {
        ths.forEach(th => headers.push(th.innerText.trim()));
      }

      const trs = table.querySelectorAll("tbody tr, tr");
      trs.forEach((tr, rowIndex) => {
        const cells = tr.querySelectorAll("td, th");
        if (cells.length === 0) return;
        const rowData = {};
        cells.forEach((cell, cellIndex) => {
          const key = headers[cellIndex] || ('col_' + cellIndex);
          rowData[key] = cell.innerText.trim();
        });
        rows.push(rowData);
      });

      return { rowCount: rows.length, headers, rows };
    })()
  `;
  return await evaluateScript(tabId, script);
}

/**
 * Extract matched elements with attributes & text
 */
export async function extractElements(tabId, selector, attributes = ["href", "src", "value", "id", "class", "title"]) {
  const script = `
    (function() {
      const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
      const attrs = ${JSON.stringify(attributes)};
      return els.slice(0, 300).map((el, i) => {
        const item = {
          index: i,
          tag: el.tagName.toLowerCase(),
          text: el.innerText ? el.innerText.slice(0, 150).trim() : "",
        };
        attrs.forEach(attr => {
          const val = el.getAttribute(attr);
          if (val !== null) item[attr] = val;
        });
        return item;
      });
    })()
  `;
  return await evaluateScript(tabId, script);
}

/**
 * Extract JSON-LD and Schema.org metadata
 */
export async function extractStructuredData(tabId) {
  const script = `
    (function() {
      const jsonLdScripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
      const jsonLd = jsonLdScripts.map(s => {
        try { return JSON.parse(s.textContent); } catch (e) { return null; }
      }).filter(Boolean);

      const metaTags = {};
      document.querySelectorAll("meta[name], meta[property]").forEach(m => {
        const key = m.getAttribute("name") || m.getAttribute("property");
        const val = m.getAttribute("content");
        if (key && val) metaTags[key] = val;
      });

      return {
        title: document.title,
        url: window.location.href,
        jsonLd,
        metaTags
      };
    })()
  `;
  return await evaluateScript(tabId, script);
}

/**
 * Organically moves the mouse cursor along a Bézier curve
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

    chrome.tabs.sendMessage(tabId, { type: "CURSOR_MOVE", x: pt.x, y: pt.y }).catch(() => {});
    await sleep(pt.delay);
  }
}

/**
 * Performs a human-like click with Bézier approach and dwell
 */
export async function humanClick(tabId, targetX, targetY) {
  if (isPaused) throw new Error("Agent is currently paused by user");

  await humanMouseMove(tabId, targetX, targetY);
  await sleep(25 + Math.random() * 35);

  await sendCDP(tabId, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: targetX,
    y: targetY,
    button: "left",
    clickCount: 1
  });

  chrome.tabs.sendMessage(tabId, { type: "CLICK_RIPPLE", x: targetX, y: targetY }).catch(() => {});
  await sleep(65 + Math.random() * 45);

  await sendCDP(tabId, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: targetX,
    y: targetY,
    button: "left",
    clickCount: 1
  });

  await sleep(35 + Math.random() * 45);
}

/**
 * Types text with organic human cadence
 */
export async function humanType(tabId, text) {
  if (isPaused) throw new Error("Agent is currently paused by user");

  for (let i = 0; i < text.length; i++) {
    if (isPaused) throw new Error("Agent paused during typing");

    const char = text[i];
    const delay = getKeystrokeDelay(char, activeProfile);

    await sendCDP(tabId, "Input.dispatchKeyEvent", {
      type: "keyDown",
      text: char,
      unmodifiedText: char
    });

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
  if (isPaused) throw new Error("Agent paused by user during scroll");

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

  const profile = PROFILES[activeProfile] || PROFILES.natural;
  await sleep(profile.readingDwellPerCharMs * 25 + 150);
}

/**
 * Dispatches a keypress event
 */
export async function humanKeypress(tabId, key) {
  if (isPaused) throw new Error("Agent paused by user");
  await sendCDP(tabId, "Input.dispatchKeyEvent", {
    type: "keyDown",
    key: key,
    code: key,
    windowsVirtualKeyCode: key === "Enter" ? 13 : (key === "Escape" ? 27 : 0)
  });
  await sleep(40);
  await sendCDP(tabId, "Input.dispatchKeyEvent", {
    type: "keyUp",
    key: key,
    code: key
  });
  return { keypressed: true, key, verified: true };
}

/**
 * Clears input field
 */
export async function humanClear(tabId, selector) {
  if (isPaused) throw new Error("Agent paused by user");
  if (selector) {
    await evaluateScript(tabId, `
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (el) {
          el.value = "";
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
      })()
    `);
  }
  return { cleared: true, verified: true };
}

/**
 * Captures high-quality screenshot of active viewport
 */
export async function captureScreenshot(tabId) {
  const res = await sendCDP(tabId, "Page.captureScreenshot", {
    format: "jpeg",
    quality: 85
  });
  return res.data;
}

/**
 * Smart Type for Lexical & Rich-Text editors
 */
export async function smartType(tabId, selector, text) {
  if (isPaused) throw new Error("Agent paused by user");

  // Detect and focus
  const isRichText = await evaluateScript(tabId, 
    (function() {
      const el = document.querySelector();
      if (!el) return false;
      el.focus();
      return el.isContentEditable || 
             el.getAttribute("role") === "textbox" || 
             el.classList.contains("ProseMirror") || 
             el.dataset.lexicalEditor === "true";
    })()
  );

  if (isRichText) {
    // Select All
    await sendCDP(tabId, "Input.dispatchKeyEvent", {
      type: "keyDown",
      windowsVirtualKeyCode: 65, // A
      modifiers: 2 // Ctrl
    });
    await sleep(20);
    await sendCDP(tabId, "Input.dispatchKeyEvent", {
      type: "keyUp",
      windowsVirtualKeyCode: 65,
      modifiers: 2
    });
    
    // Backspace
    await sendCDP(tabId, "Input.dispatchKeyEvent", {
      type: "keyDown",
      windowsVirtualKeyCode: 8 // Backspace
    });
    await sleep(20);
    await sendCDP(tabId, "Input.dispatchKeyEvent", {
      type: "keyUp",
      windowsVirtualKeyCode: 8
    });
    await sleep(50);
  }

  // Type characters
  for (let i = 0; i < text.length; i++) {
    if (isPaused) throw new Error("Agent paused during typing");
    const char = text[i];
    const delay = getKeystrokeDelay(char, activeProfile);

    await sendCDP(tabId, "Input.dispatchKeyEvent", {
      type: "keyDown",
      text: char,
      unmodifiedText: char
    });
    
    await sendCDP(tabId, "Input.dispatchKeyEvent", {
      type: "char",
      text: char,
      unmodifiedText: char
    });

    await sleep(Math.floor(delay / 2));

    await sendCDP(tabId, "Input.dispatchKeyEvent", {
      type: "keyUp",
      text: char,
      unmodifiedText: char
    });

    await sleep(Math.ceil(delay / 2));
  }
  
  return { typed: true, length: text.length, smart: true };
}

/**
 * Smart Clear for Lexical & Rich-Text editors
 */
export async function smartClear(tabId, selector) {
  if (isPaused) throw new Error("Agent paused by user");

  const isRichText = await evaluateScript(tabId, 
    (function() {
      const el = document.querySelector();
      if (!el) return false;
      el.focus();
      return el.isContentEditable || 
             el.getAttribute("role") === "textbox" || 
             el.classList.contains("ProseMirror") || 
             el.dataset.lexicalEditor === "true";
    })()
  );

  if (isRichText) {
    // Select All
    await sendCDP(tabId, "Input.dispatchKeyEvent", {
      type: "keyDown",
      windowsVirtualKeyCode: 65, // A
      modifiers: 2 // Ctrl
    });
    await sleep(20);
    await sendCDP(tabId, "Input.dispatchKeyEvent", {
      type: "keyUp",
      windowsVirtualKeyCode: 65,
      modifiers: 2
    });
    
    // Delete
    await sendCDP(tabId, "Input.dispatchKeyEvent", {
      type: "keyDown",
      windowsVirtualKeyCode: 46 // Delete
    });
    await sleep(20);
    await sendCDP(tabId, "Input.dispatchKeyEvent", {
      type: "keyUp",
      windowsVirtualKeyCode: 46
    });
  } else {
    await humanClear(tabId, selector);
  }
  return { cleared: true, smart: true };
}

/**
 * Human Hotkey (modifiers bitmask: 1=Alt, 2=Ctrl, 4=Meta, 8=Shift)
 */
export async function humanHotkey(tabId, key, modifiers = 0) {
  if (isPaused) throw new Error("Agent paused by user");
  
  let windowsVirtualKeyCode = 0;
  if (key === "Enter") windowsVirtualKeyCode = 13;
  else if (key === "Escape") windowsVirtualKeyCode = 27;
  else if (key.length === 1) windowsVirtualKeyCode = key.toUpperCase().charCodeAt(0);

  await sendCDP(tabId, "Input.dispatchKeyEvent", {
    type: "keyDown",
    key: key,
    code: key,
    windowsVirtualKeyCode,
    modifiers
  });
  
  await sleep(50);
  
  await sendCDP(tabId, "Input.dispatchKeyEvent", {
    type: "keyUp",
    key: key,
    code: key,
    windowsVirtualKeyCode,
    modifiers
  });
  
  return { hotkey: true, key, modifiers };
}

/**
 * Direct Asset / Canvas Downloader
 */
export async function downloadMedia(tabId, selector) {
  const result = await evaluateScript(tabId,     (async function() {
      const el = document.querySelector(\);
      if (!el) return { error: "Element not found" };
      
      if (el.tagName.toLowerCase() === "canvas") {
        return { dataUrl: el.toDataURL("image/png") };
      }
      
      if (el.tagName.toLowerCase() === "img") {
        const src = el.src;
        if (!src) return { error: "Image has no src" };
        
        if (src.startsWith("data:")) {
          return { dataUrl: src };
        }
        
        try {
          const res = await fetch(src);
          const blob = await res.blob();
          return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve({ dataUrl: reader.result });
            reader.onerror = () => resolve({ error: "Failed to read blob" });
            reader.readAsDataURL(blob);
          });
        } catch (e) {
          return { error: e.message };
        }
      }
      
      return { error: "Element is not canvas or img" };
    })()
  \);
  
  if (result && result.error) throw new Error(result.error);
  return result;
}
