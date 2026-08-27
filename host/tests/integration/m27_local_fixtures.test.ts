import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "path";
import { pathToFileURL, fileURLToPath } from "url";
import { Page } from "playwright-core";
import { BrowserErrorCode } from "../../src/contracts/errors.js";
import { mapErrorToCanonical } from "../../src/error_mapper.js";
import {
  launchSandbox,
  closeSandbox,
  sandboxHumanClick,
  sandboxHumanType,
  sandboxWaitFor,
  sandboxExtractData
} from "../../src/sandbox_runner.js";
import {
  createObservationSnapshot,
  resolveSnapshotElement,
  searchSnapshotElements,
  SnapshotRegistry
} from "../../src/observation_engine.js";
import {
  verifyTypeAction,
  verifyElementPresence,
  verifyUrlChanged
} from "../../src/action_verifier.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.resolve(__dirname, "../../../tests/fixtures");

function getFixtureUrl(fileName: string): string {
  const filePath = path.join(fixturesDir, fileName);
  return pathToFileURL(filePath).href;
}

describe("M27: Deterministic Test Suite on Local HTML Fixtures", () => {
  let page: Page;

  beforeAll(async () => {
    SnapshotRegistry.clear();
    page = await launchSandbox({ headless: true, isEphemeral: true });
  }, 30000);

  afterAll(async () => {
    await closeSandbox();
  }, 10000);

  describe("1. Index Hub & Deterministic Navigation Flow (index.html)", () => {
    it("should navigate to index.html and observe navigation hub links", async () => {
      const indexUrl = getFixtureUrl("index.html");
      await page.goto(indexUrl, { waitUntil: "domcontentloaded" });

      const title = await page.title();
      expect(title).toBe("Deterministic Test Harness — Index");

      const text = await page.evaluate(() => document.body.innerText);
      expect(text).toContain("Deterministic Browser Runtime Test Harness");

      // Extract raw elements for observation snapshot
      const rawElements = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll("a[href]"));
        return els.map(el => ({
          tag: el.tagName.toLowerCase(),
          text: el.textContent?.trim() || "",
          href: el.getAttribute("href") || "",
          role: "link",
          visible: true,
          enabled: true
        }));
      });

      const obs = createObservationSnapshot({
        tabId: 1,
        windowId: 1,
        url: indexUrl,
        title,
        loadingState: "complete",
        visibleText: text,
        rawElements
      });

      expect(obs.interactiveElements).toHaveLength(4);
      expect(obs.interactiveElements[0].text).toContain("Standard Interactive Elements");
      expect(obs.interactiveElements[1].text).toContain("Stale Elements Test");
      expect(obs.interactiveElements[2].text).toContain("Modals & Dialogs Test");
      expect(obs.interactiveElements[3].text).toContain("Dynamic & Delayed Elements");
    });

    it("should click link to elements.html and verify URL transition", async () => {
      await sandboxHumanClick(page, "#link-elements");
      await page.waitForURL(/elements\.html/);
      await page.waitForLoadState("domcontentloaded");

      const currentUrl = page.url();
      expect(currentUrl).toContain("elements.html");

      const title = await page.title();
      expect(title).toBe("Standard Elements Fixture");

      const urlVerification = await verifyUrlChanged("elements.html", async (script) => page.evaluate(script));
      expect(urlVerification.verified).toBe(true);
    });
  });

  describe("2. Standard Interactive Elements & Form Inputs (elements.html)", () => {
    it("should observe structured metadata and detect enabled vs disabled controls", async () => {
      const elementsUrl = getFixtureUrl("elements.html");
      await page.goto(elementsUrl, { waitUntil: "domcontentloaded" });

      const rawElements = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll("button, input, textarea"));
        return els.map(el => ({
          tag: el.tagName.toLowerCase(),
          text: el.textContent?.trim() || "",
          type: el.getAttribute("type") || undefined,
          placeholder: el.getAttribute("placeholder") || undefined,
          role: el.tagName.toLowerCase(),
          visible: true,
          enabled: !(el as any).disabled
        }));
      });

      const obs = createObservationSnapshot({
        tabId: 1,
        windowId: 1,
        url: elementsUrl,
        title: await page.title(),
        loadingState: "complete",
        visibleText: await page.evaluate(() => document.body.innerText),
        rawElements
      });

      expect(obs.interactiveElements.length).toBeGreaterThanOrEqual(6);

      // Verify disabled button has enabled: false
      const disabledButton = obs.interactiveElements.find(e => e.text === "Disabled Button");
      expect(disabledButton).toBeDefined();
      expect(disabledButton?.enabled).toBe(false);

      // Search elements by query
      const submitMatches = searchSnapshotElements(obs.snapshotId, "submit");
      expect(submitMatches).toHaveLength(1);
      expect(submitMatches[0].text).toBe("Submit Order");

      const usernameMatches = searchSnapshotElements(obs.snapshotId, "username");
      expect(usernameMatches.length).toBeGreaterThanOrEqual(1);
    });

    it("should perform human typing into input fields and verify post-action state", async () => {
      // Type username
      await sandboxHumanType(page, "#input-username", "test_user_01");

      const typeVerification = await verifyTypeAction(
        "#input-username",
        "test_user_01",
        async (script) => page.evaluate(script)
      );
      expect(typeVerification.verified).toBe(true);
      expect(typeVerification.actualValue).toBe("test_user_01");

      // Type notes into textarea
      await sandboxHumanType(page, "#textarea-notes", "Deterministic test passed.");
      const notesVerification = await verifyTypeAction(
        "#textarea-notes",
        "Deterministic test passed.",
        async (script) => page.evaluate(script)
      );
      expect(notesVerification.verified).toBe(true);
    }, 15000);

    it("should perform organic clicks on standard buttons", async () => {
      await sandboxHumanClick(page, "#btn-submit");
      await sandboxHumanClick(page, "#btn-cancel");

      // Verification that form elements are present
      const formPresence = await verifyElementPresence("#test-form", true, async (s) => page.evaluate(s));
      expect(formPresence.verified).toBe(true);
    });
  });

  describe("3. Stale Elements & DOM Replacement Handling (stale_elements.html)", () => {
    it("should detect DOM mutation and handle stale element transitions", async () => {
      const staleUrl = getFixtureUrl("stale_elements.html");
      await page.goto(staleUrl, { waitUntil: "domcontentloaded" });

      // Initial observation captures #btn-target
      const initialElements = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll("button"));
        return els.map(el => ({
          tag: el.tagName.toLowerCase(),
          text: el.textContent?.trim() || "",
          visible: true,
          enabled: true
        }));
      });

      const initialObs = createObservationSnapshot({
        tabId: 1,
        windowId: 1,
        url: staleUrl,
        title: await page.title(),
        loadingState: "complete",
        visibleText: await page.evaluate(() => document.body.innerText),
        rawElements: initialElements
      });

      const initialBtn = initialObs.interactiveElements.find(e => e.text === "Initial Target Button");
      expect(initialBtn).toBeDefined();

      // Mutate the DOM by clicking #btn-mutate
      await sandboxHumanClick(page, "#btn-mutate");

      // Old #btn-target is removed from the DOM
      const oldElementCheck = await verifyElementPresence("#btn-target", false, async (s) => page.evaluate(s));
      expect(oldElementCheck.verified).toBe(true);

      // New #btn-new is inserted into the DOM
      const newElementCheck = await verifyElementPresence("#btn-new", true, async (s) => page.evaluate(s));
      expect(newElementCheck.verified).toBe(true);

      // Re-observing creates a new valid snapshot with replaced button
      const mutatedElements = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll("button"));
        return els.map(el => ({
          tag: el.tagName.toLowerCase(),
          text: el.textContent?.trim() || "",
          visible: true,
          enabled: true
        }));
      });

      const freshObs = createObservationSnapshot({
        tabId: 1,
        windowId: 1,
        url: staleUrl,
        title: await page.title(),
        loadingState: "complete",
        visibleText: await page.evaluate(() => document.body.innerText),
        rawElements: mutatedElements
      });

      // Querying initialObs now returns STALE_ELEMENT
      const staleRes = resolveSnapshotElement(initialObs.snapshotId, "el_1");
      expect(staleRes.ok).toBe(false);
      if (!staleRes.ok) {
        expect(staleRes.error.code).toBe(BrowserErrorCode.STALE_ELEMENT);
      }

      // Fresh snapshot resolves the new button
      const freshBtn = freshObs.interactiveElements.find(e => e.text === "Replaced Target Button");
      expect(freshBtn).toBeDefined();
      const freshRes = resolveSnapshotElement(freshObs.snapshotId, freshBtn!.id);
      expect(freshRes.ok).toBe(true);
    });
  });

  describe("4. Modals & Dialog Handling (modals.html)", () => {
    it("should intercept and resolve JavaScript alert, confirm, and prompt dialogs", async () => {
      const modalsUrl = getFixtureUrl("modals.html");
      await page.goto(modalsUrl, { waitUntil: "domcontentloaded" });

      // 1. Alert Dialog
      let alertMessage = "";
      page.once("dialog", async (dialog) => {
        expect(dialog.type()).toBe("alert");
        alertMessage = dialog.message();
        await dialog.accept();
      });
      await sandboxHumanClick(page, "#btn-alert");
      expect(alertMessage).toBe("Blocking Alert Dialog");

      // 2. Confirm Dialog
      let confirmMessage = "";
      page.once("dialog", async (dialog) => {
        expect(dialog.type()).toBe("confirm");
        confirmMessage = dialog.message();
        await dialog.accept();
      });
      await sandboxHumanClick(page, "#btn-confirm");
      expect(confirmMessage).toBe("Are you sure?");

      // 3. Prompt Dialog
      let promptMessage = "";
      page.once("dialog", async (dialog) => {
        expect(dialog.type()).toBe("prompt");
        promptMessage = dialog.message();
        await dialog.accept("AUTH-TOKEN-999");
      });
      await sandboxHumanClick(page, "#btn-prompt");
      expect(promptMessage).toBe("Enter confirmation code:");
    });

    it("should map unexpected modal dialog blocking errors to canonical MODAL_BLOCKING error code", () => {
      const error = mapErrorToCanonical(new Error("JavaScript dialog alert() is blocking page interaction"));
      expect(error.code).toBe(BrowserErrorCode.MODAL_BLOCKING);
      expect(error.retryable).toBe(true);
    });
  });

  describe("5. Dynamic Delayed Elements & Synchronization (dynamic.html)", () => {
    it("should wait dynamically for delayed elements to appear and verify presence", async () => {
      const dynamicUrl = getFixtureUrl("dynamic.html");
      await page.goto(dynamicUrl, { waitUntil: "domcontentloaded" });

      // Initial state: loading indicator is visible
      const initialText = await page.evaluate(() => document.body.innerText);
      expect(initialText).toContain("Loading data...");

      // Wait for delayed element (#btn-delayed) to appear via sandboxWaitFor
      const waitResult = await sandboxWaitFor(page, "selector", "#btn-delayed", 10000);
      expect(waitResult.ok).toBe(true);

      // Verify delayed button is present in DOM
      const presence = await verifyElementPresence("#btn-delayed", true, async (s) => page.evaluate(s));
      expect(presence.verified).toBe(true);

      // Click the dynamically loaded button
      await sandboxHumanClick(page, "#btn-delayed");
      const buttonText = await page.locator("#btn-delayed").innerText();
      expect(buttonText).toBe("Delayed Action Button");
    });
  });
});
