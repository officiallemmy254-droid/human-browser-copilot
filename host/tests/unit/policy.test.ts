import { describe, it, expect } from "vitest";
import { parseCanonicalOrigin, isOriginAuthorized, classifyActionTier, PermissionTier } from "../../src/contracts/policy.js";

describe("M7 & M8: Policy Engine & Origin Authorization", () => {
  it("should canonicalize valid http/https URLs into scheme://host:port", () => {
    expect(parseCanonicalOrigin("https://example.com/path?query=1")).toBe("https://example.com");
    expect(parseCanonicalOrigin("http://localhost:8080/app")).toBe("http://localhost:8080");
    expect(parseCanonicalOrigin("invalid-url")).toBeNull();
    expect(parseCanonicalOrigin("javascript:alert(1)")).toBeNull();
  });

  it("should strictly authorize exact origins and reject substring spoofing", () => {
    const allowed = ["https://example.com", "http://localhost:3000"];

    expect(isOriginAuthorized("https://example.com/dashboard", allowed)).toBe(true);
    expect(isOriginAuthorized("http://localhost:3000/api", allowed)).toBe(true);

    // Substring attacks must be DENIED
    expect(isOriginAuthorized("https://evil-example.com", allowed)).toBe(false);
    expect(isOriginAuthorized("https://example.com.attacker.com", allowed)).toBe(false);
    expect(isOriginAuthorized("http://localhost:3001", allowed)).toBe(false);
  });

  it("should correctly classify READ tier actions", () => {
    expect(classifyActionTier("observe")).toBe(PermissionTier.READ);
    expect(classifyActionTier("readPageText")).toBe(PermissionTier.READ);
    expect(classifyActionTier("screenshot")).toBe(PermissionTier.READ);
  });

  it("should promote screenshot with save_to_disk=true to INTERACT tier", () => {
    expect(classifyActionTier("screenshot", { save_to_disk: true })).toBe(PermissionTier.INTERACT);
  });

  it("should classify standard routine clicks as INTERACT tier", () => {
    expect(classifyActionTier("click", { elementText: "Next Page" })).toBe(PermissionTier.INTERACT);
    expect(classifyActionTier("type", { text: "Search query" })).toBe(PermissionTier.INTERACT);
  });

  it("should classify state-changing buttons as EXTERNAL_SIDE_EFFECT tier", () => {
    expect(classifyActionTier("click", { elementText: "Submit Form" })).toBe(PermissionTier.EXTERNAL_SIDE_EFFECT);
    expect(classifyActionTier("click", { elementText: "Send Message" })).toBe(PermissionTier.EXTERNAL_SIDE_EFFECT);
  });

  it("should classify irreversible/financial buttons as HIGH_RISK tier", () => {
    expect(classifyActionTier("click", { elementText: "Delete Account" })).toBe(PermissionTier.HIGH_RISK);
    expect(classifyActionTier("click", { elementText: "Confirm Purchase ($99)" })).toBe(PermissionTier.HIGH_RISK);
    expect(classifyActionTier("click", { elementText: "Authorize Transfer" })).toBe(PermissionTier.HIGH_RISK);
  });
});
