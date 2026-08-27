import { describe, it, expect, beforeEach } from "vitest";
import { BrowserErrorCode } from "../../src/contracts/errors.js";
import { createObservationSnapshot, SnapshotRegistry } from "../../src/observation_engine.js";
import {
  executeInteractionClick,
  executeInteractionType,
  executeInteractionClear,
  executeInteractionKeypress,
  executeInteractionScroll
} from "../../src/interaction_engine.js";

describe("M3: Browser Interaction & Semantic Hierarchy", () => {
  let activeSnapshotId: string;

  beforeEach(() => {
    SnapshotRegistry.clear();
    const obs = createObservationSnapshot({
      tabId: 1,
      windowId: 1,
      url: "https://example.com/form",
      title: "Test Form",
      loadingState: "complete",
      visibleText: "Submit your details",
      rawElements: [
        { tag: "button", text: "Submit", role: "button", visible: true, enabled: true, boundingBox: { x: 100, y: 200, width: 80, height: 30 } },
        { tag: "input", type: "text", placeholder: "Username", visible: true, enabled: true, boundingBox: { x: 100, y: 100, width: 150, height: 30 } }
      ]
    });
    activeSnapshotId = obs.snapshotId;
  });

  it("should execute click on valid element ID with sequential actionId and verification status", async () => {
    const mockDispatcher = async (cmd: string, params: any) => {
      return { ok: true, clicked: true, x: 140, y: 215, verified: true };
    };

    const res = await executeInteractionClick({
      taskId: "task_1",
      snapshotId: activeSnapshotId,
      elementId: "el_1"
    }, mockDispatcher);

    expect(res.success).toBe(true);
    expect(res.actionId).toMatch(/^action_\d+$/);
    expect(res.verified).toBe(true);
    expect(res.clickedCoordinates).toEqual({ x: 140, y: 215 });
  });

  it("should fail click with STALE_ELEMENT if elementId does not exist in snapshot", async () => {
    const mockDispatcher = async () => ({ ok: true });

    const res = await executeInteractionClick({
      taskId: "task_1",
      snapshotId: activeSnapshotId,
      elementId: "el_99"
    }, mockDispatcher);

    expect(res.success).toBe(false);
    expect(res.error?.code).toBe(BrowserErrorCode.STALE_ELEMENT);
  });

  it("should execute type action and return characters typed count", async () => {
    const mockDispatcher = async (cmd: string, params: any) => {
      return { ok: true, typed: true, length: params.text.length, verified: true };
    };

    const res = await executeInteractionType({
      taskId: "task_1",
      snapshotId: activeSnapshotId,
      elementId: "el_2",
      text: "admin_user"
    }, mockDispatcher);

    expect(res.success).toBe(true);
    expect(res.charactersTyped).toBe(10);
    expect(res.verified).toBe(true);
  });

  it("should execute clear action", async () => {
    const mockDispatcher = async () => ({ ok: true, cleared: true, verified: true });

    const res = await executeInteractionClear({
      taskId: "task_1",
      snapshotId: activeSnapshotId,
      elementId: "el_2"
    }, mockDispatcher);

    expect(res.success).toBe(true);
    expect(res.actionId).toMatch(/^action_\d+$/);
  });

  it("should execute keypress action", async () => {
    const mockDispatcher = async () => ({ ok: true, keypressed: true, verified: true });

    const res = await executeInteractionKeypress({
      taskId: "task_1",
      key: "Enter"
    }, mockDispatcher);

    expect(res.success).toBe(true);
    expect(res.verified).toBe(true);
  });

  it("should execute scroll action with requested distance", async () => {
    const mockDispatcher = async (cmd: string, params: any) => ({ ok: true, scrolled: true, distanceY: params.distanceY, verified: true });

    const res = await executeInteractionScroll({
      taskId: "task_1",
      distanceY: 500
    }, mockDispatcher);

    expect(res.success).toBe(true);
    expect(res.distanceScrolled).toBe(500);
  });
});
