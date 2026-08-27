// Human Browser Runtime - Human Handoff & Native Modal Handling Engine (M16)
import { BrowserError, BrowserErrorCode, BrowserErrorCodeType } from "./contracts/errors.js";
import { TaskState, TaskStateType } from "./contracts/task.js";
import { TaskManager, transitionTaskState, getTaskContext } from "./task_state_machine.js";
import { recordActionAudit } from "./audit_logger.js";
import { PermissionTier } from "./contracts/policy.js";

export type NativeDialogType = "alert" | "confirm" | "prompt" | "beforeunload";

export interface NativeDialogInfo {
  type: NativeDialogType;
  message: string;
  url?: string;
  defaultPrompt?: string;
  tabId?: number;
  timestamp: number;
}

export type ChallengeType = "cloudflare" | "turnstile" | "recaptcha" | "hcaptcha" | "datadome" | "arkose" | "generic_captcha";

export interface ChallengeDetectionInput {
  title?: string;
  visibleText?: string;
  html?: string;
  url?: string;
  statusCode?: number;
  selectors?: string[];
  interactiveElements?: Array<{ id?: string; text?: string; role?: string; label?: string }>;
}

export interface ChallengeDetectionResult {
  detected: boolean;
  challengeType?: ChallengeType;
  confidence: number;
  reason?: string;
  details?: Record<string, any>;
}

export interface HumanHandoffResult {
  success: boolean;
  taskId: string;
  state: TaskStateType;
  error?: BrowserError;
  challengeInfo?: ChallengeDetectionResult;
}

export interface HumanHandoffResolveResult {
  success: boolean;
  taskId: string;
  state: TaskStateType;
  error?: BrowserError;
}

export type DialogDispatchHandler = (tabId: number | undefined, accept: boolean, promptText?: string) => Promise<void>;

class ModalHandlerManager {
  private activeDialogs = new Map<number | string, NativeDialogInfo>();
  private dialogDispatcher?: DialogDispatchHandler;
  private listeners: Array<(dialog: NativeDialogInfo) => void> = [];

  public clear(): void {
    this.activeDialogs.clear();
    this.dialogDispatcher = undefined;
  }

  public setDialogDispatcher(dispatcher: DialogDispatchHandler): void {
    this.dialogDispatcher = dispatcher;
  }

  private getDialogKey(tabId?: number): number | string {
    return tabId !== undefined ? tabId : "global";
  }

  /**
   * Called when Chrome/CDP emits Page.javascriptDialogOpening
   */
  public onDialogOpened(dialog: NativeDialogInfo): void {
    const key = this.getDialogKey(dialog.tabId);
    this.activeDialogs.set(key, dialog);

    for (const listener of this.listeners) {
      try {
        listener(dialog);
      } catch (e) {}
    }
  }

  /**
   * Called when Chrome/CDP emits Page.javascriptDialogClosed
   */
  public onDialogClosed(tabId?: number): void {
    const key = this.getDialogKey(tabId);
    this.activeDialogs.delete(key);
    if (tabId === undefined) {
      this.activeDialogs.clear();
    }
  }

  public hasActiveDialog(tabId?: number): boolean {
    const key = this.getDialogKey(tabId);
    return this.activeDialogs.has(key) || this.activeDialogs.has("global");
  }

  public getActiveDialog(tabId?: number): NativeDialogInfo | null {
    const key = this.getDialogKey(tabId);
    return this.activeDialogs.get(key) || this.activeDialogs.get("global") || null;
  }

  /**
   * Generates a typed MODAL_BLOCKING BrowserError if an unhandled dialog is open
   */
  public checkModalBlocking(tabId?: number): BrowserError | null {
    const dialog = this.getActiveDialog(tabId);
    if (!dialog) return null;

    return new BrowserError(
      BrowserErrorCode.MODAL_BLOCKING,
      `JavaScript native dialog ${dialog.type}("${dialog.message}") is blocking page interaction. Handle or dismiss dialog before proceeding.`,
      {
        dialogType: dialog.type,
        message: dialog.message,
        defaultPrompt: dialog.defaultPrompt,
        tabId: dialog.tabId,
        openedAt: dialog.timestamp
      },
      true // MODAL_BLOCKING is retryable after user/agent handles the modal
    );
  }

