// Human Browser Runtime - Screenshot Security & Sandbox Guard (M21)
import * as path from "path";
import * as os from "os";
import { z } from "zod";
import { BrowserError, BrowserErrorCode } from "./contracts/errors.js";
import { PermissionTier, PermissionTierType } from "./contracts/policy.js";

export const ALLOWED_SCREENSHOT_EXTENSIONS = [".jpg", ".jpeg"] as const;
export const DEFAULT_JPEG_QUALITY = 80;
export const MIN_JPEG_QUALITY = 1;
export const MAX_JPEG_QUALITY = 100;

const DEFAULT_SANDBOX_DIRS = [
  path.resolve(os.homedir(), ".human-browser", "screenshots"),
  path.resolve(os.tmpdir(), "human-browser", "screenshots")
];

export const ScreenshotOptionsSchema = z.object({
  saveToDisk: z.boolean().default(false),
  filePath: z.string().optional(),
  format: z.enum(["jpeg", "jpg"]).default("jpeg"),
  quality: z.number().int().min(1).max(100).default(DEFAULT_JPEG_QUALITY),
  fullPage: z.boolean().default(false),
  clip: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number()
  }).optional()
});

export type ScreenshotOptions = z.infer<typeof ScreenshotOptionsSchema>;

export interface RawScreenshotParams {
  saveToDisk?: boolean;
  save_to_disk?: boolean;
  filePath?: string;
  file_path?: string;
  format?: string;
  quality?: number;
  fullPage?: boolean;
  clip?: { x: number; y: number; width: number; height: number };
  [key: string]: any;
}

export interface ScreenshotValidationResult {
  valid: boolean;
  tier: PermissionTierType;
  sanitizedOptions?: ScreenshotOptions;
  resolvedPath?: string;
  error?: BrowserError;
}

export function classifyScreenshotTier(params: RawScreenshotParams = {}): PermissionTierType {
  const isDiskWrite = Boolean(
    params.saveToDisk ||
    params.save_to_disk ||
    params.filePath ||
    params.file_path
  );

  return isDiskWrite ? PermissionTier.INTERACT : PermissionTier.READ;
}

function isPathInsideSandbox(targetPath: string, sandboxRoots: string[]): boolean {
  const normalizedTarget = path.resolve(targetPath);
  const isWindows = process.platform === "win32";

  for (const root of sandboxRoots) {
    const normalizedRoot = path.resolve(root);

    const target = isWindows ? normalizedTarget.toLowerCase() : normalizedTarget;
    const base = isWindows ? normalizedRoot.toLowerCase() : normalizedRoot;

    if (target === base || target.startsWith(base + path.sep)) {
      return true;
    }
  }

  return false;
}

const DANGEROUS_EXTENSIONS = new Set([
  ".exe", ".bat", ".cmd", ".sh", ".ps1", ".vbs", ".dll", ".so", ".dylib",
  ".js", ".mjs", ".cjs", ".ts", ".py", ".rb", ".php", ".phtml", ".html",
  ".htm", ".svg", ".xml", ".hta", ".scr", ".com", ".msi", ".jar"
]);

export function validateScreenshotPath(
  requestedPath: string,
  sandboxRoots: string[] = DEFAULT_SANDBOX_DIRS
): { valid: boolean; resolvedPath?: string; error?: BrowserError } {
  if (!requestedPath || typeof requestedPath !== "string") {
    return {
      valid: false,
      error: new BrowserError(
        BrowserErrorCode.POLICY_DENIED,
        "Screenshot file path must be a non-empty string."
      )
    };
  }

  // Prevent null bytes
  if (requestedPath.indexOf("\0") !== -1) {
    return {
      valid: false,
      error: new BrowserError(
        BrowserErrorCode.POLICY_DENIED,
        "Screenshot path contains forbidden null bytes."
      )
    };
  }

  const resolved = path.resolve(requestedPath);
  const ext = path.extname(resolved).toLowerCase();

  // Check dangerous file extensions
  if (DANGEROUS_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      error: new BrowserError(
        BrowserErrorCode.POLICY_DENIED,
        `Forbidden file extension "${ext}" for screenshot disk write. Only JPEG is permitted.`
      )
    };
  }

  // Check allowed extensions
  if (!ALLOWED_SCREENSHOT_EXTENSIONS.includes(ext as any)) {
    return {
      valid: false,
      error: new BrowserError(
        BrowserErrorCode.POLICY_DENIED,
        `Invalid screenshot extension "${ext}". Screenshots must be saved as .jpg or .jpeg.`
      )
    };
  }

  // Check sandbox containment
  if (!isPathInsideSandbox(resolved, sandboxRoots)) {
    return {
      valid: false,
      error: new BrowserError(
        BrowserErrorCode.POLICY_DENIED,
        `Screenshot path "${requestedPath}" is outside approved sandboxed directories. Path traversal is strictly prohibited.`
      )
    };
  }

  return { valid: true, resolvedPath: resolved };
}

