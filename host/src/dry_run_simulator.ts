// Human Browser Runtime - Dry Run Mode & Policy Simulator (M23)
import { generateActionId } from "./contracts/actions.js";
import { BrowserError, BrowserErrorCode, BrowserErrorData, toBrowserError } from "./contracts/errors.js";
import { PermissionTier, PermissionTierType, isOriginAuthorized, parseCanonicalOrigin } from "./contracts/policy.js";
import { PolicyEngine } from "./policy_engine.js";
import { resolveSnapshotElement } from "./observation_engine.js";
import { ScreenshotGuard } from "./screenshot_guard.js";
import { AuditLogger } from "./audit_logger.js";
import { EventStreamer } from "./event_streamer.js";

export interface DryRunContext {
  taskId?: string;
  origin?: string;
  allowedOrigins?: string[];
  agentIdentity?: string;
  snapshotId?: string;
}

export interface DryRunResult {
  actionId: string;
  success: boolean;
  dryRun: true;
  simulated: true;
  verified: boolean;
  policyTier: PermissionTierType;
  policyDecision: "ALLOW" | "PROMPT" | "DENY";
  result?: Record<string, any>;
  error?: BrowserErrorData;
}

export interface DryRunBatchResult {
  actionId: string;
  success: boolean;
  dryRun: true;
  simulated: true;
  totalActions: number;
  executedActions: number;
  failedIndex?: number;
  results: DryRunResult[];
  error?: BrowserErrorData;
}

export class DryRunSimulatorManager {
  /**
   * Simulates execution of a single browser action without mutating the live browser page.
   */
  public async simulateAction(
    actionType: string,
    params: Record<string, any> = {},
    context: DryRunContext = {}
  ): Promise<DryRunResult> {
    const actionId = generateActionId();
    const taskId = context.taskId || params.taskId || "dry_run_task";
    const origin = context.origin || params.origin || params.url || "about:blank";

    // 1. Origin Authorization Check for Navigation
    if (actionType.toLowerCase() === "navigate" && context.allowedOrigins && context.allowedOrigins.length > 0) {
      const targetUrl = params.url || "";
      if (!isOriginAuthorized(targetUrl, context.allowedOrigins)) {
        const err = new BrowserError(
          BrowserErrorCode.ORIGIN_NOT_ALLOWED,
          `Dry-run simulation rejected navigation to origin "${parseCanonicalOrigin(targetUrl)}". Origin not in allowed list.`,
          { targetUrl, allowedOrigins: context.allowedOrigins }
        );

        const audit = AuditLogger.logEvent({
          taskId,
          actionId,
          agentIdentity: context.agentIdentity || "dry-run-agent",
          origin,
          actionType,
          policyTier: PermissionTier.HIGH_RISK,
          policyDecision: "DENY",
          approvalState: "NOT_REQUIRED",
          verificationStatus: "FAILED",
          error: err.toJSON(),
          dryRun: true
        });
        EventStreamer.publishAuditEvent(audit);

        return {
          actionId,
          success: false,
          dryRun: true,
          simulated: true,
          verified: false,
          policyTier: PermissionTier.HIGH_RISK,
          policyDecision: "DENY",
          error: err.toJSON()
        };
      }
    }

    // 2. Element Resolution if Snapshot & ElementId provided
    const snapshotId = context.snapshotId || params.snapshotId;
    let resolvedElement: any;
    let targetText = params.elementText || params.text;

    if (snapshotId && params.elementId) {
      const resolved = resolveSnapshotElement(snapshotId, params.elementId);
      if (!resolved.ok) {
        const audit = AuditLogger.logEvent({
          taskId,
          actionId,
          agentIdentity: context.agentIdentity || "dry-run-agent",
          origin,
          actionType,
          policyTier: PermissionTier.INTERACT,
          policyDecision: "DENY",
          approvalState: "NOT_REQUIRED",
          verificationStatus: "FAILED",
          error: resolved.error.toJSON(),
          dryRun: true
        });
        EventStreamer.publishAuditEvent(audit);

        return {
          actionId,
          success: false,
          dryRun: true,
          simulated: true,
          verified: false,
          policyTier: PermissionTier.INTERACT,
          policyDecision: "DENY",
          error: resolved.error.toJSON()
        };
      }
      resolvedElement = resolved.element;
      if (!targetText && resolvedElement.text) {
        targetText = resolvedElement.text;
      }
    }

    // 3. Security Policy Evaluation
    const policyResult = PolicyEngine.evaluatePolicy({
      origin,
      actionType,
      targetText,
      targetSelector: params.selector
    });

    if (policyResult.decision === "DENY") {
      const err = new BrowserError(
        BrowserErrorCode.POLICY_DENIED,
        policyResult.reason || `Action "${actionType}" denied by security policy during dry-run simulation.`,
        { origin, actionType, tier: policyResult.tier }
      );

      const audit = AuditLogger.logEvent({
        taskId,
        actionId,
        agentIdentity: context.agentIdentity || "dry-run-agent",
        origin,
        actionType,
        policyTier: policyResult.tier,
        policyDecision: "DENY",
        approvalState: "NOT_REQUIRED",
        verificationStatus: "FAILED",
        error: err.toJSON(),
        dryRun: true
      });
      EventStreamer.publishAuditEvent(audit);

      return {
        actionId,
        success: false,
        dryRun: true,
        simulated: true,
        verified: false,
        policyTier: policyResult.tier,
        policyDecision: "DENY",
        error: err.toJSON()
      };
    }

    // 4. Compute Simulated Output (Non-Mutating)
    let simulatedResultPayload: Record<string, any> = {};
    const normalizedType = actionType.toLowerCase();

    switch (normalizedType) {
      case "click": {
        let x = params.x;
        let y = params.y;
        if (resolvedElement && resolvedElement.boundingBox) {
          x = resolvedElement.boundingBox.x + resolvedElement.boundingBox.width / 2;
          y = resolvedElement.boundingBox.y + resolvedElement.boundingBox.height / 2;
        }
        simulatedResultPayload = {
          clickedCoordinates: x !== undefined && y !== undefined ? { x, y } : undefined,
          targetElement: resolvedElement?.id || params.elementId,
          targetText
        };
        break;
      }

      case "type": {
        simulatedResultPayload = {
          charactersTyped: (params.text || "").length,
          targetElement: resolvedElement?.id || params.elementId,
          clearedFirst: Boolean(params.clearFirst)
        };
        break;
      }

      case "clear": {
        simulatedResultPayload = {
          targetElement: resolvedElement?.id || params.elementId,
          cleared: true
        };
        break;
      }

      case "keypress": {
        simulatedResultPayload = {
          key: params.key
        };
        break;
      }

      case "scroll": {
        simulatedResultPayload = {
          distanceScrolled: params.distanceY !== undefined ? params.distanceY : 400
        };
        break;
      }

      case "navigate": {
        simulatedResultPayload = {
          navigatedUrl: params.url
        };
        break;
      }

      case "screenshot": {
        const guardResult = ScreenshotGuard.validateRequest(params);
        if (!guardResult.valid || !guardResult.sanitizedOptions) {
          const err = guardResult.error || new BrowserError(BrowserErrorCode.POLICY_DENIED, "Screenshot validation failed");
          const audit = AuditLogger.logEvent({
            taskId,
            actionId,
            agentIdentity: context.agentIdentity || "dry-run-agent",
            origin,
            actionType,
            policyTier: guardResult.tier,
            policyDecision: "DENY",
            verificationStatus: "FAILED",
            error: err.toJSON(),
            dryRun: true
          });
          EventStreamer.publishAuditEvent(audit);

          return {
            actionId,
            success: false,
            dryRun: true,
            simulated: true,
            verified: false,
            policyTier: guardResult.tier,
            policyDecision: "DENY",
            error: err.toJSON()
          };
        }

        simulatedResultPayload = {
          format: guardResult.sanitizedOptions.format,
          quality: guardResult.sanitizedOptions.quality,
          saveToDisk: guardResult.sanitizedOptions.saveToDisk,
          filePath: guardResult.sanitizedOptions.filePath,
          simulatedImageData: "[SIMULATED_JPEG_DATA]"
        };
        break;
      }

      case "wait": {
        simulatedResultPayload = {
          condition: params.condition || "timeout",
          simulatedElapsedMs: 50
        };
        break;
      }

      default: {
        simulatedResultPayload = {
          action: actionType,
          simulated: true
        };
        break;
      }
    }

    // 5. Record Audit Event with dryRun: true
    const auditEvent = AuditLogger.logEvent({
      taskId,
      actionId,
      agentIdentity: context.agentIdentity || "dry-run-agent",
      origin,
      actionType,
      policyTier: policyResult.tier,
      policyDecision: policyResult.decision,
      approvalState: policyResult.decision === "PROMPT" ? "PENDING" : "NOT_REQUIRED",
      executionResult: { ...simulatedResultPayload, simulated: true, dryRun: true },
      verificationStatus: "SKIPPED",
      dryRun: true
    });

    EventStreamer.publishAuditEvent(auditEvent);

    return {
      actionId,
      success: true,
      dryRun: true,
      simulated: true,
      verified: true,
      policyTier: policyResult.tier,
      policyDecision: policyResult.decision,
      result: simulatedResultPayload
    };
  }