  /**
   * Resolves/dismisses active JavaScript native dialog
   */
  public async handleDialog(params: {
    tabId?: number;
    accept: boolean;
    promptText?: string;
  }): Promise<{ success: boolean; dialog?: NativeDialogInfo; error?: BrowserError }> {
    const dialog = this.getActiveDialog(params.tabId);
    if (!dialog) {
      return {
        success: false,
        error: new BrowserError(
          BrowserErrorCode.INVALID_STATE,
          `No active JavaScript dialog found on tab ${params.tabId ?? "global"} to handle.`,
          { tabId: params.tabId }
        )
      };
    }

    try {
      if (this.dialogDispatcher) {
        await this.dialogDispatcher(params.tabId, params.accept, params.promptText);
      }
      this.onDialogClosed(params.tabId);
      return { success: true, dialog };
    } catch (err: any) {
      return {
        success: false,
        error: new BrowserError(
          BrowserErrorCode.UNKNOWN_ERROR,
          `Failed to handle native dialog: ${err.message}`,
          { tabId: params.tabId, dialog }
        )
      };
    }
  }

  public async acceptDialog(tabId?: number, promptText?: string) {
    return this.handleDialog({ tabId, accept: true, promptText });
  }

  public async dismissDialog(tabId?: number) {
    return this.handleDialog({ tabId, accept: false });
  }

