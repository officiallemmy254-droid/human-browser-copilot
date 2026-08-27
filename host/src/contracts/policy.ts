// Canonical Permission Tiers & Origin Authorization Rules (M7, M8)

export const PermissionTier = {
  READ: "READ",
  INTERACT: "INTERACT",
  EXTERNAL_SIDE_EFFECT: "EXTERNAL_SIDE_EFFECT",
  HIGH_RISK: "HIGH_RISK"
} as const;

export type PermissionTierType = typeof PermissionTier[keyof typeof PermissionTier];

export const PolicyDecision = {
  ALLOW: "ALLOW",
  PROMPT: "PROMPT",
  DENY: "DENY"
} as const;

export type PolicyDecisionType = typeof PolicyDecision[keyof typeof PolicyDecision];

/**
 * Extracts and canonicalizes the origin in scheme://host:port format.
 * Returns null if invalid.
 */
export function parseCanonicalOrigin(urlStr: string): string | null {
  try {
    const parsed = new URL(urlStr);
    if (!parsed.protocol.startsWith("http") && !parsed.protocol.startsWith("ws")) {
      return null;
    }
    return parsed.origin; // e.g. "https://example.com" or "http://localhost:3000"
  } catch (e) {
    return null;
  }
}

/**
 * Validates whether an origin is authorized against an exact allowed list.
 * Explicitly rejects substring spoofing (e.g. "evil-example.com" vs "example.com").
 */
export function isOriginAuthorized(targetUrl: string, allowedOrigins: string[]): boolean {
  const targetOrigin = parseCanonicalOrigin(targetUrl);
  if (!targetOrigin) return false;

  for (const allowed of allowedOrigins) {
    const allowedCanonical = parseCanonicalOrigin(allowed);
    if (allowedCanonical && allowedCanonical.toLowerCase() === targetOrigin.toLowerCase()) {
      return true;
    }
  }
  return false;
}

const HIGH_RISK_KEYWORDS = ["delete", "remove", "checkout", "buy", "purchase", "transfer", "pay", "grant", "authorize", "password", "revoke"];
const EXTERNAL_SIDE_EFFECT_KEYWORDS = ["submit", "send", "publish", "post", "confirm", "order", "save"];

/**
 * Rigid runtime classification of action into permission tiers.
 * The AI agent CANNOT self-declare or override this tier.
 */
export function classifyActionTier(actionType: string, params: Record<string, any> = {}): PermissionTierType {
  const type = actionType.toLowerCase();

  // Automatic reclassification: screenshot with save_to_disk is state-changing (INTERACT)
  if (type === "screenshot" && params.save_to_disk === true) {
    return PermissionTier.INTERACT;
  }

  // READ Tier
  if (["observe", "readpagetext", "find", "screenshot", "listtabs", "gettaskstatus"].includes(type)) {
    return PermissionTier.READ;
  }

  // Check element text or description for high-risk / side-effect indicators
  const label = (params.elementText || params.label || params.target || "").toLowerCase();
  for (const kw of HIGH_RISK_KEYWORDS) {
    if (label.includes(kw) || type.includes(kw)) {
      return PermissionTier.HIGH_RISK;
    }
  }

  for (const kw of EXTERNAL_SIDE_EFFECT_KEYWORDS) {
    if (label.includes(kw) || type.includes(kw)) {
      return PermissionTier.EXTERNAL_SIDE_EFFECT;
    }
  }

  // INTERACT Tier (Default for standard DOM mutations)
  if (["click", "type", "clear", "keypress", "scroll", "navigate", "opentab", "switchtab", "closetab", "wait"].includes(type)) {
    return PermissionTier.INTERACT;
  }

  return PermissionTier.INTERACT;
}
