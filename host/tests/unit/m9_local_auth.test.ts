import { describe, it, expect, beforeEach } from "vitest";
import { BrowserErrorCode } from "../../src/contracts/errors.js";
import {
  AuthGateway,
  generateSessionToken,
  validateSessionToken,
  revokeSessionToken
} from "../../src/auth_gateway.js";

describe("M9: Local Authentication & High-Entropy Session Gateway", () => {
  beforeEach(() => {
    AuthGateway.clear();
  });

  it("should generate high-entropy 256-bit session tokens", () => {
    const session = generateSessionToken("agent-codex");
    expect(session.token).toMatch(/^[a-f0-9]{64}$/); // 32 bytes hex = 64 chars
    expect(session.agentId).toBe("agent-codex");
    expect(session.expiresAt).toBeGreaterThan(Date.now());
  });

  it("should validate legitimate session token using constant-time comparison", () => {
    const session = generateSessionToken("agent-claude");
    const validation = validateSessionToken(session.token);

    expect(validation.authenticated).toBe(true);
    expect(validation.agentId).toBe("agent-claude");
  });

  it("should reject unauthorized, invalid, or forged tokens with AUTHENTICATION_REQUIRED", () => {
    generateSessionToken("agent-valid");

    const invalidRes = validateSessionToken("invalid-forged-token-1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef");
    expect(invalidRes.authenticated).toBe(false);
    expect(invalidRes.error?.code).toBe(BrowserErrorCode.AUTHENTICATION_REQUIRED);
    expect(invalidRes.error?.message).toContain("Authentication failed");

    const emptyRes = validateSessionToken("");
    expect(emptyRes.authenticated).toBe(false);
    expect(emptyRes.error?.code).toBe(BrowserErrorCode.AUTHENTICATION_REQUIRED);
  });

  it("should reject expired session tokens with AUTHENTICATION_REQUIRED", async () => {
    // Generate token with 50ms TTL
    const session = generateSessionToken("agent-ephemeral", 50);

    // Immediate validation succeeds
    expect(validateSessionToken(session.token).authenticated).toBe(true);

    // Wait for expiration
    await new Promise(r => setTimeout(r, 60));

    const expiredRes = validateSessionToken(session.token);
    expect(expiredRes.authenticated).toBe(false);
    expect(expiredRes.error?.code).toBe(BrowserErrorCode.AUTHENTICATION_REQUIRED);
    expect(expiredRes.error?.message).toContain("Session token has expired");
  });

  it("should revoke tokens on logout / task completion", () => {
    const session = generateSessionToken("agent-task");
    expect(validateSessionToken(session.token).authenticated).toBe(true);

    revokeSessionToken(session.token);

    const revokedRes = validateSessionToken(session.token);
    expect(revokedRes.authenticated).toBe(false);
    expect(revokedRes.error?.code).toBe(BrowserErrorCode.AUTHENTICATION_REQUIRED);
  });
});
