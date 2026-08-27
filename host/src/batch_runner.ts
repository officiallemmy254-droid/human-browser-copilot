// Human Browser Runtime - Batch Actions Runner & Workflow Engine (M15)
import { generateActionId } from "./contracts/actions.js";
import { BrowserError, BrowserErrorCode, BrowserErrorData, BrowserErrorCodeType, toBrowserError } from "./contracts/errors.js";
import { PolicyEngine } from "./policy_engine.js";
import { requestApproval } from "./approval_broker.js";
import { recordActionAudit } from "./audit_logger.js";
import { PermissionTier } from "./contracts/policy.js";
import { mapErrorToCanonical, isRetryableErrorCode } from "./error_mapper.js";

export type BatchActionDispatcher = (action: string, params: Record<string, any>) => Promise<any>;

export interface VariableExtractConfig {
  variableName: string;
  path?: string; // e.g. "text", "clickedCoordinates.x", "value", "data.id"
}

export interface BatchStep {
  id?: string;
  action: string;
  params?: Record<string, any>;
  extract?: VariableExtractConfig | Record<string, string>; // e.g. { variableName: "userId", path: "id" } or { userId: "id", token: "data.token" }
  extractAs?: string; // Shortcut: saves entire result or result.value as variables[extractAs]
  requireApproval?: boolean;
}

export interface BatchWorkflowParams {
  taskId: string;
  steps: BatchStep[];
  initialVariables?: Record<string, any>;
  origin?: string;
  preValidatePolicy?: boolean;
  preApprove?: boolean;
  stopOnError?: boolean; // Defaults to true (Atomic Halting)
}

export interface BatchStepResult {
  stepIndex: number;
  stepId?: string;
  action: string;
  success: boolean;
  result?: any;
  error?: BrowserErrorData;
  extracted?: Record<string, any>;
}

export interface BatchWorkflowResult {
  taskId: string;
  success: boolean;
  totalSteps: number;
  executedSteps: number;
  failedIndex?: number;
  results: BatchStepResult[];
  variables: Record<string, any>;
  error?: BrowserErrorData;
}

/**
 * Extracts nested property value from an object using a dot-delimited path (e.g. "data.user.id")
 */
export function getNestedProperty(obj: any, path?: string): any {
  if (!obj || !path) return obj;
  const parts = path.split(".");
  let curr = obj;
  for (const part of parts) {
    if (curr === null || curr === undefined) return undefined;
    curr = curr[part];
  }
  return curr;
}

/**
 * Interpolates `{{varName}}` template placeholders inside strings, arrays, and nested objects.
 */
export function interpolateVariables(target: any, variables: Record<string, any>): any {
  if (target === null || target === undefined) {
    return target;
  }

  if (typeof target === "string") {
    // Exact match for a single placeholder: preserve raw variable type (number, boolean, object, etc.)
    const exactMatch = target.match(/^{{\s*([a-zA-Z0-9_\-]+)\s*}}$/);
    if (exactMatch) {
      const varName = exactMatch[1];
      if (Object.prototype.hasOwnProperty.call(variables, varName)) {
        return variables[varName];
      }
      return target;
    }

    // Substring interpolation
    return target.replace(/{{\s*([a-zA-Z0-9_\-]+)\s*}}/g, (match, varName) => {
      if (Object.prototype.hasOwnProperty.call(variables, varName)) {
        const val = variables[varName];
        return val !== null && val !== undefined ? String(val) : "";
      }
      return match;
    });
  }

  if (Array.isArray(target)) {
    return target.map(item => interpolateVariables(item, variables));
  }

  if (typeof target === "object") {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(target)) {
      result[key] = interpolateVariables(value, variables);
    }
    return result;
  }

  return target;
}

function normalizeStepError(err: unknown): BrowserErrorData {
  if (err && typeof err === "object" && "code" in err && typeof (err as any).code === "string") {
    const code = (err as any).code as BrowserErrorCodeType;
    if (Object.values(BrowserErrorCode).includes(code)) {
      return {
        code,
        message: (err as any).message || `Action failed with ${code}`,
        details: (err as any).details,
        retryable: (err as any).retryable ?? isRetryableErrorCode(code)
      };
    }
  }

  return mapErrorToCanonical(err).toJSON();
}

