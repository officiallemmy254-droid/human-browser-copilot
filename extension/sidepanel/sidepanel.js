// Human Browser Copilot - Side Panel Controller
(function() {
  const logContainer = document.getElementById("log-container");
  const connectionOrb = document.getElementById("connection-orb");
  const captchaAlert = document.getElementById("captcha-alert");
  const btnCaptchaResolved = document.getElementById("btn-captcha-resolved");
  const approvalBox = document.getElementById("approval-box");
  const approvalReasonText = document.getElementById("approval-reason-text");
  const approvalParamsText = document.getElementById("approval-params-text");
  const btnApprove = document.getElementById("btn-approve");
  const btnReject = document.getElementById("btn-reject");
  const btnTakeover = document.getElementById("btn-takeover");
  const takeoverIcon = document.getElementById("takeover-icon");
  const takeoverText = document.getElementById("takeover-text");
  const toggleTracer = document.getElementById("toggle-tracer");
  const toggleHighlighter = document.getElementById("toggle-highlighter");
  const btnClearLog = document.getElementById("btn-clear-log");
  const profileBtns = document.querySelectorAll(".profile-btn");

  let currentApprovalId = null;
  let isPaused = false;

  // Web Audio Synthesizer for alerts (Zero external audio files needed)
  function playAlertChime(type = "alert") {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);

      if (type === "captcha") {
        osc.type = "sine";
        osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
        osc.frequency.setValueAtTime(880.00, audioCtx.currentTime + 0.15); // A5
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.5);
      } else {
        osc.type = "triangle";
        osc.frequency.setValueAtTime(440, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.3);
      }
    } catch (e) {}
  }

  function addLog(text, type = "system") {
    const time = new Date().toTimeString().split(" ")[0].slice(0, 5);
    const entry = document.createElement("div");
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `<span class="time">${time}</span> <span class="text">${text}</span>`;
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
  }

  // Profile Switching
  profileBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      profileBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const profile = btn.getAttribute("data-profile");
      chrome.runtime.sendMessage({ type: "SET_PROFILE", profile });
      addLog(`Behavior profile changed to "${profile}"`, "system");
    });
  });

  // HUD Toggles
  toggleTracer.addEventListener("change", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_OVERLAY", enabled: toggleTracer.checked });
    }
  });

  toggleHighlighter.addEventListener("change", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      if (toggleHighlighter.checked) {
        chrome.tabs.sendMessage(tab.id, { type: "HIGHLIGHT_ELEMENTS" });
      } else {
        chrome.tabs.sendMessage(tab.id, { type: "CLEAR_HIGHLIGHTS" });
      }
    }
  });

  // Emergency Takeover
  btnTakeover.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "TOGGLE_AGENT_PAUSE" });
  });

  // CAPTCHA Resume Button
  btnCaptchaResolved.addEventListener("click", () => {
    captchaAlert.classList.add("hidden");
    chrome.runtime.sendMessage({ type: "CAPTCHA_RESOLVED", reason: "manual_click" });
    addLog("CAPTCHA marked as resolved by user", "success");
  });

  // Approval Handlers
  btnApprove.addEventListener("click", () => {
    if (currentApprovalId) {
      chrome.runtime.sendMessage({ type: "RESOLVE_APPROVAL", approvalId: currentApprovalId, approved: true });
      approvalBox.classList.add("hidden");
      addLog(`Action approved by user`, "success");
      currentApprovalId = null;
    }
  });

  btnReject.addEventListener("click", () => {
    if (currentApprovalId) {
      chrome.runtime.sendMessage({ type: "RESOLVE_APPROVAL", approvalId: currentApprovalId, approved: false });
      approvalBox.classList.add("hidden");
      addLog(`Action rejected by user`, "system");
      currentApprovalId = null;
    }
  });

  btnClearLog.addEventListener("click", () => {
    logContainer.innerHTML = "";
  });

  // Listen for Extension Events
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "CAPTCHA_DETECTED") {
      captchaAlert.classList.remove("hidden");
      playAlertChime("captcha");
      addLog(`🚨 CAPTCHA detected: ${msg.name || "Challenge"}`, "captcha");
    } else if (msg.type === "CAPTCHA_RESOLVED") {
      captchaAlert.classList.add("hidden");
      addLog(`✅ CAPTCHA resolved. Resuming task...`, "success");
    } else if (msg.type === "APPROVAL_REQUESTED") {
      currentApprovalId = msg.request.id;
      approvalReasonText.textContent = msg.request.reason;
      approvalParamsText.textContent = JSON.stringify(msg.request.params, null, 2);
      approvalBox.classList.remove("hidden");
      playAlertChime("alert");
      addLog(`🛡️ Approval required: ${msg.request.reason}`, "system");
    } else if (msg.type === "APPROVAL_RESOLVED") {
      if (msg.approvalId === currentApprovalId) {
        approvalBox.classList.add("hidden");
        currentApprovalId = null;
      }
    } else if (msg.type === "AGENT_PAUSED") {
      isPaused = msg.isPaused;
      takeoverIcon.textContent = isPaused ? "▶️" : "⏸️";
      takeoverText.textContent = isPaused ? "Resume Agent (Esc)" : "Emergency Pause (Esc)";
      btnTakeover.className = isPaused ? "btn btn-success full-width" : "btn btn-warning full-width";
      addLog(isPaused ? "⏸️ Agent execution paused by user" : "▶️ Agent execution resumed", "system");
    }
  });

  // Initial Check for pending approvals
  chrome.runtime.sendMessage({ type: "GET_PENDING_APPROVALS" }, (res) => {
    if (res && res.approvals && res.approvals.length > 0) {
      const req = res.approvals[0];
      currentApprovalId = req.id;
      approvalReasonText.textContent = req.reason;
      approvalParamsText.textContent = JSON.stringify(req.params, null, 2);
      approvalBox.classList.remove("hidden");
    }
  });
})();
