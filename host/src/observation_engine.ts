// Human Browser Runtime - Observation Engine & Stale Element Registry (M2, M19)
import { BrowserErrorCode, BrowserError } from "./contracts/errors.js";
import { ElementMetadata, ObserveResponse, ObservationLimits } from "./contracts/observation.js";

interface StoredSnapshot {
  snapshotId: string;
  tabId: number;
  timestamp: number;
  elements: Map<string, ElementMetadata>;
}

class SnapshotRegistryManager {
  private tabSnapshots = new Map<number, StoredSnapshot>();
  private snapshotToTab = new Map<string, number>();

  public clear(): void {
    this.tabSnapshots.clear();
    this.snapshotToTab.clear();
  }

  public registerSnapshot(tabId: number, snapshotId: string, elements: ElementMetadata[]): void {
    const elementMap = new Map<string, ElementMetadata>();
    for (const el of elements) {
      elementMap.set(el.id, el);
    }

    const previous = this.tabSnapshots.get(tabId);
    if (previous) {
      this.snapshotToTab.delete(previous.snapshotId);
    }

    this.tabSnapshots.set(tabId, {
      snapshotId,
      tabId,
      timestamp: Date.now(),
      elements: elementMap
    });
    this.snapshotToTab.set(snapshotId, tabId);
  }

  public getSnapshot(snapshotId: string): StoredSnapshot | null {
    const tabId = this.snapshotToTab.get(snapshotId);
    if (tabId === undefined) return null;

    const current = this.tabSnapshots.get(tabId);
    if (!current || current.snapshotId !== snapshotId) {
      return null; // Snapshot is stale or replaced
    }
    return current;
  }

  public getLatestSnapshotForTab(tabId: number): StoredSnapshot | null {
    return this.tabSnapshots.get(tabId) || null;
  }
}

export const SnapshotRegistry = new SnapshotRegistryManager();

export function truncatePageText(text: string, maxLength: number = ObservationLimits.MAX_PAGE_TEXT_LENGTH): { text: string; truncated: boolean } {
  if (!text) return { text: "", truncated: false };
  if (text.length <= maxLength) return { text, truncated: false };
  return {
    text: text.slice(0, maxLength),
    truncated: true
  };
}

export interface CreateObservationParams {
  tabId: number;
  windowId: number;
  url: string;
  title: string;
  loadingState: "loading" | "complete";
  visibleText: string;
  rawElements: Array<{
    tag: string;
    text?: string;
    role?: string;
    type?: string;
    visible?: boolean;
    enabled?: boolean;
    placeholder?: string;
    href?: string;
    label?: string;
    boundingBox?: { x: number; y: number; width: number; height: number };
  }>;
}

let snapshotSeq = 1;

export function createObservationSnapshot(params: CreateObservationParams): ObserveResponse {
  const snapshotId = `snap_${params.tabId}_${Date.now()}_${snapshotSeq++}`;
  const textResult = truncatePageText(params.visibleText);

  let isElementsTruncated = false;
  let elementList = params.rawElements || [];
  if (elementList.length > ObservationLimits.MAX_ELEMENTS) {
    elementList = elementList.slice(0, ObservationLimits.MAX_ELEMENTS);
    isElementsTruncated = true;
  }

  const interactiveElements: ElementMetadata[] = elementList.map((raw, idx) => {
    return {
      id: `el_${idx + 1}`,
      role: raw.role || raw.tag,
      type: raw.type,
      visible: raw.visible ?? true,
      enabled: raw.enabled ?? true,
      text: raw.text ? raw.text.slice(0, ObservationLimits.MAX_ATTRIBUTE_LENGTH) : undefined,
      label: raw.label ? raw.label.slice(0, ObservationLimits.MAX_ATTRIBUTE_LENGTH) : undefined,
      placeholder: raw.placeholder ? raw.placeholder.slice(0, ObservationLimits.MAX_ATTRIBUTE_LENGTH) : undefined,
      href: raw.href ? raw.href.slice(0, ObservationLimits.MAX_ATTRIBUTE_LENGTH) : undefined,
      boundingBox: raw.boundingBox
    };
  });

  SnapshotRegistry.registerSnapshot(params.tabId, snapshotId, interactiveElements);

  return {
    tabId: params.tabId,
    windowId: params.windowId,
    url: params.url,
    title: params.title,
    loadingState: params.loadingState,
    visibleText: textResult.text,
    interactiveElements,
    snapshotId,
    truncated: textResult.truncated || isElementsTruncated
  };
}

export type ResolveResult =
  | { ok: true; element: ElementMetadata }
  | { ok: false; error: BrowserError };

export function resolveSnapshotElement(snapshotId: string, elementId: string): ResolveResult {
  const snapshot = SnapshotRegistry.getSnapshot(snapshotId);
  if (!snapshot) {
    return {
      ok: false,
      error: new BrowserError(
        BrowserErrorCode.STALE_ELEMENT,
        `Snapshot "${snapshotId}" is expired, replaced, or invalid. Request a new observation first.`
      )
    };
  }

  const element = snapshot.elements.get(elementId);
  if (!element) {
    return {
      ok: false,
      error: new BrowserError(
        BrowserErrorCode.STALE_ELEMENT,
        `Element "${elementId}" is stale or not present in snapshot "${snapshotId}".`
      )
    };
  }

  return { ok: true, element };
}

export function searchSnapshotElements(snapshotId: string, query: string): ElementMetadata[] {
  const snapshot = SnapshotRegistry.getSnapshot(snapshotId);
  if (!snapshot) return [];

  const q = query.toLowerCase().trim();
  const results: ElementMetadata[] = [];

  for (const el of snapshot.elements.values()) {
    const textMatch = el.text && el.text.toLowerCase().includes(q);
    const labelMatch = el.label && el.label.toLowerCase().includes(q);
    const placeholderMatch = el.placeholder && el.placeholder.toLowerCase().includes(q);
    const roleMatch = el.role && el.role.toLowerCase().includes(q);

    if (textMatch || labelMatch || placeholderMatch || roleMatch) {
      results.push(el);
    }
  }

  return results;
}
