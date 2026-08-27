// Human Browser Runtime - Sensitive Data Handling & Credential Sanitizer (M20)
import { BrowserError, BrowserErrorData } from "./contracts/errors.js";

export interface SensitiveFilterOptions {
  redactCreditCards?: boolean;
  redactAuthTokens?: boolean;
  redactPasswords?: boolean;
  redactCookies?: boolean;
  redactInternalPaths?: boolean;
  additionalSensitiveKeys?: string[];
  replacementString?: string;
}

const DEFAULT_SENSITIVE_KEYS = new Set([
  "password",
  "passwd",
  "pwd",
  "pass",
  "secret",
  "clientsecret",
  "client_secret",
  "privatekey",
  "private_key",
  "accesstoken",
  "access_token",
  "authtoken",
  "auth_token",
  "apikey",
  "api_key",
  "authheader",
  "auth_header",
  "authorization",
  "cookie",
  "cookies",
  "set-cookie",
  "creditcard",
  "credit_card",
  "cardnumber",
  "card_number",
  "cvv",
  "cvc",
  "ssn",
  "pin",
  "sessionid",
  "session_id",
  "token"
]);

// Credit Card Patterns: 13-19 digits with optional spaces or hyphens
const CREDIT_CARD_REGEX = /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|2(?:2[2-9][0-9]{2}|[3-6][0-9]{3}|7[01][0-9]{2}|720[0-9])[0-9]{10}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b|\b(?:\d{4}[ -]){3}\d{4}\b|\b\d{4}[ -]\d{6}[ -]\d{5}\b/g;

// Auth Tokens & Bearer Patterns
const AUTH_BEARER_REGEX = /(bearer\s+)[a-zA-Z0-9_\-\.\:\=\+\/]{10,}/gi;
const AUTH_HEADER_REGEX = /((?:authorization|auth_token|token|api_key|apikey|secret)\s*[:=]\s*)[a-zA-Z0-9_\-\.\:\=\+\/]{10,}/gi;
const URL_TOKEN_REGEX = /([?&](?:token|access_token|apikey|api_key|auth_token|secret_key|client_secret)=)[^&\s]+/gi;

// Password Patterns in plain strings
const PASSWORD_STRING_REGEX = /((?:password|passwd|pwd)\s*[:=]\s*)(["'][^"']+["']|[^\s,;]+)/gi;

// Cookie Patterns
const COOKIE_HEADER_REGEX = /((?:cookie|set-cookie)\s*[:=]\s*)(["'][^"']+["']|[^\r\n]+)/gi;
const COOKIE_SESSION_REGEX = /((?:session|sessionid|phpsessid|jsessionid)\s*=\s*)([^\s,;]+)/gi;

