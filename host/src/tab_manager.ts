// Human Browser Runtime - Tab and Window Manager with Task Scoping (M5)
import { generateActionId } from "./contracts/actions.js";
import { BrowserError, toBrowserError } from "./contracts/errors.js";

export type ActionDispatcher = (command: string, params: Record<string, any>) => Promise<any>;

export interface TabRecord {
  tabId: number;
  windowId: number;
  url: string;
  title: string;
  active: boolean;
  taskId?: string;
  isAgentOpened: boolean;
  createdAt?: number;
}

class TabRegistryManager {
  private tabs = new Map<number, TabRecord>();

  public clear(): void {
    this.tabs.clear();
  }

  public registerTab(record: TabRecord): void {
    this.tabs.set(record.tabId, {
      ...record,
      createdAt: record.createdAt || Date.now()
    });
  }

  public unregisterTab(tabId: number): void {
    this.tabs.delete(tabId);
  }

  public isTabOwnedByTask(tabId: number, taskId: string): boolean {
    const record = this.tabs.get(tabId);
    if (!record) return false;
    return record.isAgentOpened === true && record.taskId === taskId;
  }

  public getTaskOwnedTabs(taskId: string): number[] {
    const tabIds: number[] = [];
    for (const [tabId, record] of this.tabs.entries()) {
      if (record.isAgentOpened && record.taskId === taskId) {
        tabIds.push(tabId);
      }
    }
    return tabIds;
  }
}

export const TabManager = new TabRegistryManager();

export async function executeListTabs(
  taskId: string,
  dispatcher: ActionDispatcher
): Promise<{ tabs: Array<{ tabId: number; windowId: number; url: string; title: string; active: boolean; taskOwned: boolean }> }> {
  try {
    const rawTabs: any[] = await dispatcher("manage_tabs", { operation: "list" });
    const tabs = (rawTabs || []).map((t) => ({
      tabId: t.id || t.tabId,
      windowId: t.windowId || 1,
      url: t.url || "",
      title: t.title || "",
      active: Boolean(t.active),
      taskOwned: TabManager.isTabOwnedByTask(t.id || t.tabId, taskId)
    }));

    return { tabs };
  } catch (err: any) {
    throw toBrowserError(err);
  }
}

export async function executeOpenTab(
  params: { taskId: string; url?: string },
  dispatcher: ActionDispatcher
): Promise<{ actionId: string; success: boolean; tabId?: number; error?: any }> {
  const actionId = generateActionId();

  try {
    const res = await dispatcher("manage_tabs", { operation: "open", url: params.url || "about:blank" });
    const tabId = res.tabId || res.id;

    if (tabId !== undefined) {
      TabManager.registerTab({
        tabId,
        windowId: res.windowId || 1,
        url: res.url || params.url || "about:blank",
        title: res.title || "New Tab",
        active: true,
        taskId: params.taskId,
        isAgentOpened: true
      });
    }

    return {
      actionId,
      success: true,
      tabId
    };
  } catch (err: any) {
    const browserErr = toBrowserError(err);
    return {
      actionId,
      success: false,
      error: browserErr.toJSON()
    };
  }
}

export async function executeSwitchTab(
  params: { taskId: string; tabId: number },
  dispatcher: ActionDispatcher
): Promise<{ actionId: string; success: boolean; error?: any }> {
  const actionId = generateActionId();

  try {
    await dispatcher("manage_tabs", { operation: "switch", tabId: params.tabId });
    return {
      actionId,
      success: true
    };
  } catch (err: any) {
    const browserErr = toBrowserError(err);
    return {
      actionId,
      success: false,
      error: browserErr.toJSON()
    };
  }
}

export async function executeCloseTab(
  params: { taskId: string; tabId: number },
  dispatcher: ActionDispatcher
): Promise<{ actionId: string; success: boolean; error?: any }> {
  const actionId = generateActionId();

  try {
    await dispatcher("manage_tabs", { operation: "close", tabId: params.tabId });
    TabManager.unregisterTab(params.tabId);
    return {
      actionId,
      success: true
    };
  } catch (err: any) {
    const browserErr = toBrowserError(err);
    return {
      actionId,
      success: false,
      error: browserErr.toJSON()
    };
  }
}

export async function executeTaskCleanup(
  taskId: string,
  dispatcher: ActionDispatcher
): Promise<{ closedTabIds: number[] }> {
  const taskTabs = TabManager.getTaskOwnedTabs(taskId);
  const closedTabIds: number[] = [];

  for (const tabId of taskTabs) {
    try {
      await dispatcher("manage_tabs", { operation: "close", tabId });
      TabManager.unregisterTab(tabId);
      closedTabIds.push(tabId);
    } catch (e) {}
  }

  return { closedTabIds };
}