export class ScreenshotGuardManager {
  private sandboxRoots: string[] = [...DEFAULT_SANDBOX_DIRS];

  public addSandboxRoot(dirPath: string): void {
    const resolved = path.resolve(dirPath);
    if (!this.sandboxRoots.includes(resolved)) {
      this.sandboxRoots.push(resolved);
    }
  }

  public removeSandboxRoot(dirPath: string): void {
    const resolved = path.resolve(dirPath);
    this.sandboxRoots = this.sandboxRoots.filter(r => r !== resolved);
  }

  public getSandboxRoots(): string[] {
    return [...this.sandboxRoots];
  }

  public resetSandboxRoots(): void {
    this.sandboxRoots = [...DEFAULT_SANDBOX_DIRS];
  }

  public validateRequest(params: RawScreenshotParams = {}): ScreenshotValidationResult {
    const tier = classifyScreenshotTier(params);
    const isDiskWrite = tier === PermissionTier.INTERACT;

    let format: "jpeg" | "jpg" = "jpeg";
    const rawFormat = (params.format || "jpeg").toLowerCase();
    if (rawFormat === "jpg" || rawFormat === "jpeg") {
      format = rawFormat;
    } else {
      return {
        valid: false,
        tier,
        error: new BrowserError(
          BrowserErrorCode.POLICY_DENIED,
          `Invalid screenshot format "${params.format}". Only JPEG format is supported.`
        )
      };
    }

    let quality = params.quality !== undefined ? params.quality : DEFAULT_JPEG_QUALITY;
    if (typeof quality !== "number" || isNaN(quality) || quality < MIN_JPEG_QUALITY || quality > MAX_JPEG_QUALITY) {
      return {
        valid: false,
        tier,
        error: new BrowserError(
          BrowserErrorCode.POLICY_DENIED,
          `Invalid JPEG quality ${quality}. Quality must be an integer between 1 and 100.`
        )
      };
    }
    quality = Math.round(quality);

    let resolvedPath: string | undefined;
    const requestedPath = params.filePath || params.file_path;

    if (isDiskWrite) {
      const targetPath = requestedPath || path.join(this.sandboxRoots[0], `screenshot_${Date.now()}.jpg`);
      const pathValidation = validateScreenshotPath(targetPath, this.sandboxRoots);

      if (!pathValidation.valid || !pathValidation.resolvedPath) {
        return {
          valid: false,
          tier,
          error: pathValidation.error
        };
      }

      resolvedPath = pathValidation.resolvedPath;
    }

    const sanitizedOptions: ScreenshotOptions = {
      saveToDisk: isDiskWrite,
      filePath: resolvedPath,
      format,
      quality,
      fullPage: Boolean(params.fullPage),
      clip: params.clip
    };

    return {
      valid: true,
      tier,
      sanitizedOptions,
      resolvedPath
    };
  }

  public guardScreenshot(params: RawScreenshotParams = {}): ScreenshotOptions {
    const result = this.validateRequest(params);
    if (!result.valid || !result.sanitizedOptions) {
      throw result.error || new BrowserError(BrowserErrorCode.POLICY_DENIED, "Screenshot validation failed.");
    }
    return result.sanitizedOptions;
  }
}

export const ScreenshotGuard = new ScreenshotGuardManager();
