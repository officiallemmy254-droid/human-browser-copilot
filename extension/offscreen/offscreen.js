// Human Browser Copilot - Offscreen Keepalive Worker
(function () {
  let port = null;
  let heartbeatTimer = null;

  function connectPort() {
    try {
      port = chrome.runtime.connect({ name: "offscreen-keepalive" });
      port.onDisconnect.addListener(() => {
        port = null;
        setTimeout(connectPort, 1000);
      });
      port.onMessage.addListener((msg) => {
        if (msg.type === "PING") {
          port.postMessage({ type: "PONG", timestamp: Date.now() });
        }
      });
    } catch (e) {
      setTimeout(connectPort, 2000);
    }
  }

  function startHeartbeat() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      try {
        chrome.runtime.sendMessage({
          type: "OFFSCREEN_HEARTBEAT",
          timestamp: Date.now()
        }).catch(() => {});
      } catch (e) {}
    }, 15000);
  }

  // Audio Context trick to prevent Chromium throttling when in background
  function initAudioKeepalive() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0.00001; // Silent
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
      }
    } catch (e) {}
  }

  connectPort();
  startHeartbeat();
  initAudioKeepalive();
})();