/**
 * Executes a multi-step batch workflow with variable extraction, pre-approval validation, and atomic halting.
 */
export async function executeBatchWorkflow(
  params: BatchWorkflowParams,
  dispatcher: BatchActionDispatcher
): Promise<BatchWorkflowResult> {
  const {
    taskId,
    steps,
    initialVariables = {},
    origin = "https://example.com",
    preValidatePolicy = false,
    preApprove = false,
    stopOnError = true
  } = params;

  const variables: Record<string, any> = { ...initialVariables };
  const stepResults: BatchStepResult[] = [];
  const totalSteps = steps.length;

  // 1. Pre-validation Phase: check security policies upfront if requested
  if (preValidatePolicy) {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const interpolatedParams = interpolateVariables(step.params || {}, variables);
      const policyCheck = PolicyEngine.enforcePolicy({
        origin,
        actionType: step.action,
        targetText: interpolatedParams.elementText || interpolatedParams.label
      });

      if (!policyCheck.allowed && !policyCheck.requiresApproval) {
        const policyErr = policyCheck.error || new BrowserError(
          BrowserErrorCode.POLICY_DENIED,
          `Batch pre-validation failed at step ${i} ("${step.action}"): ${policyCheck.reason || "Action denied by security policy"}`,
          { stepIndex: i, action: step.action, origin }
        );

        return {
          taskId,
          success: false,
          totalSteps,
          executedSteps: 0,
          failedIndex: i,
          results: [],
          variables,
          error: policyErr.toJSON()
        };
      }
    }
  }

  // 2. Sequential Step Execution Phase
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepId = step.id || `step_${i + 1}`;
    const actionId = generateActionId();

    // Interpolate parameters using latest extracted variables
    const rawParams = step.params || {};
    const interpolatedParams = interpolateVariables(rawParams, variables);

    // Enforce Policy per step
    const policyResult = PolicyEngine.enforcePolicy({
      origin,
      actionType: step.action,
      targetText: interpolatedParams.elementText || interpolatedParams.label
    });

    if (!policyResult.allowed) {
      if (policyResult.requiresApproval || step.requireApproval) {
        if (preApprove) {
          try {
            const { promise } = requestApproval({
              actionId,
              taskId,
              tier: policyResult.tier || PermissionTier.HIGH_RISK,
              origin,
              actionType: step.action,
              reason: policyResult.reason || `Batch workflow step ${i} requires approval`,
              details: interpolatedParams
            });
            await promise;
          } catch (approvalErr: any) {
            const errData = normalizeStepError(approvalErr);
            const stepResult: BatchStepResult = {
              stepIndex: i,
              stepId,
              action: step.action,
              success: false,
              error: errData
            };
            stepResults.push(stepResult);

            if (stopOnError) {
              return {
                taskId,
                success: false,
                totalSteps,
                executedSteps: stepResults.length,
                failedIndex: i,
                results: stepResults,
                variables,
                error: errData
              };
            }
            continue;
          }
        } else {
          const denialErr = new BrowserError(
            BrowserErrorCode.APPROVAL_REQUIRED,
            `Step ${i} ("${step.action}") requires human approval before execution.`,
            { stepIndex: i, action: step.action, origin, details: interpolatedParams }
          );
          const stepResult: BatchStepResult = {
            stepIndex: i,
            stepId,
            action: step.action,
            success: false,
            error: denialErr.toJSON()
          };
          stepResults.push(stepResult);

          if (stopOnError) {
            return {
              taskId,
              success: false,
              totalSteps,
              executedSteps: stepResults.length,
              failedIndex: i,
              results: stepResults,
              variables,
              error: denialErr.toJSON()
            };
          }
          continue;
        }
      } else {
        // Policy DENY
        const policyErr = policyResult.error || new BrowserError(
          BrowserErrorCode.POLICY_DENIED,
          `Step ${i} ("${step.action}") denied by security policy: ${policyResult.reason}`,
          { stepIndex: i, action: step.action, origin }
        );
        const stepResult: BatchStepResult = {
          stepIndex: i,
          stepId,
          action: step.action,
          success: false,
          error: policyErr.toJSON()
        };
        stepResults.push(stepResult);

        if (stopOnError) {
          return {
            taskId,
            success: false,
            totalSteps,
            executedSteps: stepResults.length,
            failedIndex: i,
            results: stepResults,
            variables,
            error: policyErr.toJSON()
          };
        }
        continue;
      }
    }

    // Step Execution via Dispatcher
    let dispatchOutput: any;
    let stepSuccess = false;
    let stepError: BrowserErrorData | undefined;

    try {
      if (step.action === "extract" && interpolatedParams.value !== undefined) {
        // Direct local value extraction
        const varName = interpolatedParams.variableName || interpolatedParams.name;
        if (varName) {
          variables[varName] = interpolatedParams.value;
        }
        dispatchOutput = { value: interpolatedParams.value, variableName: varName };
        stepSuccess = true;
      } else {
        dispatchOutput = await dispatcher(step.action, interpolatedParams);
        // Check if dispatcher returned an error response
        if (dispatchOutput && dispatchOutput.success === false) {
          stepSuccess = false;
          stepError = normalizeStepError(dispatchOutput.error || `Step ${i} ("${step.action}") failed during dispatch.`);
        } else {
          stepSuccess = true;
        }
      }
    } catch (err: any) {
      stepSuccess = false;
      stepError = normalizeStepError(err);
    }

    // Handle Variable Extractions from step output
    const extractedThisStep: Record<string, any> = {};

    if (stepSuccess && dispatchOutput) {
      if (step.extractAs) {
        const val = dispatchOutput.value !== undefined ? dispatchOutput.value : (dispatchOutput.text !== undefined ? dispatchOutput.text : dispatchOutput);
        variables[step.extractAs] = val;
        extractedThisStep[step.extractAs] = val;
      }

      if (step.extract) {
        if ("variableName" in step.extract && typeof (step.extract as VariableExtractConfig).variableName === "string") {
          const cfg = step.extract as VariableExtractConfig;
          const val = getNestedProperty(dispatchOutput, cfg.path);
          variables[cfg.variableName] = val !== undefined ? val : dispatchOutput;
          extractedThisStep[cfg.variableName] = variables[cfg.variableName];
        } else if (typeof step.extract === "object") {
          for (const [varName, pathStr] of Object.entries(step.extract)) {
            const val = getNestedProperty(dispatchOutput, pathStr);
            variables[varName] = val !== undefined ? val : dispatchOutput;
            extractedThisStep[varName] = variables[varName];
          }
        }
      }
    }

    const stepResult: BatchStepResult = {
      stepIndex: i,
      stepId,
      action: step.action,
      success: stepSuccess,
      result: dispatchOutput,
      error: stepError,
      extracted: Object.keys(extractedThisStep).length > 0 ? extractedThisStep : undefined
    };

    stepResults.push(stepResult);

    // Audit Logging
    recordActionAudit({
      taskId,
      actionId,
      origin,
      actionType: `batch_step_${step.action}`,
      policyTier: policyResult.tier,
      policyDecision: "ALLOW",
      executionResult: { stepIndex: i, stepId, success: stepSuccess },
      error: stepError
    });

    // ATOMIC HALTING: If step failed, halt immediately
    if (!stepSuccess && stopOnError) {
      return {
        taskId,
        success: false,
        totalSteps,
        executedSteps: stepResults.length,
        failedIndex: i,
        results: stepResults,
        variables,
        error: stepError
      };
    }
  }

  return {
    taskId,
    success: stepResults.every(r => r.success),
    totalSteps,
    executedSteps: stepResults.length,
    results: stepResults,
    variables
  };
}
