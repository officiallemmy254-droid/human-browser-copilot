// Human Browser Runtime - Local Authentication Gateway & High-Entropy Session Manager (M9)
import * as crypto from "crypto";
import { BrowserError, BrowserErrorCode } from "./contracts/errors.js";

export interface AuthSession {
  sessionId: string;
  token: string;
  agentId: string;
  createdAt: number;
  expiresAt: number;
}

export interface ValidationResult {
  authenticated: boolean;
  agentId?: string;
  sessionId?: string;
  error?: BrowserError;
}

function timingSafeTokenCompare(candidate: string, actual: string): boolean {
  try {
    const candidateBuf = Buffer.from(candidate, "utf8");
    const actualBuf = Buffer.from(actual, "utf8");

    if (candidateBuf.length !== actualBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(candidateBuf, actualBuf);
  } catch (e) {
    return false;
  }
}

class AuthGatewayManager {
  private sessions = new Map<string, AuthSession>(); // token -> AuthSession

  public clear(): void {
    this.sessions.clear();
  }

  public createSession(agentId: string, ttlMs: number = 3600000): AuthSession {
    const token = crypto.randomBytes(32).toString("hex"); // 256 bits of cryptographic entropy
    const sessionId = `sess_${crypto.randomBytes(8).toString("hex")}`;
    const now = Date.now();

    const session: AuthSession = {
      sessionId,
      token,
      agentId,
      createdAt: now,
      expiresAt: now + ttlMs
    };

    this.sessions.set(token, session);
    return session;
  }

  public validateToken(token: string): ValidationResult {
    if (!token || typeof token !== "string" || token.trim().length === 0) {
      return {
        authenticated: false,
        error: new BrowserError(
          BrowserErrorCode.AUTHENTICATION_REQUIRED,
          "Authentication failed: Missing or empty session token."
        )
      };
    }

    // Purge expired sessions
    const now = Date.now();

    // Constant-time search across registered session tokens
    let matchedSession: AuthSession | null = null;

    for (const [registeredToken, session] of this.sessions.entries()) {
      if (timingSafeTokenCompare(token, registeredToken)) {
        matchedSession = session;
        break;
      }
    }

    if (!matchedSession) {
      return {
        authenticated: false,
        error: new BrowserError(
          BrowserErrorCode.AUTHENTICATION_REQUIRED,
          "Authentication failed: Invalid session token provided."
        )
      };
    }

    if (now > matchedSession.expiresAt) {
      this.sessions.delete(matchedSession.token);
      return {
        authenticated: false,
        error: new BrowserError(
          BrowserErrorCode.AUTHENTICATION_REQUIRED,
          `Authentication failed: Session token has expired (Expired at ${new Date(matchedSession.expiresAt).toISOString()}).`
        )
      };
    }

    return {
      authenticated: true,
      agentId: matchedSession.agentId,
      sessionId: matchedSession.sessionId
    };
  }

  public revokeToken(token: string): boolean {
    for (const [registeredToken, session] of this.sessions.entries()) {
      if (timingSafeTokenCompare(token, registeredToken)) {
        this.sessions.delete(registeredToken);
        return true;
      }
    }
    return false;
  }

  public rotateToken(oldToken: string, ttlMs?: number): AuthSession | null {
    const valid = this.validateToken(oldToken);
    if (!valid.authenticated || !valid.agentId) return null;

    this.revokeToken(oldToken);
    return this.createSession(valid.agentId, ttlMs);
  }
}

export const AuthGateway = new AuthGatewayManager();

export function generateSessionToken(agentId: string, ttlMs?: number): AuthSession {
  return AuthGateway.createSession(agentId, ttlMs);
}

export function validateSessionToken(token: string): ValidationResult {
  return AuthGateway.validateToken(token);
}

export function revokeSessionToken(token: string): boolean {
  return AuthGateway.revokeToken(token);
}
