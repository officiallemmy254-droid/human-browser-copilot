// Human Browser Copilot - Security Guard & 3-Tier Approval Coordinator

export const SENSITIVE_BUTTON_REGEX = /(pay|buy|purchase|place order|checkout|confirm payment|delete account|remove|transfer funds|authorize|grant permissions|sign in with google|approve transaction)/i;

export const PROTECTED_DOMAIN_KEYWORDS = [
  "bank",
  "chase.com",
  "bankofamerica.com",
  "wellsfargo.com",
  "paypal.com",
  "binance.com",
  "coinbase.com",
  "1password.com",
  "bitwarden.com",
  "lastpass.com"
];

let pendingApprovals = new Map();
let approvalIdCounter = 1;

export function evaluateActionSecurity(actionType, params = {}, currentUrl = "") {
  // Check Domain Protection
  for (const domain of PROTECTED_DOMAIN_KEYWORDS) {
    if (currentUrl.toLowerCase().includes(domain)) {
      return {
        tier: 3,
        requiresApproval: true,
        reason: `Domain "${domain}" is in the Protected Domain Shield list`
      };
    }
  }

  // Tier 1: Safe Read-Only
  if (["inspect_dom", "take_snapshot", "read_page", "scroll", "hover"].includes(actionType)) {
    return { tier: 1, requiresApproval: false, reason: "Read-only inspection action" };
  }

  // Tier 3: Sensitive Inputs & Form Fields
  if (actionType === "type") {
    const selector = (params.selector || "").toLowerCase();
    const text = params.text || "";
    if (selector.includes("password") || selector.includes("cvv") || selector.includes("card") || selector.includes("ssn")) {
      return {
        tier: 3,
        requiresApproval: true,
        reason: `Typing into sensitive credential/financial field "${params.selector}"`
      };
    }
  }

  // Tier 3: Sensitive Buttons & Clicks
  if (actionType === "click") {
    const text = params.elementText || params.selector || "";
    if (SENSITIVE_BUTTON_REGEX.test(text)) {
      return {
        tier: 3,
        requiresApproval: true,
        reason: `Clicking sensitive state-changing action button: "${text}"`
      };
    }
  }

  // Tier 2: Routine Action
  return { tier: 2, requiresApproval: false, reason: "Routine interaction" };
}

export function createApprovalRequest(actionType, params, reason, onResolved) {
  const approvalId = "req_" + (approvalIdCounter++);
  const request = {
    id: approvalId,
    actionType,
    params,
    reason,
    timestamp: Date.now(),
    status: "pending",
    onResolved
  };

  pendingApprovals.set(approvalId, request);

  // Broadcast to Side Panel & Extension views
  chrome.runtime.sendMessage({
    type: "APPROVAL_REQUESTED",
    request: {
      id: approvalId,
      actionType,
      params,
      reason,
      timestamp: request.timestamp
    }
  }).catch(() => {});

  return approvalId;
}

export function resolveApproval(approvalId, approved, userEdits = null) {
  const req = pendingApprovals.get(approvalId);
  if (!req) return false;

  req.status = approved ? "approved" : "rejected";
  pendingApprovals.delete(approvalId);

  // Broadcast resolution
  chrome.runtime.sendMessage({
    type: "APPROVAL_RESOLVED",
    approvalId,
    approved,
    userEdits
  }).catch(() => {});

  if (req.onResolved) {
    req.onResolved({ approved, userEdits });
  }
  return true;
}

export function getPendingApprovals() {
  return Array.from(pendingApprovals.values()).map(r => ({
    id: r.id,
    actionType: r.actionType,
    params: r.params,
    reason: r.reason,
    timestamp: r.timestamp
  }));
}
