// Human Browser Runtime - Policy Engine & Permission Tier Evaluator (M7, M8)
import { BrowserError, BrowserErrorCode } from "./contracts/errors.js";
import { PermissionTier, PermissionTierType, classifyActionTier } from "./contracts/policy.js";

export type PolicyDecision = "ALLOW" | "PROMPT" | "DENY";

export interface PolicyRule {
  originPattern?: string; // e.g. "*", "https://example.com", "https://*.bank.com"
  actionType?: string;    // e.g. "*", "click", "evaluate_js"
  minTier?: PermissionTierType;
  decision: PolicyDecision;
  reason?: string;
}

export interface PolicyEvaluationContext {
  origin: string;
  actionType: string;
  targetText?: string;
  targetSelector?: string;
  tier?: PermissionTierType;
}

export interface PolicyEvaluationResult {
  decision: PolicyDecision;
  tier: PermissionTierType;
  reason?: string;
}

export interface PolicyEnforcementResult {
  allowed: boolean;
  requiresApproval: boolean;
  tier: PermissionTierType;
  reason?: string;
  error?: BrowserError;
}

const HIGH_RISK_FINANCIAL = [
  "pay", "purchase", "buy now", "order now", "checkout", "transfer", "credit card", "wire money", "deposit", "withdraw"
];

const HIGH_RISK_DESTRUCTIVE = [
  "delete", "wipe", "destroy", "drop database", "terminate account", "remove forever", "permanently delete"
];

const HIGH_RISK_SECURITY = [
  "authorize", "oauth", "grant access", "change password", "reset password", "api key", "regenerate secret", "security settings"
];

const SIDE_EFFECT_KEYWORDS = [
  "submit", "publish", "send", "post", "create", "invite", "save changes", "apply"
];

function detectKeywordEscalation(text?: string): { escalated: boolean; tier?: PermissionTierType; reason?: string } {
  if (!text) return { escalated: false };

  const lower = text.toLowerCase();

  for (const kw of HIGH_RISK_FINANCIAL) {
    if (lower.includes(kw)) {
      return { escalated: true, tier: PermissionTier.HIGH_RISK, reason: `Action involves financial or sensitive action ("${kw}")` };
    }
  }

  for (const kw of HIGH_RISK_DESTRUCTIVE) {
    if (lower.includes(kw)) {
      return { escalated: true, tier: PermissionTier.HIGH_RISK, reason: `Action involves destructive operation ("${kw}")` };
    }
  }

  for (const kw of HIGH_RISK_SECURITY) {
    if (lower.includes(kw)) {
      return { escalated: true, tier: PermissionTier.HIGH_RISK, reason: `Action involves security or credential modification ("${kw}")` };
    }
  }

  for (const kw of SIDE_EFFECT_KEYWORDS) {
    if (lower.includes(kw)) {
      return { escalated: true, tier: PermissionTier.EXTERNAL_SIDE_EFFECT, reason: `Action produces external side effect ("${kw}")` };
    }
  }

  return { escalated: false };
}

function matchesPattern(value: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern.includes("*")) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`).test(value);
  }
  return value === pattern;
}

class PolicyEngineManager {
  private rules: PolicyRule[] = [];
  private strictMode = false;

  constructor() {
    this.resetToDefaults();
  }

  public resetToDefaults(): void {
    this.rules = [];
    this.strictMode = false;
  }

  public setStrictMode(enabled: boolean): void {
    this.strictMode = enabled;
  }

  public addRule(rule: PolicyRule): void {
    this.rules.unshift(rule); // Prepend so latest rules take precedence
  }

  public evaluatePolicy(context: PolicyEvaluationContext): PolicyEvaluationResult {
    // 1. Determine baseline tier
    let tier = context.tier || classifyActionTier(context.actionType, { targetText: context.targetText, targetSelector: context.targetSelector });

    // 2. Check for keyword escalation
    const escalation = detectKeywordEscalation(context.targetText);
    let escalationReason = escalation.reason;
    if (escalation.escalated && escalation.tier) {
      if (tier === PermissionTier.READ || tier === PermissionTier.INTERACT) {
        tier = escalation.tier;
      } else if (tier === PermissionTier.EXTERNAL_SIDE_EFFECT && escalation.tier === PermissionTier.HIGH_RISK) {
        tier = PermissionTier.HIGH_RISK;
      }
    }

    // 3. Match against custom rules
    for (const rule of this.rules) {
      const matchOrigin = !rule.originPattern || matchesPattern(context.origin, rule.originPattern);
      const matchAction = !rule.actionType || matchesPattern(context.actionType, rule.actionType);

      if (matchOrigin && matchAction) {
        return {
          decision: rule.decision,
          tier,
          reason: rule.reason || `Custom policy rule matched (${rule.originPattern || "*"} -> ${rule.actionType || "*"})`
        };
      }
    }

    // 4. Default tier-based policy decisions
    if (tier === PermissionTier.READ) {
      return { decision: "ALLOW", tier };
    }

    if (tier === PermissionTier.INTERACT) {
      return { decision: "ALLOW", tier };
    }

    if (tier === PermissionTier.EXTERNAL_SIDE_EFFECT) {
      return {
        decision: "PROMPT",
        tier,
        reason: escalationReason || "Action produces external side effect and requires human confirmation"
      };
    }

    if (tier === PermissionTier.HIGH_RISK) {
      if (this.strictMode) {
        return {
          decision: "DENY",
          tier,
          reason: escalationReason || "HIGH_RISK action is prohibited in strict policy mode"
        };
      }
      return {
        decision: "PROMPT",
        tier,
        reason: escalationReason || "HIGH_RISK action requires human approval"
      };
    }

    return { decision: "ALLOW", tier };
  }

  public enforcePolicy(context: PolicyEvaluationContext): PolicyEnforcementResult {
    const evalResult = this.evaluatePolicy(context);

    if (evalResult.decision === "DENY") {
      return {
        allowed: false,
        requiresApproval: false,
        tier: evalResult.tier,
        reason: evalResult.reason,
        error: new BrowserError(
          BrowserErrorCode.POLICY_DENIED,
          evalResult.reason || `Action "${context.actionType}" on origin "${context.origin}" was denied by security policy.`,
          { origin: context.origin, actionType: context.actionType, tier: evalResult.tier }
        )
      };
    }

    if (evalResult.decision === "PROMPT") {
      return {
        allowed: false,
        requiresApproval: true,
        tier: evalResult.tier,
        reason: evalResult.reason
      };
    }

    return {
      allowed: true,
      requiresApproval: false,
      tier: evalResult.tier
    };
  }
}

export const PolicyEngine = new PolicyEngineManager();

export function evaluatePolicy(context: PolicyEvaluationContext): PolicyEvaluationResult {
  return PolicyEngine.evaluatePolicy(context);
}

export function enforcePolicy(context: PolicyEvaluationContext): PolicyEnforcementResult {
  return PolicyEngine.enforcePolicy(context);
}
