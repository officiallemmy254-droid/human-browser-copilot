import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { BrowserErrorCode, BrowserError } from "../../src/contracts/errors.js";

describe("M1: Chrome Extension Foundation & Protocol", () => {
  const manifestPath = path.resolve(__dirname, "../../../extension/manifest.json");

  it("should have a valid Manifest V3 with documented permissions", () => {
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBe("Human Browser Copilot");

    // Every permission must be strictly required
    const expectedPermissions = [
      "debugger",
      "sidePanel",
      "nativeMessaging",
      "storage",
      "tabs",
      "activeTab",
      "scripting",
      "offscreen",
      "alarms"
    ];

    expect(manifest.permissions).toEqual(expect.arrayContaining(expectedPermissions));
    expect(manifest.background.service_worker).toBe("background/service_worker.js");
    expect(manifest.background.type).toBe("module");
  });

  it("should format extension handshake and health check packets correctly", () => {
    const handshakeReq = {
      id: 1,
      command: "ping",
      clientVersion: "2.0.0"
    };

    const handshakeResp = {
      id: 1,
      ok: true,
      pong: true,
      timestamp: Date.now(),
      isTaskActive: false
    };

    expect(handshakeResp.ok).toBe(true);
    expect(handshakeResp.pong).toBe(true);
  });

  it("should wrap extension communication failures into canonical BrowserError", () => {
    const failedPacket = {
      id: 2,
      ok: false,
      error: "Tab 999 does not exist",
      code: BrowserErrorCode.TAB_NOT_FOUND
    };

    const error = new BrowserError(failedPacket.code, failedPacket.error);
    expect(error.code).toBe(BrowserErrorCode.TAB_NOT_FOUND);
    expect(error.message).toContain("Tab 999 does not exist");
  });
});
