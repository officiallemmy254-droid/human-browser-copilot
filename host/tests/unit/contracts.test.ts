import { describe, it, expect, beforeEach } from "vitest";
import { generateActionId, resetActionIdSequence, ClickRequestSchema, ObserveResponseSchema, ElementMetadataSchema } from "../../src/contracts/index.js";

describe("M2, M6 & M31: Canonical Action & Observation Contracts", () => {
  beforeEach(() => {
    resetActionIdSequence();
  });

  it("should generate formatted sequential action IDs (action_000001)", () => {
    expect(generateActionId()).toBe("action_000001");
    expect(generateActionId()).toBe("action_000002");
    expect(generateActionId()).toBe("action_000003");
  });

  it("should validate ClickRequestSchema", () => {
    const valid = ClickRequestSchema.safeParse({
      taskId: "task_1",
      elementId: "el_5"
    });
    expect(valid.success).toBe(true);

    const invalid = ClickRequestSchema.safeParse({
      // missing taskId
      elementId: "el_5"
    });
    expect(invalid.success).toBe(false);
  });

  it("should validate ElementMetadataSchema with el_N pattern", () => {
    const validEl = ElementMetadataSchema.safeParse({
      id: "el_42",
      visible: true,
      enabled: true,
      text: "Click Me"
    });
    expect(validEl.success).toBe(true);

    const invalidEl = ElementMetadataSchema.safeParse({
      id: "invalid_id_format",
      visible: true,
      enabled: true
    });
    expect(invalidEl.success).toBe(false);
  });

  it("should validate ObserveResponseSchema", () => {
    const sampleObservation = {
      tabId: 101,
      windowId: 1,
      url: "https://example.com",
      title: "Example Domain",
      loadingState: "complete",
      visibleText: "Example text content",
      interactiveElements: [
        {
          id: "el_1",
          visible: true,
          enabled: true,
          text: "More information..."
        }
      ],
      snapshotId: "snap_101_1724750000",
      truncated: false
    };

    const parsed = ObserveResponseSchema.safeParse(sampleObservation);
    expect(parsed.success).toBe(true);
  });
});
