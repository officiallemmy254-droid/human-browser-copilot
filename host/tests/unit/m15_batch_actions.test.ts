import { describe, it, expect, beforeEach, vi } from "vitest";
import { BrowserErrorCode } from "../../src/contracts/errors.js";
import { PolicyEngine } from "../../src/policy_engine.js";
import { ApprovalBroker, resolveApprovalRequest } from "../../src/approval_broker.js";
import {
  executeBatchWorkflow,
  interpolateVariables,
  getNestedProperty,
  BatchStep,
  BatchActionDispatcher
} from "../../src/batch_runner.js";

describe("M15: Batch Actions & Multi-Step Workflows", () => {
  beforeEach(() => {
    PolicyEngine.resetToDefaults();
    ApprovalBroker.clear();
  });

  describe("Variable Interpolation & Property Extraction", () => {
    it("should correctly interpolate strings with {{varName}} placeholders", () => {
      const vars = { name: "Antigravity", count: 42 };
      const template = "Welcome to {{name}}, item #{{count}}!";
      const result = interpolateVariables(template, vars);
      expect(result).toBe("Welcome to Antigravity, item #42!");
    });

    it("should preserve original typed values for exact matches", () => {
      const vars = { num: 100, flag: true, data: { key: "value" } };
      expect(interpolateVariables("{{num}}", vars)).toBe(100);
      expect(interpolateVariables("{{flag}}", vars)).toBe(true);
      expect(interpolateVariables("{{data}}", vars)).toEqual({ key: "value" });
    });

    it("should recursively interpolate nested objects and arrays", () => {
      const vars = { selectorId: "submit-btn", textVal: "Confirm Order" };
      const obj = {
        action: "click",
        params: {
          target: "#{{selectorId}}",
          nested: {
            text: "{{textVal}}"
          },
          items: ["item_{{selectorId}}", 123]
        }
      };

      const result = interpolateVariables(obj, vars);
      expect(result.params.target).toBe("#submit-btn");
      expect(result.params.nested.text).toBe("Confirm Order");
      expect(result.params.items).toEqual(["item_submit-btn", 123]);
    });

    it("should extract nested properties using dot-notation", () => {
      const obj = { data: { user: { id: "user_123", details: { age: 30 } } } };
      expect(getNestedProperty(obj, "data.user.id")).toBe("user_123");
      expect(getNestedProperty(obj, "data.user.details.age")).toBe(30);
      expect(getNestedProperty(obj, "data.invalid")).toBeUndefined();
    });
  });

  describe("Workflow Execution with Variable Extraction", () => {
    it("should execute multi-step workflow passing extracted variables to subsequent steps", async () => {
      const executedSteps: Array<{ action: string; params: any }> = [];

      const mockDispatcher: BatchActionDispatcher = async (action, params) => {
        executedSteps.push({ action, params });
        if (action === "extract") {
          return { orderId: "ORD-99881", amount: 150 };
        }
        if (action === "type") {
          return { success: true, charactersTyped: params.text.length };
        }
        if (action === "click") {
          return { success: true, clickedCoordinates: { x: 100, y: 200 } };
        }
        return { success: true };
      };

      const steps: BatchStep[] = [
        {
          id: "step_get_order",
          action: "extract",
          params: { query: "recent" },
          extract: { orderCode: "orderId", totalAmount: "amount" }
        },
        {
          id: "step_type_order",
          action: "type",
          params: {
            selector: "#order-input",
            text: "Filling {{orderCode}} with amount ${{totalAmount}}"
          }
        },
        {
          id: "step_select_tab",
          action: "click",
          params: {
            selector: "#tab-{{orderCode}}"
          }
        }
      ];

      const workflowResult = await executeBatchWorkflow(
        {
          taskId: "task_batch_1",
          steps,
          origin: "https://shop.example.com"
        },
        mockDispatcher
      );

      expect(workflowResult.success).toBe(true);
      expect(workflowResult.totalSteps).toBe(3);
      expect(workflowResult.executedSteps).toBe(3);
      expect(workflowResult.variables.orderCode).toBe("ORD-99881");
      expect(workflowResult.variables.totalAmount).toBe(150);

      expect(executedSteps[1].params.text).toBe("Filling ORD-99881 with amount $150");
      expect(executedSteps[2].params.selector).toBe("#tab-ORD-99881");
    });
  });

  describe("Atomic Halting on Failure", () => {
    it("should halt execution immediately when a step fails and NOT execute subsequent side effects", async () => {
      const executedCalls: string[] = [];

      const mockDispatcher: BatchActionDispatcher = async (action, params) => {
        executedCalls.push(action);
        if (action === "observe") {
          return { status: "ok" };
        }
        if (action === "click") {
          return {
            success: false,
            error: {
              code: BrowserErrorCode.STALE_ELEMENT,
              message: "Element el_10 is no longer in DOM",
              retryable: true
            }
          };
        }
        if (action === "navigate") {
          return { success: true };
        }
        return { success: true };
      };

      const steps: BatchStep[] = [
        { id: "s1", action: "observe", params: {} },
        { id: "s2", action: "click", params: { selector: "#failing" } },
        { id: "s3", action: "navigate", params: { url: "https://danger.com" } }
      ];

      const result = await executeBatchWorkflow(
        {
          taskId: "task_halt_test",
          steps,
          origin: "https://example.com"
        },
        mockDispatcher
      );

      expect(result.success).toBe(false);
      expect(result.failedIndex).toBe(1);
      expect(result.executedSteps).toBe(2);
      expect(result.error?.code).toBe(BrowserErrorCode.STALE_ELEMENT);

      // Verify that step 3 was NEVER executed (Atomic Halting Guarantee)
      expect(executedCalls).toEqual(["observe", "click"]);
      expect(executedCalls).not.toContain("navigate");
    });

    it("should halt atomically when dispatcher throws an uncaught exception", async () => {
      const executedCalls: string[] = [];

      const mockDispatcher: BatchActionDispatcher = async (action) => {
        executedCalls.push(action);
        if (action === "observe") return { ok: true };
        if (action === "click") {
          throw new Error("Target connection closed unexpectedly");
        }
        if (action === "type") return { ok: true };
        return {};
      };

      const steps: BatchStep[] = [
        { action: "observe" },
        { action: "click" },
        { action: "type" }
      ];

      const result = await executeBatchWorkflow(
        { taskId: "task_throw_test", steps },
        mockDispatcher
      );

      expect(result.success).toBe(false);
      expect(result.failedIndex).toBe(1);
      expect(result.executedSteps).toBe(2);
      expect(result.error?.code).toBe(BrowserErrorCode.UNKNOWN_ERROR);
      expect(executedCalls).toEqual(["observe", "click"]);
      expect(executedCalls).not.toContain("type");
    });
  });

  describe("Policy Pre-Validation & Pre-Approval Semantics", () => {
    it("should reject entire batch upfront during preValidatePolicy if any step is DENIED by policy", async () => {
      // Set strict mode so HIGH_RISK actions are DENIED
      PolicyEngine.setStrictMode(true);

      const mockDispatcher = vi.fn();

      const steps: BatchStep[] = [
        { action: "observe" },
        { action: "click", params: { elementText: "Delete Account Permanently" } }
      ];

      const result = await executeBatchWorkflow(
        {
          taskId: "task_policy_preval",
          steps,
          origin: "https://app.com",
          preValidatePolicy: true
        },
        mockDispatcher
      );

      expect(result.success).toBe(false);
      expect(result.executedSteps).toBe(0);
      expect(result.failedIndex).toBe(1);
      expect(result.error?.code).toBe(BrowserErrorCode.POLICY_DENIED);

      // Dispatcher should not have been called even once
      expect(mockDispatcher).not.toHaveBeenCalled();
    });

    it("should support pre-approval flow resolving pending human approvals during execution", async () => {
      const executed: string[] = [];

      const mockDispatcher: BatchActionDispatcher = async (action) => {
        executed.push(action);
        return { success: true };
      };

      const steps: BatchStep[] = [
        { action: "observe" },
        { action: "click", params: { elementText: "Submit Order Now" } } // Triggers EXTERNAL_SIDE_EFFECT -> PROMPT
      ];

      // Execute workflow with preApprove: true in a promise
      const workflowPromise = executeBatchWorkflow(
        {
          taskId: "task_approval_batch",
          steps,
          origin: "https://shop.com",
          preApprove: true
        },
        mockDispatcher
      );

      // Wait for approval broker to receive the approval request
      await new Promise(r => setTimeout(r, 10));

      const pending = ApprovalBroker.getPendingApprovals("task_approval_batch");
      expect(pending).toHaveLength(1);

      // Approve the request
      resolveApprovalRequest(pending[0].requestId, true, "supervisor");

      const result = await workflowPromise;
      expect(result.success).toBe(true);
      expect(result.executedSteps).toBe(2);
      expect(executed).toEqual(["observe", "click"]);
    });

    it("should halt batch workflow when human approval is rejected", async () => {
      const executed: string[] = [];

      const mockDispatcher: BatchActionDispatcher = async (action) => {
        executed.push(action);
        return { success: true };
      };

      const steps: BatchStep[] = [
        { action: "observe" },
        { action: "click", params: { elementText: "Submit Payment" } },
        { action: "click", params: { elementText: "Next Step" } }
      ];

      const workflowPromise = executeBatchWorkflow(
        {
          taskId: "task_reject_batch",
          steps,
          origin: "https://shop.com",
          preApprove: true
        },
        mockDispatcher
      );

      await new Promise(r => setTimeout(r, 10));

      const pending = ApprovalBroker.getPendingApprovals("task_reject_batch");
      expect(pending).toHaveLength(1);

      // User rejects the approval
      resolveApprovalRequest(pending[0].requestId, false, "admin");

      const result = await workflowPromise;
      expect(result.success).toBe(false);
      expect(result.failedIndex).toBe(1);
      expect(result.executedSteps).toBe(2);
      expect(result.error?.code).toBe(BrowserErrorCode.APPROVAL_REQUIRED);

      // Step 3 must not have been executed
      expect(executed).toEqual(["observe"]);
    });
  });
});
