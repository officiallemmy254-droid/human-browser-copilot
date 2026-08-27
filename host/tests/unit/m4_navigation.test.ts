import { describe, it, expect, beforeEach } from "vitest";
import { BrowserErrorCode } from "../../src/contracts/errors.js";
import { createObservationSnapshot, SnapshotRegistry } from "../../src/observation_engine.js";
import { executeNavigation, executeWait } from "../../src/navigation_engine.js";

describe("M4: Navigation & Condition-Based Synchronization", () => {
  beforeEach(() => {
    SnapshotRegistry.clear();
  });

  it("should execute navigation and invalidate old snapshots for that tab", async () => {
    const obs = createObservationSnapshot({
      tabId: 5,
      windowId: 1,
      url: "https://example.com/page1",
      title: "Page 1",
      loadingState: "complete",
      visibleText: "Page 1",
      rawElements: [{ tag: "button", text: "Go", visible: true, enabled: true }]
    });

    const mockDispatcher = async (cmd: string, params: any) => {
      return { ok: true, navigated: true, url: params.url, tabId: 5 };
    };

    const res = await executeNavigation({
      taskId: "task_nav_1",
      url: "https://example.com/page2",
      tabId: 5
    }, mockDispatcher);

    expect(res.success).toBe(true);
    expect(res.actionId).toMatch(/^action_\d+$/);
    expect(res.navigatedUrl).toBe("https://example.com/page2");

    // Old snapshot for tab 5 must be invalidated/cleared
    const oldSnap = SnapshotRegistry.getSnapshot(obs.snapshotId);
    expect(oldSnap).toBeNull();
  });

  it("should succeed when wait condition (element_appears) is satisfied within timeout", async () => {
    const mockDispatcher = async (cmd: string, params: any) => {
      return { ok: true, elapsedMs: 350 };
    };

    const res = await executeWait({
      taskId: "task_wait_1",
      condition: "element_appears",
      target: "#submit-btn",
      timeoutMs: 5000
    }, mockDispatcher);

    expect(res.success).toBe(true);
    expect(res.actionId).toMatch(/^action_\d+$/);
    expect(res.elapsedMs).toBe(350);
  });

  it("should return typed TIMEOUT error when wait condition is not satisfied", async () => {
    const mockDispatcher = async (cmd: string, params: any) => {
      throw new Error(`Timeout waiting for selector: "#missing-element" after 1000ms`);
    };

    const res = await executeWait({
      taskId: "task_wait_2",
      condition: "element_appears",
      target: "#missing-element",
      timeoutMs: 1000
    }, mockDispatcher);

    expect(res.success).toBe(false);
    expect(res.error?.code).toBe(BrowserErrorCode.TIMEOUT);
    expect(res.error?.message).toContain("Timeout waiting for selector");
  });

  it("should handle url_changes wait condition", async () => {
    const mockDispatcher = async (cmd: string, params: any) => {
      return { ok: true, url: "https://example.com/dashboard", elapsedMs: 400 };
    };

    const res = await executeWait({
      taskId: "task_wait_3",
      condition: "url_changes",
      target: "/dashboard",
      timeoutMs: 5000
    }, mockDispatcher);

    expect(res.success).toBe(true);
    expect(res.elapsedMs).toBe(400);
  });
});
