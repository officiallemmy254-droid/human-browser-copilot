import { describe, it, expect } from "vitest";
import { BrowserErrorCode } from "../../src/contracts/errors.js";
import {
  parseCanonicalOrigin,
  isOriginAuthorized,
  isPrivateNetworkOrigin,
  validateNavigationOrigin
} from "../../src/origin_authorizer.js";

describe("M8: Origin Authorization & Strict URL Isolation", () => {
  it("should normalize URLs into canonical scheme://host[:port] format", () => {
    expect(parseCanonicalOrigin("https://Example.COM/path/sub?q=1#hash")).toBe("https://example.com");
    expect(parseCanonicalOrigin("http://localhost:8080/app")).toBe("http://localhost:8080");
    expect(parseCanonicalOrigin("https://example.com:443/")).toBe("https://example.com");
    expect(parseCanonicalOrigin("http://example.com:80/")).toBe("http://example.com");
  });

  it("should strictly authorize exact origin matches", () => {
    const allowlist = ["https://app.example.com"];
    expect(isOriginAuthorized("https://app.example.com/dashboard", allowlist)).toBe(true);
    expect(isOriginAuthorized("http://app.example.com", allowlist)).toBe(false); // Scheme mismatch
    expect(isOriginAuthorized("https://app.example.com:8443", allowlist)).toBe(false); // Port mismatch
  });

  it("should strictly reject substring, prefix, and suffix spoofing attacks", () => {
    const allowlist = ["https://bank.com"];

    expect(isOriginAuthorized("https://attacker-bank.com", allowlist)).toBe(false);
    expect(isOriginAuthorized("https://bank.com.attacker.com", allowlist)).toBe(false);
    expect(isOriginAuthorized("https://evilbank.com", allowlist)).toBe(false);
    expect(isOriginAuthorized("https://bank.com@evil.com", allowlist)).toBe(false);
  });

  it("should support explicit wildcard subdomain matching securely", () => {
    const allowlist = ["https://*.corp.example.com"];

    expect(isOriginAuthorized("https://api.corp.example.com", allowlist)).toBe(true);
    expect(isOriginAuthorized("https://staging.corp.example.com", allowlist)).toBe(true);
    expect(isOriginAuthorized("https://corp.example.com", allowlist)).toBe(true);

    // Reject spoofs
    expect(isOriginAuthorized("https://corp.example.com.attacker.com", allowlist)).toBe(false);
    expect(isOriginAuthorized("https://evil-corp.example.com", allowlist)).toBe(false);
  });

  it("should detect and block private RFC1918 subnets and cloud metadata endpoints by default", () => {
    expect(isPrivateNetworkOrigin("http://127.0.0.1:8080")).toBe(true);
    expect(isPrivateNetworkOrigin("http://localhost:3000")).toBe(true);
    expect(isPrivateNetworkOrigin("http://169.254.169.254/latest/meta-data")).toBe(true);
    expect(isPrivateNetworkOrigin("http://192.168.1.1")).toBe(true);
    expect(isPrivateNetworkOrigin("http://10.0.0.5")).toBe(true);
    expect(isPrivateNetworkOrigin("http://172.16.0.1")).toBe(true);

    expect(isPrivateNetworkOrigin("https://google.com")).toBe(false);
  });

  it("should return ORIGIN_NOT_ALLOWED error for unauthorized navigation destinations", () => {
    const allowlist = ["https://safe.example.com"];
    const validation = validateNavigationOrigin("https://untrusted.com/page", allowlist);

    expect(validation.allowed).toBe(false);
    expect(validation.error?.code).toBe(BrowserErrorCode.ORIGIN_NOT_ALLOWED);
    expect(validation.error?.message).toContain("Origin \"https://untrusted.com\" is not authorized");
  });
});