  /**
   * Simulates a batch of actions sequentially. Halts if any action fails.
   */
  public async simulateBatch(
    actions: Array<{ action: string; params?: Record<string, any> }>,
    context: DryRunContext = {}
  ): Promise<DryRunBatchResult> {
    const batchActionId = generateActionId();
    const results: DryRunResult[] = [];

    for (let i = 0; i < actions.length; i++) {
      const item = actions[i];
      const singleRes = await this.simulateAction(item.action, item.params || {}, context);
      results.push(singleRes);

      if (!singleRes.success) {
        return {
          actionId: batchActionId,
          success: false,
          dryRun: true,
          simulated: true,
          totalActions: actions.length,
          executedActions: results.length,
          failedIndex: i,
          results,
          error: singleRes.error
        };
      }
    }

    return {
      actionId: batchActionId,
      success: true,
      dryRun: true,
      simulated: true,
      totalActions: actions.length,
      executedActions: results.length,
      results
    };
  }
}

export const DryRunSimulator = new DryRunSimulatorManager();

export function simulateBrowserAction(
  actionType: string,
  params: Record<string, any> = {},
  context: DryRunContext = {}
): Promise<DryRunResult> {
  return DryRunSimulator.simulateAction(actionType, params, context);
}

export function simulateBrowserBatch(
  actions: Array<{ action: string; params?: Record<string, any> }>,
  context: DryRunContext = {}
): Promise<DryRunBatchResult> {
  return DryRunSimulator.simulateBatch(actions, context);
}
