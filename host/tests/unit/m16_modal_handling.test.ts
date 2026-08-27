import { describe, it, expect, beforeEach, vi } from "vitest";
import { BrowserErrorCode } from "../../src/contracts/errors.js";
import { TaskState } from "../../src/contracts/task.js";
import { TaskManager, createTaskContext, transitionTaskState, getTaskContext } from "../../src/task_state_machine.js";
import {
  ModalHandler,
  onNativeDialogOpened,
  onNativeDialogClosed,
  checkModalBlocking,
  handleNativeDialog,
  detectPageChallenge,
  triggerHumanHandoff,
  resolveHumanHandoff
} from "../../src/modal_handler.js";

describe("M16: Human Handoff & Native Modal Handling", () => {
  beforeEach(() => {
    ModalHandler.clear();
    TaskManager.clear();
  });

  describe("Native JavaScript Dialogs (alert, confirm, prompt, beforeunload)", () => {
    it("should register native dialog and return MODAL_BLOCKING error", () => {
      onNativeDialogOpened({
        type: "alert",
        message: "Are you sure you want to leave?",
        tabId: 101,
        timestamp: Date.now()
      });

      expect(ModalHandler.hasActiveDialog(101)).toBe(true);

      const blockingErr = checkModalBlocking(101);
      expect(blockingErr).not.toBeNull();
      expect(blockingErr?.code).toBe(BrowserErrorCode.MODAL_BLOCKING);
      expect(blockingErr?.message).toContain("JavaScript native dialog alert");
      expect(blockingErr?.details?.dialogType).toBe("alert");
      expect(blockingErr?.details?.message).toBe("Are you sure you want to leave?");
      expect(blockingErr?.retryable).toBe(true);
    });

    it("should accept active dialog and trigger dispatcher", async () => {
      const mockDispatcher = vi.fn().mockResolvedValue(undefined);
      ModalHandler.setDialogDispatcher(mockDispatcher);

      onNativeDialogOpened({
        type: "prompt",
        message: "Enter verification code:",
        defaultPrompt: "000000",
        tabId: 102,
        timestamp: Date.now()
      });

      const result = await handleNativeDialog({
        tabId: 102,
        accept: true,
        promptText: "123456"
      });

      expect(result.success).toBe(true);
      expect(mockDispatcher).toHaveBeenCalledWith(102, true, "123456");
      expect(ModalHandler.hasActiveDialog(102)).toBe(false);
      expect(checkModalBlocking(102)).toBeNull();
    });

    it("should dismiss active dialog cleanly", async () => {
      const mockDispatcher = vi.fn().mockResolvedValue(undefined);
      ModalHandler.setDialogDispatcher(mockDispatcher);

      onNativeDialogOpened({
        type: "confirm",
        message: "Do you accept cookies?",
        tabId: 103,
        timestamp: Date.now()
      });

      const result = await handleNativeDialog({
        tabId: 103,
        accept: false
      });

      expect(result.success).toBe(true);
      expect(mockDispatcher).toHaveBeenCalledWith(103, false, undefined);
      expect(ModalHandler.hasActiveDialog(103)).toBe(false);
    });

    it("should return INVALID_STATE error when trying to handle non-existent dialog", async () => {
      const result = await handleNativeDialog({
        tabId: 999,
        accept: true
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(BrowserErrorCode.INVALID_STATE);
    });
  });

  describe("Anti-Bot & CAPTCHA Challenge Detection", () => {
    it("should detect Cloudflare challenge pages with high confidence", () => {
      const result = detectPageChallenge({
        title: "Just a moment...",
        visibleText: "Checking your browser before accessing example.com. Cloudflare Ray ID: 871a629b"
      });

      expect(result.detected).toBe(true);
      expect(result.challengeType).toBe("cloudflare");
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it("should detect Cloudflare Turnstile widget in HTML or selectors", () => {
      const result = detectPageChallenge({
        title: "Sign In",
        html: '<div class="cf-turnstile" data-sitekey="0x4AAAAAA"></div>',
        selectors: [".cf-turnstile"]
      });

      expect(result.detected).toBe(true);
      expect(result.challengeType).toBe("turnstile");
    });

    it("should detect Google reCAPTCHA", () => {
      const result = detectPageChallenge({
        title: "Register",
        html: '<iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe>',
        visibleText: "This site is protected by reCAPTCHA and the Google Privacy Policy"
      });

      expect(result.detected).toBe(true);
      expect(result.challengeType).toBe("recaptcha");
    });

    it("should detect hCaptcha challenge", () => {
      const result = detectPageChallenge({
        html: '<div class="h-captcha" data-sitekey="10000000-ffff-ffff-ffff-000000000001"></div>',
        selectors: [".h-captcha"]
      });

      expect(result.detected).toBe(true);
      expect(result.challengeType).toBe("hcaptcha");
    });

    it("should return detected=false for standard pages", () => {
      const result = detectPageChallenge({
        title: "Dashboard - MyApp",
        visibleText: "Welcome back, John! Here is your quarterly report.",
        html: "<div>Welcome back, John!</div>"
      });

      expect(result.detected).toBe(false);
    });
  });

  describe("Task State Machine Handoff to HUMAN_REQUIRED", () => {
    it("should transition task to HUMAN_REQUIRED state and produce typed error", () => {
      createTaskContext("task_captcha_1");
      transitionTaskState("task_captcha_1", TaskState.IDLE);
      transitionTaskState("task_captcha_1", TaskState.EXECUTING);

      const challenge = detectPageChallenge({
        title: "Attention Required! | Cloudflare",
        visibleText: "Please complete the security check to continue."
      });

      const handoffResult = triggerHumanHandoff("task_captcha_1", challenge);
      expect(handoffResult.success).toBe(true);
      expect(handoffResult.state).toBe(TaskState.HUMAN_REQUIRED);
      expect(handoffResult.error?.code).toBe(BrowserErrorCode.HUMAN_REQUIRED);

      // Verify task in state machine is now in HUMAN_REQUIRED
      expect(getTaskContext("task_captcha_1")?.state).toBe(TaskState.HUMAN_REQUIRED);
    });

    it("should resume task to IDLE once human resolves the challenge", () => {
      createTaskContext("task_captcha_2");
      transitionTaskState("task_captcha_2", TaskState.IDLE);
      transitionTaskState("task_captcha_2", TaskState.EXECUTING);
      triggerHumanHandoff("task_captcha_2", { reason: "SMS 2FA verification required" });

      expect(getTaskContext("task_captcha_2")?.state).toBe(TaskState.HUMAN_REQUIRED);

      // Human enters code and completes 2FA
      const resolveResult = resolveHumanHandoff("task_captcha_2", { resolved: true, returnState: TaskState.IDLE });
      expect(resolveResult.success).toBe(true);
      expect(resolveResult.state).toBe(TaskState.IDLE);
      expect(getTaskContext("task_captcha_2")?.state).toBe(TaskState.IDLE);
    });

    it("should transition to PAUSED if human handoff is dismissed/unresolved", () => {
      createTaskContext("task_captcha_3");
      transitionTaskState("task_captcha_3", TaskState.IDLE);
      transitionTaskState("task_captcha_3", TaskState.EXECUTING);
      triggerHumanHandoff("task_captcha_3", { reason: "User intervention requested" });

      const resolveResult = resolveHumanHandoff("task_captcha_3", { resolved: false });
      expect(resolveResult.success).toBe(true);
      expect(resolveResult.state).toBe(TaskState.PAUSED);
      expect(getTaskContext("task_captcha_3")?.state).toBe(TaskState.PAUSED);
    });
  });
});
