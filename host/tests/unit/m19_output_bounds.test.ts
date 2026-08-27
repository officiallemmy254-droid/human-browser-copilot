import { describe, it, expect, beforeEach } from "vitest";
import {
  boundPageText,
  boundInteractiveElements,
  boundBatchOutputs,
  OutputBoundsManager,
  OutputBounds,
  DEFAULT_OUTPUT_BOUNDS
} from "../../src/output_bounds.js";
import { ObservationLimits } from "../../src/contracts/observation.js";

describe("M19: Bounded Outputs & Resource Governor", () => {
  beforeEach(() => {
    OutputBounds.resetConfig();
  });

  describe("Page Text Bounding", () => {
    it("should allow text under 50,000 characters without truncation", () => {
      const text = "A".repeat(1000);
      const result = boundPageText(text);

      expect(result.truncated).toBe(false);
      expect(result.text).toBe(text);
      expect(result.originalLength).toBe(1000);
      expect(result.boundedLength).toBe(1000);
      expect(result.limit).toBe(50000);
    });

    it("should truncate text exceeding 50,000 characters and set truncated: true with metrics", () => {
      const text = "A".repeat(60000);
      const result = boundPageText(text);

      expect(result.truncated).toBe(true);
      expect(result.text.length).toBe(50000);
      expect(result.originalLength).toBe(60000);
      expect(result.boundedLength).toBe(50000);
      expect(result.limit).toBe(50000);
    });

    it("should handle empty or null text safely", () => {
      const nullRes = boundPageText(null);
      expect(nullRes.text).toBe("");
      expect(nullRes.truncated).toBe(false);
      expect(nullRes.originalLength).toBe(0);

      const emptyRes = boundPageText("");
      expect(emptyRes.text).toBe("");
      expect(emptyRes.truncated).toBe(false);
    });

    it("should support configurable page text limit", () => {
      const text = "Hello World! This is a test.";
      const result = boundPageText(text, 10);

      expect(result.truncated).toBe(true);
      expect(result.text).toBe("Hello Worl");
      expect(result.boundedLength).toBe(10);
      expect(result.originalLength).toBe(text.length);
    });
  });

  describe("Interactive Elements Bounding", () => {
    it("should enforce max 150 interactive elements and return metrics", () => {
      const rawElements = Array.from({ length: 200 }, (_, i) => ({
        id: `el_${i + 1}`,
        tag: "button",
        text: `Button ${i + 1}`,
        visible: true,
        enabled: true
      }));

      const result = boundInteractiveElements(rawElements);

      expect(result.truncated).toBe(true);
      expect(result.originalCount).toBe(200);
      expect(result.boundedCount).toBe(150);
      expect(result.elements).toHaveLength(150);
      expect(result.elements[0].id).toBe("el_1");
      expect(result.elements[149].id).toBe("el_150");
    });

    it("should not truncate when element count is under limit", () => {
      const rawElements = Array.from({ length: 20 }, (_, i) => ({
        id: `el_${i + 1}`,
        tag: "input",
        text: `Input ${i + 1}`
      }));

      const result = boundInteractiveElements(rawElements);

      expect(result.truncated).toBe(false);
      expect(result.originalCount).toBe(20);
      expect(result.boundedCount).toBe(20);
      expect(result.elements).toHaveLength(20);
    });

    it("should truncate overly long element attributes (max 500 chars)", () => {
      const longAttr = "X".repeat(1000);
      const elements = [
        { id: "el_1", text: longAttr, label: "Short label", placeholder: longAttr }
      ];

      const result = boundInteractiveElements(elements);

      expect(result.truncated).toBe(true);
      expect(result.attributesTruncated).toBe(true);
      expect(result.elements[0].text?.length).toBe(500);
      expect(result.elements[0].placeholder?.length).toBe(500);
      expect(result.elements[0].label).toBe("Short label");
    });

    it("should handle null or empty element arrays gracefully", () => {
      const result = boundInteractiveElements(null);
      expect(result.elements).toEqual([]);
      expect(result.truncated).toBe(false);
      expect(result.originalCount).toBe(0);
      expect(result.boundedCount).toBe(0);
    });
  });

  describe("Batch Step Output Bounding", () => {
    it("should enforce max batch steps (default 50)", () => {
      const batchResults = Array.from({ length: 75 }, (_, i) => ({
        actionId: `action_${i + 1}`,
        success: true
      }));

      const result = boundBatchOutputs(batchResults);

      expect(result.truncated).toBe(true);
      expect(result.originalCount).toBe(75);
      expect(result.boundedCount).toBe(50);
      expect(result.results).toHaveLength(50);
      expect(result.results[0].actionId).toBe("action_1");
      expect(result.results[49].actionId).toBe("action_50");
    });

    it("should truncate oversized batch individual output payload", () => {
      const hugeData = "Z".repeat(60000);
      const batchResults = [
        { actionId: "action_1", data: hugeData }
      ];

      const result = boundBatchOutputs(batchResults, 50, 50000);

      expect(result.truncated).toBe(true);
      expect(result.results[0]._truncated).toBe(true);
    });
  });

  describe("OutputBoundsManager Config & Observation Integration", () => {
    it("should allow runtime configuration updates and reset to defaults", () => {
      const manager = new OutputBoundsManager();
      expect(manager.getConfig().maxPageTextLength).toBe(ObservationLimits.MAX_PAGE_TEXT_LENGTH);

      manager.setConfig({ maxPageTextLength: 200, maxInteractiveElements: 10 });
      expect(manager.getConfig().maxPageTextLength).toBe(200);
      expect(manager.getConfig().maxInteractiveElements).toBe(10);

      const textRes = manager.boundPageText("A".repeat(300));
      expect(textRes.truncated).toBe(true);
      expect(textRes.boundedLength).toBe(200);

      manager.resetConfig();
      expect(manager.getConfig().maxPageTextLength).toBe(50000);
    });

    it("should bound complete observation objects with detailed metrics", () => {
      const mockObservation = {
        tabId: 1,
        url: "https://example.com",
        visibleText: "B".repeat(60000),
        interactiveElements: Array.from({ length: 200 }, (_, i) => ({
          id: `el_${i + 1}`,
          text: `Button ${i + 1}`
        }))
      };

      const bounded = OutputBounds.boundObservation(mockObservation);

      expect(bounded.truncated).toBe(true);
      expect(bounded.visibleText.length).toBe(50000);
      expect(bounded.interactiveElements.length).toBe(150);
      expect(bounded.boundsMetrics.text.truncated).toBe(true);
      expect(bounded.boundsMetrics.elements.truncated).toBe(true);
      expect(bounded.tabId).toBe(1);
    });
  });
});