  public subscribe(listener: (dialog: NativeDialogInfo) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  /**
   * Deterministically inspects page snapshot, title, HTML, and status code for anti-bot & CAPTCHA challenges
   */
  public detectChallenge(input: ChallengeDetectionInput): ChallengeDetectionResult {
    const title = (input.title || "").toLowerCase();
    const visibleText = (input.visibleText || "").toLowerCase();
    const html = (input.html || "").toLowerCase();
    const url = (input.url || "").toLowerCase();
    const selectors = (input.selectors || []).map(s => s.toLowerCase());

    // 1. Cloudflare Turnstile / DDoS Protection
    if (
      title.includes("just a moment") ||
      title.includes("attention required! | cloudflare") ||
      visibleText.includes("checking your browser before accessing") ||
      visibleText.includes("verify you are human") ||
      visibleText.includes("cloudflare ray id") ||
      html.includes("cf-turnstile") ||
      html.includes("cf-challenge") ||
      html.includes("cf-browser-verification") ||
      selectors.some(s => s.includes("cf-turnstile") || s.includes("cf-challenge"))
    ) {
      return {
        detected: true,
        challengeType: html.includes("cf-turnstile") || selectors.some(s => s.includes("turnstile")) ? "turnstile" : "cloudflare",
        confidence: 0.99,
        reason: "Cloudflare anti-bot verification or Turnstile challenge detected",
        details: { title: input.title, url: input.url }
      };
    }

    // 2. Google reCAPTCHA
    if (
      html.includes("g-recaptcha") ||
      html.includes("recaptcha/api.js") ||
      html.includes("google.com/recaptcha") ||
      visibleText.includes("protected by recaptcha") ||
      selectors.some(s => s.includes("g-recaptcha") || s.includes("recaptcha"))
    ) {
      return {
        detected: true,
        challengeType: "recaptcha",
        confidence: 0.95,
        reason: "Google reCAPTCHA challenge detected on page",
        details: { url: input.url }
      };
    }

    // 3. hCaptcha
    if (
      html.includes("hcaptcha.com") ||
      html.includes("h-captcha") ||
      visibleText.includes("hcaptcha") ||
      selectors.some(s => s.includes("hcaptcha") || s.includes("h-captcha"))
    ) {
      return {
        detected: true,
        challengeType: "hcaptcha",
        confidence: 0.95,
        reason: "hCaptcha verification challenge detected",
        details: { url: input.url }
      };
    }

    // 4. Arkose Labs / FunCaptcha
    if (
      html.includes("arkoselabs") ||
      html.includes("funcaptcha") ||
      visibleText.includes("funcaptcha")
    ) {
      return {
        detected: true,
        challengeType: "arkose",
        confidence: 0.95,
        reason: "Arkose Labs / FunCaptcha challenge detected",
        details: { url: input.url }
      };
    }

    // 5. DataDome / PerimeterX
    if (
      html.includes("datadome") ||
      html.includes("perimeterx") ||
      html.includes("px-captcha") ||
      visibleText.includes("datadome")
    ) {
      return {
        detected: true,
        challengeType: "datadome",
        confidence: 0.9,
        reason: "DataDome / PerimeterX anti-bot challenge detected",
        details: { url: input.url }
      };
    }

    // 6. Generic CAPTCHA keywords in interactive elements or text
    if (
      visibleText.includes("please complete the security check") ||
      visibleText.includes("enter the characters you see") ||
      visibleText.includes("security verification") ||
      (input.interactiveElements && input.interactiveElements.some(el => (el.text || el.label || "").toLowerCase().includes("captcha")))
    ) {
      return {
        detected: true,
        challengeType: "generic_captcha",
        confidence: 0.85,
        reason: "Security challenge / CAPTCHA text detected on page",
        details: { url: input.url }
      };
    }

    return {
      detected: false,
      confidence: 0
    };
  }

  /**
   * Transitions task state machine to HUMAN_REQUIRED and returns typed error
   */
  public triggerHumanHandoff(
    taskId: string,
    challengeInfo: ChallengeDetectionResult | { reason: string; details?: Record<string, any> }
  ): HumanHandoffResult {
    const reason = "reason" in challengeInfo && challengeInfo.reason
      ? challengeInfo.reason
      : "Automated challenge detected requiring human intervention";

    const task = getTaskContext(taskId);
    if (!task) {
      return {
        success: false,
        taskId,
        state: TaskState.ERROR,
        error: new BrowserError(
          BrowserErrorCode.INVALID_STATE,
          `Task "${taskId}" not found when triggering human handoff.`,
          { taskId }
        )
      };
    }

    // Transition task to HUMAN_REQUIRED
    const transitionResult = transitionTaskState(taskId, TaskState.HUMAN_REQUIRED, reason);
    if (!transitionResult.success) {
      return {
        success: false,
        taskId,
        state: task.state,
        error: transitionResult.error
      };
    }

    const handoffError = new BrowserError(
      BrowserErrorCode.HUMAN_REQUIRED,
      `Action stopped: Human handoff required on task "${taskId}". Reason: ${reason}`,
      { taskId, reason, challenge: challengeInfo },
      false
    );

    // Audit Log
    recordActionAudit({
      taskId,
      actionId: `action_handoff_${Date.now()}`,
      origin: "runtime://human-handoff",
      actionType: "human_handoff_triggered",
      policyTier: PermissionTier.READ,
      policyDecision: "ALLOW",
      approvalState: "PENDING",
      executionResult: { reason, challengeInfo },
      error: handoffError.toJSON()
    });

    return {
      success: true,
      taskId,
      state: TaskState.HUMAN_REQUIRED,
      error: handoffError,
      challengeInfo: "detected" in challengeInfo ? challengeInfo : undefined
    };
  }

  /**
   * Resumes task execution after human finishes solving CAPTCHA/2FA
   */
  public resolveHumanHandoff(
    taskId: string,
    outcome: { resolved: boolean; returnState?: TaskStateType } = { resolved: true }
  ): HumanHandoffResolveResult {
    const task = getTaskContext(taskId);
    if (!task) {
      return {
        success: false,
        taskId,
        state: TaskState.ERROR,
        error: new BrowserError(
          BrowserErrorCode.INVALID_STATE,
          `Task "${taskId}" not found when resolving human handoff.`,
          { taskId }
        )
      };
    }

    if (task.state !== TaskState.HUMAN_REQUIRED) {
      return {
        success: false,
        taskId,
        state: task.state,
        error: new BrowserError(
          BrowserErrorCode.INVALID_STATE,
          `Cannot resolve human handoff: Task "${taskId}" is in state "${task.state}", expected "HUMAN_REQUIRED".`,
          { taskId, currentState: task.state }
        )
      };
    }

    const nextState = outcome.resolved ? (outcome.returnState || TaskState.IDLE) : TaskState.PAUSED;
    const transitionResult = transitionTaskState(taskId, nextState, outcome.resolved ? "Human handoff resolved successfully" : "Human handoff dismissed");

    if (!transitionResult.success) {
      return {
        success: false,
        taskId,
        state: task.state,
        error: transitionResult.error
      };
    }

    recordActionAudit({
      taskId,
      actionId: `action_handoff_res_${Date.now()}`,
      origin: "runtime://human-handoff",
      actionType: "human_handoff_resolved",
      policyTier: PermissionTier.READ,
      policyDecision: "ALLOW",
      executionResult: { resolved: outcome.resolved, newState: nextState }
    });

    return {
      success: true,
      taskId,
      state: nextState
    };
  }
}

export const ModalHandler = new ModalHandlerManager();

export function onNativeDialogOpened(dialog: NativeDialogInfo): void {
  ModalHandler.onDialogOpened(dialog);
}

export function onNativeDialogClosed(tabId?: number): void {
  ModalHandler.onDialogClosed(tabId);
}

export function checkModalBlocking(tabId?: number): BrowserError | null {
  return ModalHandler.checkModalBlocking(tabId);
}

export function handleNativeDialog(params: { tabId?: number; accept: boolean; promptText?: string }) {
  return ModalHandler.handleDialog(params);
}

export function detectPageChallenge(input: ChallengeDetectionInput): ChallengeDetectionResult {
  return ModalHandler.detectChallenge(input);
}

export function triggerHumanHandoff(taskId: string, challengeInfo: ChallengeDetectionResult | { reason: string; details?: Record<string, any> }) {
  return ModalHandler.triggerHumanHandoff(taskId, challengeInfo);
}

export function resolveHumanHandoff(taskId: string, outcome?: { resolved: boolean; returnState?: TaskStateType }) {
  return ModalHandler.resolveHumanHandoff(taskId, outcome);
}
