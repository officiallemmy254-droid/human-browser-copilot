// Human Browser Copilot - Autonomous Batch Workflow & Long-Task Execution Engine
import { attachToTab, humanClick, humanType, humanScroll, captureScreenshot, evaluateScript, waitForSelector, waitForText, waitForUrl, waitForNetworkIdle, extractTableData, extractElements, extractStructuredData, triggerGarbageCollection, getPaused, setPaused } from "./debugger_cdp.js";
import { setTaskActive } from "./keepalive.js";

let currentWorkflow = null;
let workflowState = "idle"; // "idle" | "running" | "paused" | "completed" | "error" | "cancelled"
let extractedVariables = {};
let stepIndex = 0;
let totalSteps = 0;
let broadcastCallback = null;

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

export function setBroadcastCallback(cb) {
  broadcastCallback = cb;
}

function broadcastEvent(type, payload) {
  const eventData = {
    type,
    taskId: currentWorkflow?.id,
    taskName: currentWorkflow?.name || "Automated Batch Task",
    state: workflowState,
    stepIndex,
    totalSteps,
    timestamp: Date.now(),
    ...payload
  };

  // Broadcast to extension runtime (Side Panel & Content)
  chrome.runtime.sendMessage(eventData).catch(() => {});

  // Broadcast to native messaging host
  if (broadcastCallback) {
    broadcastCallback(eventData);
  }
}

export function getWorkflowStatus() {
  return {
    state: workflowState,
    workflow: currentWorkflow ? {
      id: currentWorkflow.id,
      name: currentWorkflow.name,
      stepIndex,
      totalSteps,
      extractedCount: Object.keys(extractedVariables).length
    } : null,
    extractedVariables
  };
}

export function pauseWorkflow() {
  if (workflowState === "running") {
    workflowState = "paused";
    setPaused(true);
    broadcastEvent("WORKFLOW_PAUSED", { reason: "User paused" });
    return { ok: true, state: workflowState };
  }
  return { ok: false, error: "No running workflow to pause" };
}

export function resumeWorkflow() {
  if (workflowState === "paused") {
    workflowState = "running";
    setPaused(false);
    broadcastEvent("WORKFLOW_RESUMED", {});
    return { ok: true, state: workflowState };
  }
  return { ok: false, error: "Workflow is not paused" };
}

export function cancelWorkflow() {
  if (workflowState === "running" || workflowState === "paused") {
    workflowState = "cancelled";
    setTaskActive(false);
    broadcastEvent("WORKFLOW_CANCELLED", { reason: "User cancelled task" });
    return { ok: true, state: workflowState };
  }
  return { ok: false, error: "No active workflow to cancel" };
}

/**
 * Executes a resilient, long-running batch workflow of actions
 */
