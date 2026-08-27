import { describe, it, expect, beforeEach } from "vitest";
import {
  TabManager,
  executeListTabs,
  executeOpenTab,
  executeSwitchTab,
  executeCloseTab,
  executeTaskCleanup
} from "../../src/tab_manager.js";

describe("M5: Tab and Window Management with Task Scoping", () => {
  beforeEach(() => {
    TabManager.clear();
  });

  it("should open tab and mark it as task-owned by the requesting task", async () => {
    const mockDispatcher = async (cmd: string, params: any) => {
      return { tabId: 101, url: params.url || "about:blank" };
    };

    const res = await executeOpenTab({
      taskId: "task_A",
      url: "https://example.com/app"
    }, mockDispatcher);

    expect(res.success).toBe(true);
    expect(res.tabId).toBe(101);
    expect(res.actionId).toMatch(/^action_\d+$/);

    expect(TabManager.isTabOwnedByTask(101, "task_A")).toBe(true);
    expect(TabManager.isTabOwnedByTask(101, "task_B")).toBe(false);
  });

  it("should list tabs and annotate task-owned vs user-owned tabs", async () => {
    // Register agent-opened tab
    TabManager.registerTab({ tabId: 101, windowId: 1, url: "https://example.com", title: "App", active: true, taskId: "task_A", isAgentOpened: true });

    // Mock query returning both user tab (202) and agent tab (101)
    const mockDispatcher = async () => {
      return [
        { id: 202, windowId: 1, url: "https://google.com", title: "Google", active: false },
        { id: 101, windowId: 1, url: "https://example.com", title: "App", active: true }
      ];
    };

    const res = await executeListTabs("task_A", mockDispatcher);
    expect(res.tabs).toHaveLength(2);

    const userTab = res.tabs.find(t => t.tabId === 202);
    const agentTab = res.tabs.find(t => t.tabId === 101);

    expect(userTab?.taskOwned).toBe(false);
    expect(agentTab?.taskOwned).toBe(true);
  });

  it("should switch active tab", async () => {
    const mockDispatcher = async (cmd: string, params: any) => ({ tabId: params.tabId, active: true });

    const res = await executeSwitchTab({
      taskId: "task_A",
      tabId: 101
    }, mockDispatcher);

    expect(res.success).toBe(true);
    expect(res.actionId).toMatch(/^action_\d+$/);
  });

  it("should close specific tab and unregister it", async () => {
    TabManager.registerTab({ tabId: 101, windowId: 1, url: "https://example.com", title: "App", active: true, taskId: "task_A", isAgentOpened: true });

    const mockDispatcher = async (cmd: string, params: any) => ({ tabId: params.tabId, closed: true });

    const res = await executeCloseTab({
      taskId: "task_A",
      tabId: 101
    }, mockDispatcher);

    expect(res.success).toBe(true);
    expect(TabManager.isTabOwnedByTask(101, "task_A")).toBe(false);
  });

  it("should cleanup ONLY task-owned tabs and NEVER close user-opened tabs", async () => {
    // Task A opens tab 101 & 102
    TabManager.registerTab({ tabId: 101, windowId: 1, url: "https://site1.com", title: "Site 1", active: false, taskId: "task_A", isAgentOpened: true });
    TabManager.registerTab({ tabId: 102, windowId: 1, url: "https://site2.com", title: "Site 2", active: false, taskId: "task_A", isAgentOpened: true });

    // User opens tab 202 (not registered as task-opened)
    // Task B opens tab 303
    TabManager.registerTab({ tabId: 303, windowId: 1, url: "https://site3.com", title: "Site 3", active: true, taskId: "task_B", isAgentOpened: true });

    const closedTabs: number[] = [];
    const mockDispatcher = async (cmd: string, params: any) => {
      closedTabs.push(params.tabId);
      return { tabId: params.tabId, closed: true };
    };

    // Cleanup Task A
    const res = await executeTaskCleanup("task_A", mockDispatcher);
    expect(res.closedTabIds).toEqual([101, 102]);
    expect(closedTabs).toEqual([101, 102]);

    // Ensure User Tab (202) and Task B tab (303) remain untouched
    expect(closedTabs).not.toContain(202);
    expect(closedTabs).not.toContain(303);
    expect(TabManager.isTabOwnedByTask(303, "task_B")).toBe(true);
  });
});
