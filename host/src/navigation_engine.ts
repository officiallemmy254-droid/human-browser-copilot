import { generateActionId } from "./contracts/actions.js";
import { BrowserError, BrowserErrorCode, toBrowserError } from "./contracts/errors.js";
import { mapErrorToCanonical } from "./error_mapper.js";
import { SnapshotRegistry } from "./observation_engine.js";
import { validateNavigationOrigin } from "./origin_authorizer.js";

export type ActionDispatcher = (command: string, params: Record<string, any>) => Promise<any>;

export interface NavigationParams {
  taskId: string;
  url: string;
  tabId?: number;
  originAllowlist?: string[];
}

export interface NavigationResult {
  actionId: string;
  success: boolean;
  verified: boolean;
  navigatedUrl?: string;
  error?: { code: string; message: string; details?: Record<string, any> };
}

export async function executeNavigation(
  params: NavigationParams,
  dispatcher: ActionDispatcher
): Promise<NavigationResult> {
  const actionId = generateActionId();

  if (params.originAllowlist && params.originAllowlist.length > 0) {
    const originCheck = validateNavigationOrigin(params.url, params.originAllowlist);
    if (!originCheck.allowed && originCheck.error) {
      return {
        actionId,
        success: false,
        verified: false,
        error: originCheck.error.toJSON()
      };
    }
  }

  try {
    const result = await dispatcher("navigate", { url: params.url });

    // Invalidate stale snapshot on navigation
    const targetTabId = params.tabId || result.tabId;
    if (targetTabId !== undefined) {
      // Overwriting with empty snapshot invalidates previous snapshot for this tab
      SnapshotRegistry.registerSnapshot(targetTabId, `snap_${targetTabId}_invalidated_${Date.now()}`, []);
    }

    return {
      actionId,
      success: true,
      verified: true,
      navigatedUrl: result.url || params.url
    };
  } catch (err: any) {
    const browserErr = mapErrorToCanonical(err);
    return {
      actionId,
      success: false,
      verified: false,
      error: browserErr.toJSON()
    };
  }
}

export interface WaitParams {
  taskId: string;
  condition: "element_appears" | "element_disappears" | "url_changes" | "navigation_completes" | "timeout";
  target?: string;
  timeoutMs?: number;
}

export interface WaitResult {
  actionId: string;
  success: boolean;
  verified: boolean;
  elapsedMs?: number;
  error?: { code: string; message: string; details?: Record<string, any> };
}

export async function executeWait(
  params: WaitParams,
  dispatcher: ActionDispatcher
): Promise<WaitResult> {
  const actionId = generateActionId();
  const timeout = params.timeoutMs || 30000;

  // Map high-level condition names to low-level CDP/content script waiter names
  let cdpCondition = "selector";
  if (params.condition === "element_appears") cdpCondition = "selector";
  else if (params.condition === "element_disappears") cdpCondition = "element_disappears";
  else if (params.condition === "url_changes") cdpCondition = "url";
  else if (params.condition === "navigation_completes") cdpCondition = "network_idle";
  else if (params.condition === "timeout") cdpCondition = "timeout";

  try {
    const result = await dispatcher("wait_for", {
      condition: cdpCondition,
      target: params.target || "",
      timeout
    });

    return {
      actionId,
      success: true,
      verified: true,
      elapsedMs: result.elapsedMs ?? (result.sleptMs ?? 0)
    };
  } catch (err: any) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const isTimeout = rawMsg.toLowerCase().includes("timeout") || rawMsg.toLowerCase().includes("timed out");

    const browserErr = isTimeout
      ? new BrowserError(BrowserErrorCode.TIMEOUT, rawMsg, { condition: params.condition, target: params.target, timeoutMs: timeout }, true)
      : toBrowserError(err);

    return {
      actionId,
      success: false,
      verified: false,
      error: browserErr.toJSON()
    };
  }
}