export async function executeWorkflow(task, activeTabId) {
  if (workflowState === "running") {
    throw new Error("Another workflow is currently running. Please cancel or wait for it to complete.");
  }

  currentWorkflow = {
    id: task.id || `task_${Date.now()}`,
    name: task.name || "Long Automated Batch Task",
    steps: task.steps || [],
    options: {
      retryCount: task.options?.retryCount ?? 3,
      stepDelayMs: task.options?.stepDelayMs ?? 400,
      autoScroll: task.options?.autoScroll ?? true,
      antiFatiguePauses: task.options?.antiFatiguePauses ?? true,
      ...task.options
    }
  };

  stepIndex = 0;
  totalSteps = currentWorkflow.steps.length;
  workflowState = "running";
  extractedVariables = {};
  setTaskActive(true, { id: currentWorkflow.id, name: currentWorkflow.name, totalSteps });

  broadcastEvent("WORKFLOW_STARTED", { totalSteps });

  let tabId = activeTabId;
  const startTime = Date.now();

  try {
    for (stepIndex = 0; stepIndex < totalSteps; stepIndex++) {
      // Check cancellation / pause
      if (workflowState === "cancelled") {
        throw new Error("Workflow was cancelled by user");
      }

      while (workflowState === "paused" || getPaused()) {
        await sleep(500);
        if (workflowState === "cancelled") throw new Error("Workflow cancelled while paused");
      }

      const step = currentWorkflow.steps[stepIndex];
      broadcastEvent("WORKFLOW_STEP_START", {
        stepIndex: stepIndex + 1,
        totalSteps,
        action: step.action,
        description: step.description || `Step ${stepIndex + 1}: ${step.action}`
      });

      // Execute step with retry mechanism
      let result = null;
      let lastErr = null;
      const maxRetries = step.retry ?? currentWorkflow.options.retryCount;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          result = await executeStepAction(step, tabId);
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          console.warn(`[Workflow] Step ${stepIndex + 1} (${step.action}) attempt ${attempt} failed: ${err.message}`);
          if (attempt < maxRetries) {
            await sleep(1000 * attempt); // Exponential backoff
          }
        }
      }

      if (lastErr) {
        if (step.ignoreErrors) {
          console.warn(`[Workflow] Step ${stepIndex + 1} failed but ignoreErrors is true.`);
          result = { error: lastErr.message, ignored: true };
        } else {
          throw new Error(`Step ${stepIndex + 1} (${step.action}) failed after ${maxRetries} attempts: ${lastErr.message}`);
        }
      }

      // Store result variable if requested
      if (step.variable && result !== undefined) {
        extractedVariables[step.variable] = result;
      }

      broadcastEvent("WORKFLOW_STEP_SUCCESS", {
        stepIndex: stepIndex + 1,
        totalSteps,
        action: step.action,
        result
      });

      // Jitter delay between steps
      const baseDelay = step.delayMs || currentWorkflow.options.stepDelayMs;
      await sleep(baseDelay + Math.random() * 200);

      // Periodic Anti-Fatigue human reading pause during long automation runs (every 8 steps)
      if (currentWorkflow.options.antiFatiguePauses && (stepIndex + 1) % 8 === 0) {
        const pauseTime = 1500 + Math.random() * 2500;
        await sleep(pauseTime);
      }

      // Memory cleanup every 25 steps to prevent tab crashes
      if ((stepIndex + 1) % 25 === 0 && tabId) {
        await triggerGarbageCollection(tabId);
      }

      // Save intermediate checkpoint to chrome.storage
      await chrome.storage.local.set({
        lastWorkflowCheckpoint: {
          id: currentWorkflow.id,
          stepIndex: stepIndex + 1,
          totalSteps,
          timestamp: Date.now()
        }
      }).catch(() => {});
    }

    workflowState = "completed";
    setTaskActive(false);
    const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);

    broadcastEvent("WORKFLOW_COMPLETED", {
      durationSec,
      totalSteps,
      extractedVariables
    });

    return {
      ok: true,
      taskId: currentWorkflow.id,
      state: "completed",
      durationSec,
      stepsExecuted: totalSteps,
      extractedVariables
    };

  } catch (err) {
    workflowState = "error";
    setTaskActive(false);
    broadcastEvent("WORKFLOW_ERROR", {
      error: err.message,
      failedStepIndex: stepIndex + 1,
      totalSteps
    });
    throw err;
  }
}

