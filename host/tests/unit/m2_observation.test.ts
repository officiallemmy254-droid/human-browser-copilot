import { describe, it, expect, beforeEach } from "vitest";
import { BrowserErrorCode } from "../../src/contracts/errors.js";
import {
  createObservationSnapshot,
  resolveSnapshotElement,
  searchSnapshotElements,
  truncatePageText,
  SnapshotRegistry
} from "../../src/observation_engine.js";

describe("M2: Browser Observation & Stale Element Detection", () => {
  beforeEach(() => {
    SnapshotRegistry.clear();
  });

  it("should create structured observation with snapshot ID and el_N format", () => {
    const rawElements = [
      { tag: "button", text: "Submit Order", role: "button", visible: true, enabled: true },
      { tag: "a", text: "Home", href: "https://example.com", visible: true, enabled: true },
      { tag: "input", type: "text", placeholder: "Username", visible: true, enabled: true }
    ];

    const observation = createObservationSnapshot({
      tabId: 10,
      windowId: 1,
      url: "https://example.com/checkout",
      title: "Checkout Page",
      loadingState: "complete",
      visibleText: "Please submit your order below.",
      rawElements
    });

    expect(observation.tabId).toBe(10);
    expect(observation.snapshotId).toMatch(/^snap_10_\d+_\d+$/);
    expect(observation.interactiveElements).toHaveLength(3);
    expect(observation.interactiveElements[0].id).toBe("el_1");
    expect(observation.interactiveElements[1].id).toBe("el_2");
    expect(observation.interactiveElements[2].id).toBe("el_3");
    expect(observation.truncated).toBe(false);
  });

  it("should resolve valid element ID within active snapshot", () => {
    const observation = createObservationSnapshot({
      tabId: 10,
      windowId: 1,
      url: "https://example.com",
      title: "Home",
      loadingState: "complete",
      visibleText: "Welcome",
      rawElements: [{ tag: "button", text: "Login", visible: true, enabled: true }]
    });

    const resolved = resolveSnapshotElement(observation.snapshotId, "el_1");
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.element.text).toBe("Login");
    }
  });

  it("should return STALE_ELEMENT when referencing element from expired/invalid snapshot", () => {
    const obs1 = createObservationSnapshot({
      tabId: 10,
      windowId: 1,
      url: "https://example.com/step1",
      title: "Step 1",
      loadingState: "complete",
      visibleText: "Step 1",
      rawElements: [{ tag: "button", text: "Next", visible: true, enabled: true }]
    });

    // A new observation on the same tab invalidates previous snapshot
    const obs2 = createObservationSnapshot({
      tabId: 10,
      windowId: 1,
      url: "https://example.com/step2",
      title: "Step 2",
      loadingState: "complete",
      visibleText: "Step 2",
      rawElements: [{ tag: "button", text: "Finish", visible: true, enabled: true }]
    });

    // Querying old snapshot obs1 should fail with STALE_ELEMENT
    const resOld = resolveSnapshotElement(obs1.snapshotId, "el_1");
    expect(resOld.ok).toBe(false);
    if (!resOld.ok) {
      expect(resOld.error.code).toBe(BrowserErrorCode.STALE_ELEMENT);
    }

    // Querying non-existent element in obs2 should fail with STALE_ELEMENT
    const resInvalid = resolveSnapshotElement(obs2.snapshotId, "el_999");
    expect(resInvalid.ok).toBe(false);
    if (!resInvalid.ok) {
      expect(resInvalid.error.code).toBe(BrowserErrorCode.STALE_ELEMENT);
    }
  });

  it("should search interactive elements by query in find()", () => {
    const obs = createObservationSnapshot({
      tabId: 10,
      windowId: 1,
      url: "https://example.com",
      title: "Home",
      loadingState: "complete",
      visibleText: "Content",
      rawElements: [
        { tag: "button", text: "Submit Order", visible: true, enabled: true },
        { tag: "button", text: "Cancel Order", visible: true, enabled: true },
        { tag: "a", text: "Help Center", visible: true, enabled: true }
      ]
    });

    const matches = searchSnapshotElements(obs.snapshotId, "order");
    expect(matches).toHaveLength(2);
    expect(matches[0].id).toBe("el_1");
    expect(matches[1].id).toBe("el_2");
  });

  it("should enforce bounded observation text limits and set truncated: true (M19)", () => {
    const longText = "A".repeat(60000);
    const result = truncatePageText(longText, 50000);
    expect(result.text.length).toBe(50000);
    expect(result.truncated).toBe(true);

    const shortText = "Short content";
    const shortResult = truncatePageText(shortText, 50000);
    expect(shortResult.text).toBe("Short content");
    expect(shortResult.truncated).toBe(false);
  });
});
