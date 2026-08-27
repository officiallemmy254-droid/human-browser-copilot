import { describe, it, expect } from "vitest";
import { BrowserError, BrowserErrorCode } from "../../src/contracts/errors.js";
import {
  sanitizeString,
  sanitizeSensitiveData,
  sanitizeError,
  sanitizeHeaders,
  maskAuthTokens,
  maskPasswords,
  maskCookies,
  maskCreditCards,
  maskInternalPaths,
  SensitiveDataFilter
} from "../../src/sensitive_data_filter.js";

describe("M20: Sensitive Data Handling & Credential Sanitization", () => {
  describe("Auth Token & Bearer Redaction", () => {
    it("should strip Bearer tokens from authorization strings", () => {
      const input = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-ID";
      const sanitized = maskAuthTokens(input);
      expect(sanitized).toBe("Authorization: Bearer [REDACTED]");
      expect(sanitized).not.toContain("eyJhbGciOi");
    });

    it("should strip tokens in URL query strings", () => {
      const url = "https://api.example.com/v1/data?token=secret_1234567890abcdef&format=json";
      const sanitized = maskAuthTokens(url);
      expect(sanitized).toBe("https://api.example.com/v1/data?token=[REDACTED]&format=json");
    });

    it("should mask apiKey and secret headers", () => {
      const str = "api_key: sk_live_51ABC1234567890123456";
      const sanitized = maskAuthTokens(str);
      expect(sanitized).toBe("api_key: [REDACTED]");
    });
  });

  describe("Password Masking", () => {
    it("should mask password in key-value string format", () => {
      const str = "Login failed for user 'admin' with password=SuperSecretPassword123!";
      const sanitized = maskPasswords(str);
      expect(sanitized).toContain("password=[REDACTED]");
      expect(sanitized).not.toContain("SuperSecretPassword123!");
    });

    it("should mask quoted password strings", () => {
      const str = 'config: { password: "my_secret_pass_999" }';
      const sanitized = maskPasswords(str);
      expect(sanitized).toBe('config: { password: [REDACTED] }');
    });
  });

  describe("Cookie Masking", () => {
    it("should redact Cookie headers and session tokens", () => {
      const cookieStr = "Cookie: session_id=sess_abc123456; auth=token_789; theme=dark";
      const sanitized = maskCookies(cookieStr);
      expect(sanitized).toContain("Cookie: [REDACTED]");
      expect(sanitized).not.toContain("sess_abc123456");
    });

    it("should redact session parameters in key-value pairs", () => {
      const str = "user request with sessionid=session_xyz987654";
      const sanitized = maskCookies(str);
      expect(sanitized).toBe("user request with sessionid=[REDACTED]");
    });
  });

  describe("Credit Card Number Masking", () => {
    it("should mask Visa, MasterCard, and Amex credit card numbers", () => {
      const visa = "Payment with 4532 0150 1234 5678 completed";
      expect(maskCreditCards(visa)).toBe("Payment with [REDACTED_CREDIT_CARD] completed");

      const mcDashed = "Card number: 5105-1051-0510-5100";
      expect(maskCreditCards(mcDashed)).toBe("Card number: [REDACTED_CREDIT_CARD]");

      const amex = "Amex card: 3782 822463 10005";
      expect(maskCreditCards(amex)).toBe("Amex card: [REDACTED_CREDIT_CARD]");
    });
  });

  describe("Internal Path Redaction", () => {
    it("should mask Windows user directory paths", () => {
      const winPath = "File not found at C:\\Users\\Administrator\\AppData\\Local\\config.json";
      const sanitized = maskInternalPaths(winPath);
      expect(sanitized).toContain("C:\\Users\\[REDACTED]\\AppData\\Local\\config.json");
      expect(sanitized).not.toContain("Administrator");
    });

    it("should mask Unix home directory paths", () => {
      const unixPath = "Saved output to /home/developer/secrets/key.pem";
      const sanitized = maskInternalPaths(unixPath);
      expect(sanitized).toContain("/home/[REDACTED]/secrets/key.pem");
      expect(sanitized).not.toContain("developer");
    });
  });

  describe("Deep JSON Structure & Object Sanitization", () => {
    it("should recursively redact sensitive keys in nested objects and arrays", () => {
      const payload = {
        user: "john_doe",
        credentials: {
          password: "plainTextPassword123",
          apiKey: "sk-proj-1234567890abcdef",
          tokens: ["normal_tag", "bearer secret-token-abcdef123456"]
        },
        payment: {
          creditCard: "4111-1111-1111-1111",
          billingAddress: {
            city: "San Francisco",
            cvv: "123"
          }
        },
        logs: [
          "Failed connection to C:\\Users\\john\\database.sqlite",
          "Header received: Cookie: session=abcdef123456"
        ]
      };

      const sanitized = sanitizeSensitiveData(payload);

      expect(sanitized.credentials.password).toBe("[REDACTED]");
      expect(sanitized.credentials.apiKey).toBe("[REDACTED]");
      expect(sanitized.credentials.tokens[1]).toBe("bearer [REDACTED]");
      expect(sanitized.payment.creditCard).toBe("[REDACTED]");
      expect(sanitized.payment.billingAddress.cvv).toBe("[REDACTED]");
      expect(sanitized.payment.billingAddress.city).toBe("San Francisco");
      expect(sanitized.logs[0]).toContain("C:\\Users\\[REDACTED]\\database.sqlite");
      expect(sanitized.logs[1]).toContain("Cookie: [REDACTED]");
    });

    it("should safely handle circular references without infinite loops or stack overflow", () => {
      const circularObj: any = { name: "Root Node", password: "mypassword" };
      circularObj.self = circularObj;
      circularObj.child = { parent: circularObj, secret: "classified" };

      const sanitized = sanitizeSensitiveData(circularObj);

      expect(sanitized.password).toBe("[REDACTED]");
      expect(sanitized.self).toBe("[CIRCULAR_REFERENCE]");
      expect(sanitized.child.secret).toBe("[REDACTED]");
      expect(sanitized.child.parent).toBe("[CIRCULAR_REFERENCE]");
    });
  });

  describe("Error Sanitization", () => {
    it("should sanitize BrowserError messages, stack traces, and details", () => {
      const browserErr = new BrowserError(
        BrowserErrorCode.AUTHENTICATION_REQUIRED,
        "Failed auth with bearer secret-token-xyz1234567890",
        {
          attemptedUrl: "https://example.com/api?token=secret123456789",
          clientSecret: "top_secret_key",
          localPath: "C:\\Users\\admin\\host.log"
        }
      );

      const sanitized = sanitizeError(browserErr);

      expect(sanitized.message).toBe("Failed auth with bearer [REDACTED]");
      expect(sanitized.details.attemptedUrl).toBe("https://example.com/api?token=[REDACTED]");
      expect(sanitized.details.clientSecret).toBe("[REDACTED]");
      expect(sanitized.details.localPath).toContain("C:\\Users\\[REDACTED]\\host.log");
    });
  });

  describe("HTTP Header Sanitization", () => {
    it("should redact sensitive HTTP headers", () => {
      const headers = {
        "content-type": "application/json",
        "authorization": "Bearer eyJhbGciOi...",
        "cookie": "sid=12345",
        "x-api-key": "secret-key-abc",
        "user-agent": "Mozilla/5.0"
      };

      const sanitized = sanitizeHeaders(headers);

      expect(sanitized["content-type"]).toBe("application/json");
      expect(sanitized["authorization"]).toBe("[REDACTED]");
      expect(sanitized["cookie"]).toBe("[REDACTED]");
      expect(sanitized["x-api-key"]).toBe("[REDACTED]");
      expect(sanitized["user-agent"]).toBe("Mozilla/5.0");
    });
  });
});
