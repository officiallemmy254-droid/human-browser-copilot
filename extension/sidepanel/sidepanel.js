// Human Browser Copilot — Liquid Morphism Side Panel Controller
(function() {
  // DOM Elements
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
  const profilePills = document.querySelectorAll(".profile-pill");
  const tabsListEl = document.getElementById("tabs-list");
  const btnRefreshTabs = document.getElementById("btn-refresh-tabs");
  const logStatus = document.getElementById("log-status");

  // Quick Action Buttons
  const btnQuickSnapshot = document.getElementById("btn-quick-snapshot");
  const btnQuickInspect = document.getElementById("btn-quick-inspect");
  const btnQuickGc = document.getElementById("btn-quick-gc");

  // Task UI Elements
  const taskCard = document.getElementById("task-card");
  const taskNameEl = document.getElementById("task-name");
  const taskStepsBadge = document.getElementById("task-steps-badge");
  const taskProgressFill = document.getElementById("task-progress-fill");
  const taskCurrentAction = document.getElementById("task-current-action");
  const taskTimer = document.getElementById("task-timer");
  const btnTaskPause = document.getElementById("btn-task-pause");
  const btnTaskCancel = document.getElementById("btn-task-cancel");

  let currentApprovalId = null;
  let isPaused = false;
  let taskStartTime = null;
  let timerInterval = null;
  let isTaskPaused = false;

  function updateTimer() {
    if (!taskStartTime) return;
    const elapsedSec = Math.floor((Date.now() - taskStartTime) / 1000);
    const mins = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
    const secs = String(elapsedSec % 60).padStart(2, "0");
    taskTimer.textContent = `${mins}:${secs}`;
  }

  function startTaskTimer() {
    taskStartTime = Date.now();
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(updateTimer, 1000);
    updateTimer();
  }

  function stopTaskTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  // Web Audio Synthesizer for alerts
  function playAlertChime(type = "alert") {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);

      if (type === "captcha") {
        osc.type = "sine";
        osc.frequency.setValueAtTime(587.33, audioCtx.currentTime);
        osc.frequency.setValueAtTime(880.00, audioCtx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.5);
      } else if (type === "success") {
        osc.type = "sine";
        osc.frequency.setValueAtTime(523.25, audioCtx.currentTime);
        osc.frequency.setValueAtTime(659.25, audioCtx.currentTime + 0.1);
        osc.frequency.setValueAtTime(783.99, audioCtx.currentTime + 0.2);
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.4);
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
    entry.innerHTML = `<span class="time">${time}</span><span class="text">${text}</span>`;
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
  }

  // Multi-Tab Concurrency Manager
  async function refreshTabsList() {
    try {
      const tabs = await chrome.tabs.query({});
      tabsListEl.innerHTML = "";
      tabs.slice(0, 8).forEach(t => {
        const chip = document.createElement("div");
        chip.className = `tab-chip ${t.active ? "active" : ""}`;
        chip.title = `${t.title}\n${t.url}`;
        chip.innerHTML = `
          <span class="tab-dot ${t.active ? "active" : ""}"></span>
          <span class="tab-label">${(t.title || "New Tab").slice(0, 14)}...</span>
          ${t.active ? '<span class="tab-tag">ACTIVE</span>' : ''}
        `;
        chip.addEventListener("click", async () => {
          await chrome.tabs.update(t.id, { active: true });
          addLog(`Switched focus to Tab #${t.id} ("${(t.title || "").slice(0, 20)}")`, "action");
          refreshTabsList();
        });
        tabsListEl.appendChild(chip);
      });
    } catch (e) {}
  }

  btnRefreshTabs.addEventListener("click", refreshTabsList);
  refreshTabsList();

  // Quick Action Handlers
  btnQuickSnapshot.addEventListener("click", async () => {
    addLog("📸 Capturing high-resolution viewport snapshot...", "action");
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      chrome.runtime.sendMessage({ id: Date.now(), command: "take_snapshot" }, (res) => {
        if (res && res.ok) {
          playAlertChime("success");
          addLog("✅ Snapshot captured successfully!", "success");
        } else {
          addLog(`Snapshot failed: ${res?.error || "Unknown"}`, "error");
        }
      });
    }
  });

  btnQuickInspect.addEventListener("click", async () => {
    addLog("🔍 Scanning interactive DOM element hierarchy...", "action");
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { type: "HIGHLIGHT_ELEMENTS", limit: 60 }, (res) => {
        if (res && res.elements) {
          addLog(`✨ Discovered ${res.elements.length} interactive elements on active page.`, "success");
        }
      });
    }
  });

  btnQuickGc.addEventListener("click", async () => {
    addLog("🧹 Triggering CDP HeapProfiler memory garbage collection...", "system");
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      chrome.runtime.sendMessage({ id: Date.now(), command: "garbage_collect" }, () => {
        addLog("✅ Tab memory heap purged & optimized.", "success");
      });
    }
  });

  // Profile Switching
  profilePills.forEach(btn => {
    btn.addEventListener("click", () => {
      profilePills.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const profile = btn.getAttribute("data-profile");
      chrome.runtime.sendMessage({ type: "SET_PROFILE", profile });
      addLog(`Kinematic profile set to: "${profile}"`, "system");
    });
  });

  // HUD Toggles
  toggleTracer.addEventListener("change", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_OVERLAY", enabled: toggleTracer.checked });
      addLog(`Laser tracer overlay ${toggleTracer.checked ? "enabled" : "disabled"}.`, "system");
    }
  });

  toggleHighlighter.addEventListener("change", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      if (toggleHighlighter.checked) {
        chrome.tabs.sendMessage(tab.id, { type: "HIGHLIGHT_ELEMENTS" });
        addLog("Element highlighter labels shown.", "system");
      } else {
        chrome.tabs.sendMessage(tab.id, { type: "CLEAR_HIGHLIGHTS" });
        addLog("Element highlighter labels cleared.", "system");
      }
    }
  });

  // Emergency Takeover
  btnTakeover.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "TOGGLE_AGENT_PAUSE" });
  });

  // Task Card Controls
  btnTaskPause.addEventListener("click", () => {
    if (isTaskPaused) {
      chrome.runtime.sendMessage({ type: "RESUME_TASK" });
    } else {
      chrome.runtime.sendMessage({ type: "PAUSE_TASK" });
    }
  });

  btnTaskCancel.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "CANCEL_TASK" });
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
      addLog("Action approved by user", "success");
      currentApprovalId = null;
    }
  });

  btnReject.addEventListener("click", () => {
    if (currentApprovalId) {
      chrome.runtime.sendMessage({ type: "RESOLVE_APPROVAL", approvalId: currentApprovalId, approved: false });
      approvalBox.classList.add("hidden");
      addLog("Action rejected by user", "system");
      currentApprovalId = null;
    }
  });

  btnClearLog.addEventListener("click", () => {
    logContainer.innerHTML = "";
    addLog("Log console cleared.", "system");
  });

  // Extension Message Listener
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "WORKFLOW_STARTED") {
      taskCard.classList.remove("hidden");
      taskNameEl.textContent = msg.taskName || "Batch Workflow";
      taskStepsBadge.textContent = `Step 0 / ${msg.totalSteps}`;
      taskProgressFill.style.width = "0%";
      taskCurrentAction.textContent = "Starting workflow...";
      btnTaskPause.textContent = "Pause Task";
      isTaskPaused = false;
      startTaskTimer();
      addLog(`🚀 Started automated task: "${msg.taskName}" (${msg.totalSteps} steps)`, "action");
      refreshTabsList();
    } else if (msg.type === "WORKFLOW_STEP_START") {
      taskCard.classList.remove("hidden");
      taskStepsBadge.textContent = `Step ${msg.stepIndex} / ${msg.totalSteps}`;
      const pct = Math.round(((msg.stepIndex - 1) / msg.totalSteps) * 100);
      taskProgressFill.style.width = `${pct}%`;
      taskCurrentAction.textContent = msg.description || `Executing ${msg.action}...`;
      addLog(`⚡ [${msg.stepIndex}/${msg.totalSteps}] ${msg.action}: ${msg.description || ""}`, "action");
    } else if (msg.type === "WORKFLOW_STEP_SUCCESS") {
      const pct = Math.round((msg.stepIndex / msg.totalSteps) * 100);
      taskProgressFill.style.width = `${pct}%`;
    } else if (msg.type === "WORKFLOW_PAUSED") {
      isTaskPaused = true;
      btnTaskPause.textContent = "Resume Task";
      taskCurrentAction.textContent = "⏸️ Task paused";
      addLog("⏸️ Batch task paused", "system");
    } else if (msg.type === "WORKFLOW_RESUMED") {
      isTaskPaused = false;
      btnTaskPause.textContent = "Pause Task";
      addLog("▶️ Batch task resumed", "system");
    } else if (msg.type === "WORKFLOW_COMPLETED") {
      stopTaskTimer();
      taskProgressFill.style.width = "100%";
      taskCurrentAction.textContent = `✅ Finished in ${msg.durationSec}s`;
      playAlertChime("success");
      addLog(`✅ Task "${msg.taskName}" completed in ${msg.durationSec}s (${msg.totalSteps} steps executed)`, "success");
      setTimeout(() => {
        taskCard.classList.add("hidden");
      }, 8000);
      refreshTabsList();
    } else if (msg.type === "WORKFLOW_ERROR") {
      stopTaskTimer();
      taskCurrentAction.textContent = `❌ Error: ${msg.error}`;
      addLog(`❌ Task failed on step ${msg.failedStepIndex}: ${msg.error}`, "error");
    } else if (msg.type === "WORKFLOW_CANCELLED") {
      stopTaskTimer();
      taskCard.classList.add("hidden");
      addLog("🛑 Task cancelled by user", "system");
      refreshTabsList();
    } else if (msg.type === "CAPTCHA_DETECTED") {
      captchaAlert.classList.remove("hidden");
      playAlertChime("captcha");
      addLog(`🚨 CAPTCHA detected: ${msg.name || "Challenge"}`, "captcha");
    } else if (msg.type === "CAPTCHA_RESOLVED") {
      captchaAlert.classList.add("hidden");
      addLog("✅ CAPTCHA resolved. Resuming task...", "success");
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
      takeoverText.textContent = isPaused ? "Resume Agent (Alt+Shift+X)" : "Emergency Pause (Alt+Shift+X)";
      btnTakeover.style.background = isPaused ? "linear-gradient(135deg, rgba(16, 185, 129, 0.3), rgba(5, 150, 105, 0.4))" : "";
      addLog(isPaused ? "⏸️ Agent execution paused by user" : "▶️ Agent execution resumed", "system");
    }
  });

  // Initial check for pending approvals
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