async function executeStepAction(step, tabId) {
  switch (step.action) {
    case "navigate": {
      if (!step.url) throw new Error("Missing url in navigate action");
      await chrome.tabs.update(tabId, { url: step.url });
      await waitForNetworkIdle(tabId, 500, step.timeout || 30000).catch(() => {});
      return { navigated: true, url: step.url };
    }

    case "wait_for": {
      const condition = step.condition || "selector";
      const timeout = step.timeout || 30000;

      if (condition === "selector") {
        return await waitForSelector(tabId, step.target, timeout);
      } else if (condition === "text") {
        return await waitForText(tabId, step.target, timeout);
      } else if (condition === "url") {
        return await waitForUrl(tabId, step.target, timeout);
      } else if (condition === "network_idle") {
        return await waitForNetworkIdle(tabId, step.idleTimeMs || 500, timeout);
      } else if (condition === "timeout" || condition === "sleep") {
        await sleep(step.ms || step.timeout || 1000);
        return { sleptMs: step.ms || step.timeout || 1000 };
      }
      throw new Error(`Unknown wait_for condition: ${condition}`);
    }

    case "click": {
      let x = step.x;
      let y = step.y;
      if (x === undefined || y === undefined) {
        if (!step.selector) throw new Error("Click requires selector or (x, y)");

        // Auto-scroll into view if needed
        await evaluateScript(tabId, `
          (function() {
            const el = document.querySelector(${JSON.stringify(step.selector)});
            if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
          })()
        `).catch(() => {});
        await sleep(200);

        const coords = await evaluateScript(tabId, `
          (function() {
            const el = document.querySelector(${JSON.stringify(step.selector)});
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          })()
        `);

        if (!coords) throw new Error(`Element not found for click: ${step.selector}`);
        x = coords.x;
        y = coords.y;
      }
      await humanClick(tabId, x, y);
      return { clicked: true, x, y };
    }

    case "type": {
      if (step.selector) {
        const coords = await evaluateScript(tabId, `
          (function() {
            const el = document.querySelector(${JSON.stringify(step.selector)});
            if (!el) return null;
            if (${Boolean(step.clear)}) {
              el.value = "";
              el.dispatchEvent(new Event("input", { bubbles: true }));
            }
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            const r = el.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          })()
        `);
        if (coords) {
          await humanClick(tabId, coords.x, coords.y);
        }
      }
      // Replace template variables like {{username}}
      let textToType = step.text;
      for (const [k, v] of Object.entries(extractedVariables)) {
        textToType = textToType.replaceAll(`{{${k}}}`, String(v));
      }
      await humanType(tabId, textToType);
      return { typed: true, length: textToType.length };
    }

    case "scroll": {
      const dist = step.distanceY !== undefined ? step.distanceY : 400;
      await humanScroll(tabId, dist);
      return { scrolled: true, distanceY: dist };
    }

    case "extract": {
      const extractType = step.extractType || "elements";
      if (extractType === "table") {
        return await extractTableData(tabId, step.selector || "table");
      } else if (extractType === "elements") {
        return await extractElements(tabId, step.selector || "a", step.attributes || ["href", "src", "value", "id"]);
      } else if (extractType === "structured") {
        return await extractStructuredData(tabId);
      } else if (extractType === "text") {
        return await evaluateScript(tabId, `
          (function() {
            const el = document.querySelector(${JSON.stringify(step.selector)});
            return el ? el.innerText.trim() : null;
          })()
        `);
      }
      throw new Error(`Unknown extractType: ${extractType}`);
    }

    case "evaluate": {
      if (!step.script) throw new Error("Missing script in evaluate action");
      return await evaluateScript(tabId, step.script);
    }

    case "snapshot": {
      const base64 = await captureScreenshot(tabId);
      return { snapshotTaken: true, size: base64.length };
    }

    case "sleep": {
      const ms = step.ms || 1000;
      await sleep(ms);
      return { sleptMs: ms };
    }

    case "manage_tab": {
      if (step.operation === "new") {
        const newTab = await chrome.tabs.create({ url: step.url || "about:blank", active: true });
        await attachToTab(newTab.id);
        return { tabId: newTab.id, created: true };
      } else if (step.operation === "close") {
        const targetId = step.tabId || tabId;
        await chrome.tabs.remove(targetId);
        return { tabId: targetId, closed: true };
      }
      throw new Error(`Unknown tab operation: ${step.operation}`);
    }

    default:
      throw new Error(`Unknown workflow step action: ${step.action}`);
  }
}
