// Human Browser Runtime - Two-Phase Action Verification Engine (M11)
import { BrowserError, BrowserErrorCode } from "./contracts/errors.js";

export type VerificationStatus = "VERIFIED" | "FAILED" | "SKIPPED";

export interface VerificationResult {
  verified: boolean;
  status: VerificationStatus;
  actualValue?: any;
  error?: BrowserError;
}

export type DOMScriptEvaluator = (script: string) => Promise<any>;

/**
 * Verifies that an input element actually contains the typed text post-dispatch
 */
export async function verifyTypeAction(
  selector: string,
  expectedText: string,
  evaluator: DOMScriptEvaluator
): Promise<VerificationResult> {
  try {
    const script = `
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return "";
        return el.value !== undefined ? el.value : (el.innerText || el.textContent || "");
      })()
    `;

    const actual = await evaluator(script);
    const actualStr = String(actual || "").trim();
    const expectedStr = expectedText.trim();

    if (actualStr.includes(expectedStr) || actualStr === expectedStr) {
      return {
        verified: true,
        status: "VERIFIED",
        actualValue: actualStr
      };
    }

    return {
      verified: false,
      status: "FAILED",
      actualValue: actualStr,
      error: new BrowserError(
        BrowserErrorCode.VERIFICATION_FAILED,
        `Verification failed for type action on "${selector}". Expected "${expectedStr}" but found "${actualStr}".`,
        { selector, expected: expectedStr, actual: actualStr }
      )
    };
  } catch (err: any) {
    return {
      verified: false,
      status: "FAILED",
      error: new BrowserError(
        BrowserErrorCode.VERIFICATION_FAILED,
        `Verification inspection threw an error: ${err.message}`,
        { selector, error: err.message }
      )
    };
  }
}

/**
 * Verifies that a checkbox, toggle, or radio button has the expected checked state
 */
export async function verifyCheckedState(
  selector: string,
  expectedChecked: boolean,
  evaluator: DOMScriptEvaluator
): Promise<VerificationResult> {
  try {
    const script = `
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        if (el.checked !== undefined) return Boolean(el.checked);
        return el.getAttribute("aria-checked") === "true";
      })()
    `;

    const actual = await evaluator(script);
    const actualChecked = Boolean(actual);

    if (actualChecked === expectedChecked) {
      return {
        verified: true,
        status: "VERIFIED",
        actualValue: actualChecked
      };
    }

    return {
      verified: false,
      status: "FAILED",
      actualValue: actualChecked,
      error: new BrowserError(
        BrowserErrorCode.VERIFICATION_FAILED,
        `Verification failed for checked state on "${selector}". Expected ${expectedChecked} but found ${actualChecked}.`,
        { selector, expected: expectedChecked, actual: actualChecked }
      )
    };
  } catch (err: any) {
    return {
      verified: false,
      status: "FAILED",
      error: new BrowserError(
        BrowserErrorCode.VERIFICATION_FAILED,
        `Checked state verification failed: ${err.message}`,
        { selector, error: err.message }
      )
    };
  }
}

/**
 * Verifies that current URL contains the expected substring after navigation/click
 */
export async function verifyUrlChanged(
  expectedUrlSubstring: string,
  evaluator: DOMScriptEvaluator
): Promise<VerificationResult> {
  try {
    const actualUrl = await evaluator("window.location.href");
    const actualStr = String(actualUrl || "");

    if (actualStr.includes(expectedUrlSubstring)) {
      return {
        verified: true,
        status: "VERIFIED",
        actualValue: actualStr
      };
    }

    return {
      verified: false,
      status: "FAILED",
      actualValue: actualStr,
      error: new BrowserError(
        BrowserErrorCode.VERIFICATION_FAILED,
        `Verification failed for URL change. Expected URL containing "${expectedUrlSubstring}" but landed on "${actualStr}".`,
        { expectedUrlSubstring, actualUrl: actualStr }
      )
    };
  } catch (err: any) {
    return {
      verified: false,
      status: "FAILED",
      error: new BrowserError(
        BrowserErrorCode.VERIFICATION_FAILED,
        `URL verification failed: ${err.message}`,
        { expectedUrlSubstring, error: err.message }
      )
    };
  }
}

/**
 * Verifies presence or absence of a DOM element
 */
export async function verifyElementPresence(
  selector: string,
  expectedPresent: boolean,
  evaluator: DOMScriptEvaluator
): Promise<VerificationResult> {
  try {
    const script = `Boolean(document.querySelector(${JSON.stringify(selector)}))`;
    const actual = await evaluator(script);
    const isPresent = Boolean(actual);

    if (isPresent === expectedPresent) {
      return {
        verified: true,
        status: "VERIFIED",
        actualValue: isPresent
      };
    }

    return {
      verified: false,
      status: "FAILED",
      actualValue: isPresent,
      error: new BrowserError(
        BrowserErrorCode.VERIFICATION_FAILED,
        `Verification failed for element presence on "${selector}". Expected present=${expectedPresent} but found present=${isPresent}.`,
        { selector, expectedPresent, actualPresent: isPresent }
      )
    };
  } catch (err: any) {
    return {
      verified: false,
      status: "FAILED",
      error: new BrowserError(
        BrowserErrorCode.VERIFICATION_FAILED,
        `Element presence verification failed: ${err.message}`,
        { selector, error: err.message }
      )
    };
  }
}
