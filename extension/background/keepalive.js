// Human Browser Copilot - Service Worker Keepalive Manager

let keepaliveTimer = null;

export function startKeepalive() {
  if (keepaliveTimer) clearInterval(keepaliveTimer);
  // Recurring ping to prevent service worker idling during long tasks
  keepaliveTimer = setInterval(async () => {
    try {
      await chrome.storage.local.get(["lastPing"]);
      await chrome.storage.local.set({ lastPing: Date.now() });
    } catch (e) {}
  }, 20000);
}

export function stopKeepalive() {
  if (keepaliveTimer) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  }
}
