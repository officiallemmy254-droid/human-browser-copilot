import { describe, it, expect, beforeEach } from "vitest";
import * as path from "path";
import * as os from "os";
import { BrowserErrorCode } from "../../src/contracts/errors.js";
import { PermissionTier } from "../../src/contracts/policy.js";
import {
  ScreenshotGuard,
  classifyScreenshotTier,
  validateScreenshotPath,
  DEFAULT_JPEG_QUALITY
} from "../../src/screenshot_guard.js";

describe("M21: Screenshot Security & Sandbox Guard", () => {
  const sandboxDir = path.resolve(os.tmpdir(), "test-screenshots");

  beforeEach(() => {
    ScreenshotGuard.resetSandboxRoots();
    ScreenshotGuard.addSandboxRoot(sandboxDir);
  });

  describe("Permission Tier Promotion", () => {
    it("should classify in-memory screenshot as READ tier", () => {
      const tier1 = classifyScreenshotTier({});
      expect(tier1).toBe(PermissionTier.READ);

      const tier2 = classifyScreenshotTier({ saveToDisk: false });
      expect(tier2).toBe(PermissionTier.READ);
    });

    it("should promote screenshot with saveToDisk / filePath to INTERACT tier", () => {
      const tier1 = classifyScreenshotTier({ saveToDisk: true });
      expect(tier1).toBe(PermissionTier.INTERACT);

      const tier2 = classifyScreenshotTier({ filePath: path.join(sandboxDir, "capture.jpg") });
      expect(tier2).toBe(PermissionTier.INTERACT);

      const tier3 = classifyScreenshotTier({ save_to_disk: true });
      expect(tier3).toBe(PermissionTier.INTERACT);
    });
  });

  describe("Sandboxed Path Validation", () => {
    it("should allow valid paths inside approved sandbox root", () => {
      const target = path.join(sandboxDir, "subfolder", "page.jpg");
      const validation = validateScreenshotPath(target, [sandboxDir]);

      expect(validation.valid).toBe(true);
      expect(validation.resolvedPath).toBe(path.resolve(target));
    });

    it("should reject path traversal attempts outside sandbox", () => {
      const traversal = path.join(sandboxDir, "..", "..", "system_file.jpg");
      const validation = validateScreenshotPath(traversal, [sandboxDir]);

      expect(validation.valid).toBe(false);
      expect(validation.error?.code).toBe(BrowserErrorCode.POLICY_DENIED);
      expect(validation.error?.message).toContain("outside approved sandboxed directories");
    });

    it("should reject absolute system paths outside sandbox", () => {
      const systemPath = process.platform === "win32" ? "C:\\Windows\\System32\\bad.jpg" : "/etc/bad.jpg";
      const validation = validateScreenshotPath(systemPath, [sandboxDir]);

      expect(validation.valid).toBe(false);
      expect(validation.error?.code).toBe(BrowserErrorCode.POLICY_DENIED);
    });

    it("should reject dangerous and executable file extensions", () => {
      const exeTarget = path.join(sandboxDir, "payload.exe");
      const exeValidation = validateScreenshotPath(exeTarget, [sandboxDir]);
      expect(exeValidation.valid).toBe(false);
      expect(exeValidation.error?.message).toContain("Forbidden file extension");

      const shTarget = path.join(sandboxDir, "script.sh");
      const shValidation = validateScreenshotPath(shTarget, [sandboxDir]);
      expect(shValidation.valid).toBe(false);

      const batTarget = path.join(sandboxDir, "run.bat");
      const batValidation = validateScreenshotPath(batTarget, [sandboxDir]);
      expect(batValidation.valid).toBe(false);
    });

    it("should reject non-jpeg extensions", () => {
      const pngTarget = path.join(sandboxDir, "image.png");
      const pngValidation = validateScreenshotPath(pngTarget, [sandboxDir]);

      expect(pngValidation.valid).toBe(false);
      expect(pngValidation.error?.message).toContain("must be saved as .jpg or .jpeg");
    });
  });

  describe("JPEG Format & Quality Enforcement", () => {
    it("should default format to jpeg and quality to 80", () => {
      const result = ScreenshotGuard.validateRequest({
        saveToDisk: true,
        filePath: path.join(sandboxDir, "out.jpeg")
      });

      expect(result.valid).toBe(true);
      expect(result.sanitizedOptions?.format).toBe("jpeg");
      expect(result.sanitizedOptions?.quality).toBe(DEFAULT_JPEG_QUALITY);
    });

    it("should accept valid quality within 1-100", () => {
      const result = ScreenshotGuard.validateRequest({
        saveToDisk: true,
        filePath: path.join(sandboxDir, "out.jpg"),
        quality: 95
      });

      expect(result.valid).toBe(true);
      expect(result.sanitizedOptions?.quality).toBe(95);
    });

    it("should reject invalid quality under 1 or above 100", () => {
      const lowResult = ScreenshotGuard.validateRequest({ quality: 0 });
      expect(lowResult.valid).toBe(false);
      expect(lowResult.error?.code).toBe(BrowserErrorCode.POLICY_DENIED);

      const highResult = ScreenshotGuard.validateRequest({ quality: 150 });
      expect(highResult.valid).toBe(false);
      expect(highResult.error?.code).toBe(BrowserErrorCode.POLICY_DENIED);
    });

    it("should reject unapproved image formats (e.g. gif, webp)", () => {
      const result = ScreenshotGuard.validateRequest({ format: "webp" });
      expect(result.valid).toBe(false);
      expect(result.error?.message).toContain("Only JPEG format is supported");
    });
  });

  describe("Guard Execution Helper", () => {
    it("should return sanitized options for in-memory captures without disk path", () => {
      const options = ScreenshotGuard.guardScreenshot({ fullPage: true, quality: 75 });
      expect(options.saveToDisk).toBe(false);
      expect(options.fullPage).toBe(true);
      expect(options.quality).toBe(75);
      expect(options.format).toBe("jpeg");
    });

    it("should throw BrowserError when validation fails in guardScreenshot()", () => {
      expect(() => {
        ScreenshotGuard.guardScreenshot({
          saveToDisk: true,
          filePath: path.join(sandboxDir, "bad.sh")
        });
      }).toThrowError();
    });
  });
});
