// Human Browser Runtime - Canonical Origin Authorizer & Network Boundary Enforcement (M8)
import { BrowserError, BrowserErrorCode } from "./contracts/errors.js";

export interface OriginAuthConfig {
  blockPrivateNetworks?: boolean; // Default true
  allowLocalhost?: boolean;       // Default false
}

/**
 * Normalizes any URL into canonical scheme://host[:port]
 */
export function parseCanonicalOrigin(urlOrOrigin: string): string {
  try {
    const raw = urlOrOrigin.includes("://") ? urlOrOrigin : `https://${urlOrOrigin}`;
    const parsed = new URL(raw);
    const protocol = parsed.protocol.toLowerCase();
    const hostname = parsed.hostname.toLowerCase();
    const port = parsed.port;

    // Omit default ports
    if ((protocol === "http:" && port === "80") || (protocol === "https:" && port === "443") || !port) {
      return `${protocol}//${hostname}`;
    }

    return `${protocol}//${hostname}:${port}`;
  } catch (e) {
    return "about:blank";
  }
}

/**
 * Detects private RFC 1918 subnets, loopbacks, and cloud metadata endpoints
 */
export function isPrivateNetworkOrigin(urlOrOrigin: string): boolean {
  const origin = parseCanonicalOrigin(urlOrOrigin);
  let hostname = "";
  try {
    hostname = new URL(origin).hostname.toLowerCase();
  } catch (e) {
    return false;
  }

  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]") {
    return true;
  }

  // IPv4 Private Blocks & Link-Local Cloud Metadata
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true; // AWS / GCP / Azure Instance Metadata

  return false;
}

/**
 * Evaluates whether an origin is authorized against an allowlist, preventing substring spoofing
 */
export function isOriginAuthorized(
  urlOrOrigin: string,
  allowlist: string[],
  config: OriginAuthConfig = { blockPrivateNetworks: true, allowLocalhost: false }
): boolean {
  const targetOrigin = parseCanonicalOrigin(urlOrOrigin);
  if (targetOrigin === "about:blank") return false;

  // Private Network Protection
  const isPrivate = isPrivateNetworkOrigin(targetOrigin);
  if (isPrivate) {
    if (config.allowLocalhost && (targetOrigin.includes("localhost") || targetOrigin.includes("127.0.0.1"))) {
      // Localhost explicitly allowed
    } else if (config.blockPrivateNetworks !== false) {
      return false;
    }
  }

  // If allowlist is empty or includes wildcard "*", allow all non-private
  if (!allowlist || allowlist.length === 0) return true;
  if (allowlist.includes("*")) return true;

  for (const allowed of allowlist) {
    if (allowed === "*") return true;

    // Wildcard Subdomain Pattern: https://*.example.com
    if (allowed.includes("://*.")) {
      const parts = allowed.split("://*.");
      const scheme = parts[0].toLowerCase();
      const baseDomain = parts[1].toLowerCase();

      try {
        const targetUrl = new URL(targetOrigin);
        const targetScheme = targetUrl.protocol.replace(":", "").toLowerCase();
        const targetHost = targetUrl.hostname.toLowerCase();
        const targetPort = targetUrl.port;

        if (targetScheme === scheme && !targetPort) {
          if (targetHost === baseDomain || targetHost.endsWith(`.${baseDomain}`)) {
            return true;
          }
        }
      } catch (e) {}
      continue;
    }

    // Exact Canonical Match
    const canonicalAllowed = parseCanonicalOrigin(allowed);
    if (canonicalAllowed === targetOrigin) {
      return true;
    }
  }

  return false;
}

/**
 * Validates navigation target and returns typed error if disallowed
 */
export function validateNavigationOrigin(
  url: string,
  allowlist: string[],
  config?: OriginAuthConfig
): { allowed: boolean; canonicalOrigin: string; error?: BrowserError } {
  const canonicalOrigin = parseCanonicalOrigin(url);
  const isAllowed = isOriginAuthorized(url, allowlist, config);

  if (!isAllowed) {
    return {
      allowed: false,
      canonicalOrigin,
      error: new BrowserError(
        BrowserErrorCode.ORIGIN_NOT_ALLOWED,
        `Navigation blocked: Origin "${canonicalOrigin}" is not authorized by the origin allowlist policy.`,
        { targetUrl: url, canonicalOrigin, allowlist }
      )
    };
  }

  return {
    allowed: true,
    canonicalOrigin
  };
}
