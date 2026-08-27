// Human Browser Copilot - Cursor Tracer & Visual HUD
(function() {
  if (window.__humanBrowserTracerInjected) return;
  window.__humanBrowserTracerInjected = true;

  let tracerEl = null;
  let canvasEl = null;
  let ctx = null;
  let statusPill = null;
  let statusDot = null;
  let statusText = null;
  let trailPoints = [];
  let isEnabled = true;

  function initHUD() {
    if (document.getElementById("human-browser-cursor-tracer")) return;

    // Create Tracer Element
    tracerEl = document.createElement("div");
    tracerEl.id = "human-browser-cursor-tracer";
    document.documentElement.appendChild(tracerEl);

    // Create Canvas for motion trails
    canvasEl = document.createElement("canvas");
    canvasEl.id = "human-browser-cursor-trail";
    canvasEl.width = window.innerWidth;
    canvasEl.height = window.innerHeight;
    ctx = canvasEl.getContext("2d");
    document.documentElement.appendChild(canvasEl);

    // Create Floating Status Pill
    statusPill = document.createElement("div");
    statusPill.id = "human-browser-status-pill";
    statusPill.innerHTML = `
      <div id="human-browser-status-dot"></div>
      <span id="human-browser-status-text">Copilot Ready</span>
      <button class="human-browser-btn" style="padding: 2px 8px; font-size: 11px; background: rgba(255,255,255,0.15);" id="human-browser-pause-btn">Pause (Esc)</button>
    `;
    document.documentElement.appendChild(statusPill);

    statusDot = statusPill.querySelector("#human-browser-status-dot");
    statusText = statusPill.querySelector("#human-browser-status-text");

    const pauseBtn = statusPill.querySelector("#human-browser-pause-btn");
    pauseBtn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "TOGGLE_AGENT_PAUSE" });
    });

    // Draggable & Persistence
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;

    statusPill.addEventListener("mousedown", (e) => {
      if (e.target.tagName === "BUTTON") return;
      isDragging = true;
      dragStartX = e.clientX - statusPill.getBoundingClientRect().left;
      dragStartY = e.clientY - statusPill.getBoundingClientRect().top;
      statusPill.style.cursor = "grabbing";
    });

    window.addEventListener("mousemove", (e) => {
      if (isDragging) {
        let x = e.clientX - dragStartX;
        let y = e.clientY - dragStartY;
        statusPill.style.left = x + "px";
        statusPill.style.top = y + "px";
        statusPill.style.right = "auto";
        statusPill.style.bottom = "auto";
      }

      // Auto-dim / collapse when cursor is within 90px
      if (statusPill && !isDragging) {
        const rect = statusPill.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const dist = Math.sqrt(Math.pow(e.clientX - centerX, 2) + Math.pow(e.clientY - centerY, 2));
        if (dist < 90) {
          statusPill.classList.add("collapsed");
        } else {
          statusPill.classList.remove("collapsed");
        }
      }
    });

    window.addEventListener("mouseup", () => {
      if (isDragging) {
        isDragging = false;
        statusPill.style.cursor = "grab";
        chrome.storage.local.set({
          humanBrowserPillPos: { left: statusPill.style.left, top: statusPill.style.top }
        });
      }
    });

    try {
      chrome.storage.local.get("humanBrowserPillPos", (res) => {
        if (res.humanBrowserPillPos && res.humanBrowserPillPos.left) {
          statusPill.style.left = res.humanBrowserPillPos.left;
          statusPill.style.top = res.humanBrowserPillPos.top;
          statusPill.style.right = "auto";
          statusPill.style.bottom = "auto";
        }
      });
    } catch (e) {}

    window.addEventListener("resize", () => {
      if (canvasEl) {
        canvasEl.width = window.innerWidth;
        canvasEl.height = window.innerHeight;
      }
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        chrome.runtime.sendMessage({ type: "EMERGENCY_TAKEOVER" });
      }
    });

    startTrailLoop();
  }

  function startTrailLoop() {
    function render() {
      if (ctx && canvasEl) {
        ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
        const now = Date.now();
        trailPoints = trailPoints.filter(p => now - p.time < 350);

        if (trailPoints.length > 1) {
          ctx.beginPath();
          ctx.moveTo(trailPoints[0].x, trailPoints[0].y);
          for (let i = 1; i < trailPoints.length; i++) {
            const p = trailPoints[i];
            ctx.lineTo(p.x, p.y);
          }
          const grad = ctx.createLinearGradient(trailPoints[0].x, trailPoints[0].y, trailPoints[trailPoints.length - 1].x, trailPoints[trailPoints.length - 1].y);
          grad.addColorStop(0, "rgba(138, 43, 226, 0.4)");
          grad.addColorStop(1, "rgba(0, 242, 254, 0.8)");
          ctx.strokeStyle = grad;
          ctx.lineWidth = 3;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.stroke();
        }
      }
      requestAnimationFrame(render);
    }
    requestAnimationFrame(render);
  }

  function moveCursor(x, y) {
    if (!tracerEl) initHUD();
    if (!isEnabled) return;

    tracerEl.style.display = "block";
    tracerEl.style.left = x + "px";
    tracerEl.style.top = y + "px";

    trailPoints.push({ x, y, time: Date.now() });
    if (trailPoints.length > 25) trailPoints.shift();
  }

  function spawnRipple(x, y) {
    if (!isEnabled) return;
    const ripple = document.createElement("div");
    ripple.className = "human-browser-click-ripple";
    ripple.style.left = x + "px";
    ripple.style.top = y + "px";
    document.documentElement.appendChild(ripple);
    setTimeout(() => ripple.remove(), 700);
  }

  function updateStatus(state, message) {
    if (!statusPill) initHUD();
    if (statusDot) {
      statusDot.className = "";
      if (state === "busy") statusDot.classList.add("busy");
      else if (state === "paused") statusDot.classList.add("paused");
      else if (state === "captcha") statusDot.classList.add("captcha");
    }
    if (statusText) {
      statusText.textContent = message || "Copilot Active";
    }
  }

  // Listen for messages from background / extension
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "CURSOR_MOVE") {
      moveCursor(msg.x, msg.y);
      sendResponse({ ok: true });
    } else if (msg.type === "CLICK_RIPPLE") {
      spawnRipple(msg.x, msg.y);
      sendResponse({ ok: true });
    } else if (msg.type === "STATUS_UPDATE") {
      updateStatus(msg.state, msg.message);
      sendResponse({ ok: true });
    } else if (msg.type === "TOGGLE_OVERLAY") {
      isEnabled = msg.enabled !== undefined ? msg.enabled : !isEnabled;
      if (tracerEl) tracerEl.style.display = isEnabled ? "block" : "none";
      if (canvasEl) canvasEl.style.display = isEnabled ? "block" : "none";
      sendResponse({ ok: true, isEnabled });
    }
    return true;
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initHUD);
  } else {
    initHUD();
  }
})();