// Internal Filesystem Paths (Windows & Unix home directories)
const WINDOWS_USER_PATH_REGEX = /([a-zA-Z]:[\\/](?:Users|Documents and Settings)[\\/])([^\\/\r\n"']+)/gi;
const UNIX_USER_PATH_REGEX = /((?:^|\s|["'])\/(?:home|Users)\/)([^/\s\r\n"']+)/gi;

export function maskAuthTokens(text: string): string {
  if (!text) return "";
  return text
    .replace(AUTH_BEARER_REGEX, "$1[REDACTED]")
    .replace(AUTH_HEADER_REGEX, "$1[REDACTED]")
    .replace(URL_TOKEN_REGEX, "$1[REDACTED]");
}

export function maskPasswords(text: string): string {
  if (!text) return "";
  return text.replace(PASSWORD_STRING_REGEX, "$1[REDACTED]");
}

export function maskCookies(text: string): string {
  if (!text) return "";
  return text
    .replace(COOKIE_HEADER_REGEX, "$1[REDACTED]")
    .replace(COOKIE_SESSION_REGEX, "$1[REDACTED]");
}

export function maskCreditCards(text: string): string {
  if (!text) return "";
  return text.replace(CREDIT_CARD_REGEX, "[REDACTED_CREDIT_CARD]");
}

export function maskInternalPaths(text: string): string {
  if (!text) return "";
  return text
    .replace(WINDOWS_USER_PATH_REGEX, "$1[REDACTED]")
    .replace(UNIX_USER_PATH_REGEX, "$1[REDACTED]");
}

export function sanitizeString(text: string, options: SensitiveFilterOptions = {}): string {
  if (!text || typeof text !== "string") return text;

  let result = text;

  if (options.redactAuthTokens ?? true) {
    result = maskAuthTokens(result);
  }

  if (options.redactPasswords ?? true) {
    result = maskPasswords(result);
  }

  if (options.redactCookies ?? true) {
    result = maskCookies(result);
  }

  if (options.redactCreditCards ?? true) {
    result = maskCreditCards(result);
  }

  if (options.redactInternalPaths ?? true) {
    result = maskInternalPaths(result);
  }

  return result;
}

export function isSensitiveKey(key: string, customKeys?: string[]): boolean {
  const lower = key.toLowerCase();
  const normalized = lower.replace(/[^a-z0-9]/g, "");

  if (DEFAULT_SENSITIVE_KEYS.has(normalized) || DEFAULT_SENSITIVE_KEYS.has(lower)) {
    return true;
  }

  // Check common prefixes like x- (e.g. x-api-key -> xapikey)
  if (normalized.startsWith("x") && DEFAULT_SENSITIVE_KEYS.has(normalized.slice(1))) {
    return true;
  }

  const sensitiveSubstrings = [
    "password",
    "passwd",
    "secret",
    "apikey",
    "api_key",
    "privatekey",
    "private_key",
    "accesstoken",
    "access_token",
    "authtoken",
    "auth_token",
    "authheader",
    "creditcard",
    "cardnumber",
    "sessionid"
  ];

  for (const sub of sensitiveSubstrings) {
    if (lower.includes(sub) || normalized.includes(sub.replace(/[^a-z0-9]/g, ""))) {
      return true;
    }
  }

  if (customKeys) {
    for (const custom of customKeys) {
      if (lower === custom.toLowerCase() || normalized === custom.toLowerCase().replace(/[^a-z0-9]/g, "")) {
        return true;
      }
    }
  }

  return false;
}

export function sanitizeSensitiveData<T>(
  data: T,
  options: SensitiveFilterOptions = {},
  visited: WeakSet<object> = new WeakSet()
): T {
  if (data === null || data === undefined) return data;

  // Primitives
  if (typeof data === "string") {
    return sanitizeString(data, options) as unknown as T;
  }
  if (typeof data !== "object") {
    return data;
  }

  // Circular reference detection
  if (visited.has(data as object)) {
    return "[CIRCULAR_REFERENCE]" as unknown as T;
  }
  visited.add(data as object);

  // Arrays
  if (Array.isArray(data)) {
    return data.map(item => sanitizeSensitiveData(item, options, visited)) as unknown as T;
  }

  // Handle Error instances specially
  if (data instanceof Error) {
    const sanitizedError: Record<string, any> = {
      name: data.name,
      message: sanitizeString(data.message, options)
    };

    if (data.stack) {
      sanitizedError.stack = sanitizeString(data.stack, options);
    }

    if ((data as any).code) {
      sanitizedError.code = (data as any).code;
    }

    if ((data as any).details) {
      sanitizedError.details = sanitizeSensitiveData((data as any).details, options, visited);
    }

    if (data instanceof BrowserError) {
      sanitizedError.retryable = data.retryable;
    }

    return sanitizedError as unknown as T;
  }

  // Plain Objects
  const result: Record<string, any> = {};
  const entries = Object.entries(data as Record<string, any>);

  for (const [key, value] of entries) {
    if (isSensitiveKey(key, options.additionalSensitiveKeys)) {
      result[key] = options.replacementString || "[REDACTED]";
    } else {
      result[key] = sanitizeSensitiveData(value, options, visited);
    }
  }

  return result as T;
}

export function sanitizeError(err: unknown, options: SensitiveFilterOptions = {}): BrowserErrorData | Record<string, any> {
  if (err instanceof BrowserError) {
    return {
      code: err.code,
      message: sanitizeString(err.message, options),
      details: err.details ? sanitizeSensitiveData(err.details, options) : undefined,
      retryable: err.retryable
    };
  }

  if (err instanceof Error) {
    return {
      code: (err as any).code || "UNKNOWN_ERROR",
      message: sanitizeString(err.message, options),
      details: (err as any).details ? sanitizeSensitiveData((err as any).details, options) : undefined,
      stack: err.stack ? sanitizeString(err.stack, options) : undefined
    };
  }

  if (typeof err === "string") {
    return {
      code: "UNKNOWN_ERROR",
      message: sanitizeString(err, options)
    };
  }

  return sanitizeSensitiveData(err as any, options);
}

export function sanitizeHeaders(
  headers: Record<string, string | string[] | undefined>,
  options: SensitiveFilterOptions = {}
): Record<string, string | string[] | undefined> {
  if (!headers || typeof headers !== "object") return headers;

  const sanitized: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (isSensitiveKey(key, options.additionalSensitiveKeys)) {
      sanitized[key] = options.replacementString || "[REDACTED]";
    } else if (typeof value === "string") {
      sanitized[key] = sanitizeString(value, options);
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map(v => (typeof v === "string" ? sanitizeString(v, options) : v));
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export class SensitiveDataFilterManager {
  private defaultOptions: SensitiveFilterOptions = {};

  public setDefaultOptions(options: SensitiveFilterOptions): void {
    this.defaultOptions = { ...this.defaultOptions, ...options };
  }

  public sanitize<T>(data: T, options?: SensitiveFilterOptions): T {
    return sanitizeSensitiveData(data, { ...this.defaultOptions, ...options });
  }

  public sanitizeString(text: string, options?: SensitiveFilterOptions): string {
    return sanitizeString(text, { ...this.defaultOptions, ...options });
  }

  public sanitizeError(err: unknown, options?: SensitiveFilterOptions): any {
    return sanitizeError(err, { ...this.defaultOptions, ...options });
  }

  public sanitizeHeaders(headers: Record<string, any>, options?: SensitiveFilterOptions): Record<string, any> {
    return sanitizeHeaders(headers, { ...this.defaultOptions, ...options });
  }
}

export const SensitiveDataFilter = new SensitiveDataFilterManager();
