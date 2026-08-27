// Human Browser Runtime - Bounded Outputs & Resource Governor (M19)
import { ObservationLimits, ObserveResponse, ElementMetadata } from "./contracts/observation.js";

export interface OutputBoundsConfig {
  maxPageTextLength?: number;
  maxInteractiveElements?: number;
  maxAttributeLength?: number;
  maxBatchSteps?: number;
  maxBatchResultSize?: number;
  maxErrorDetailsLength?: number;
}

export const DEFAULT_OUTPUT_BOUNDS: Required<OutputBoundsConfig> = {
  maxPageTextLength: ObservationLimits.MAX_PAGE_TEXT_LENGTH, // 50,000
  maxInteractiveElements: ObservationLimits.MAX_ELEMENTS,     // 150
  maxAttributeLength: ObservationLimits.MAX_ATTRIBUTE_LENGTH, // 500
  maxBatchSteps: 50,
  maxBatchResultSize: 50000,
  maxErrorDetailsLength: 10000
};

export interface BoundPageTextResult {
  text: string;
  truncated: boolean;
  originalLength: number;
  boundedLength: number;
  limit: number;
}

export interface BoundElementsResult<T = ElementMetadata> {
  elements: T[];
  truncated: boolean;
  originalCount: number;
  boundedCount: number;
  limit: number;
  attributesTruncated: boolean;
}

export interface BoundBatchResult {
  results: any[];
  truncated: boolean;
  originalCount: number;
  boundedCount: number;
  limit: number;
}

export function boundPageText(
  text: string | null | undefined,
  limit: number = DEFAULT_OUTPUT_BOUNDS.maxPageTextLength
): BoundPageTextResult {
  const original = text || "";
  const originalLength = original.length;

  if (originalLength <= limit) {
    return {
      text: original,
      truncated: false,
      originalLength,
      boundedLength: originalLength,
      limit
    };
  }

  const bounded = original.slice(0, limit);
  return {
    text: bounded,
    truncated: true,
    originalLength,
    boundedLength: bounded.length,
    limit
  };
}

export function boundInteractiveElements<T extends Record<string, any>>(
  elements: T[] | null | undefined,
  maxElements: number = DEFAULT_OUTPUT_BOUNDS.maxInteractiveElements,
  maxAttrLength: number = DEFAULT_OUTPUT_BOUNDS.maxAttributeLength
): BoundElementsResult<T> {
  const rawList = elements || [];
  const originalCount = rawList.length;
  const countTruncated = originalCount > maxElements;
  const slicedList = countTruncated ? rawList.slice(0, maxElements) : rawList;

  let attributesTruncated = false;

  const boundedElements: T[] = slicedList.map((el) => {
    const cloned = { ...el };
    const stringKeys: Array<keyof T> = ["text", "label", "placeholder", "href", "value", "title"] as any;

    for (const key of stringKeys) {
      if (typeof cloned[key] === "string") {
        const val = cloned[key] as unknown as string;
        if (val.length > maxAttrLength) {
          attributesTruncated = true;
          (cloned as any)[key] = val.slice(0, maxAttrLength);
        }
      }
    }

    return cloned;
  });

  return {
    elements: boundedElements,
    truncated: countTruncated || attributesTruncated,
    originalCount,
    boundedCount: boundedElements.length,
    limit: maxElements,
    attributesTruncated
  };
}

export function boundBatchOutputs(
  results: any[] | null | undefined,
  maxSteps: number = DEFAULT_OUTPUT_BOUNDS.maxBatchSteps,
  maxResultSize: number = DEFAULT_OUTPUT_BOUNDS.maxBatchResultSize
): BoundBatchResult {
  const rawList = results || [];
  const originalCount = rawList.length;
  const countTruncated = originalCount > maxSteps;
  const sliced = countTruncated ? rawList.slice(0, maxSteps) : rawList;

  let contentTruncated = false;

  const boundedResults = sliced.map((item) => {
    if (typeof item === "string" && item.length > maxResultSize) {
      contentTruncated = true;
      return item.slice(0, maxResultSize);
    }
    if (item && typeof item === "object") {
      const serialized = JSON.stringify(item);
      if (serialized.length > maxResultSize) {
        contentTruncated = true;
        return {
          ...item,
          _truncated: true,
          _originalLength: serialized.length,
          _preview: serialized.slice(0, 1000)
        };
      }
    }
    return item;
  });

  return {
    results: boundedResults,
    truncated: countTruncated || contentTruncated,
    originalCount,
    boundedCount: boundedResults.length,
    limit: maxSteps
  };
}

export class OutputBoundsManager {
  private config: Required<OutputBoundsConfig>;

  constructor(customConfig: OutputBoundsConfig = {}) {
    this.config = {
      ...DEFAULT_OUTPUT_BOUNDS,
      ...customConfig
    };
  }

  public setConfig(customConfig: OutputBoundsConfig): void {
    this.config = {
      ...this.config,
      ...customConfig
    };
  }

  public getConfig(): Readonly<Required<OutputBoundsConfig>> {
    return { ...this.config };
  }

  public resetConfig(): void {
    this.config = { ...DEFAULT_OUTPUT_BOUNDS };
  }

  public boundPageText(text: string | null | undefined, overrideLimit?: number): BoundPageTextResult {
    return boundPageText(text, overrideLimit ?? this.config.maxPageTextLength);
  }

  public boundElements<T extends Record<string, any>>(
    elements: T[] | null | undefined,
    overrideMaxElements?: number,
    overrideMaxAttrLength?: number
  ): BoundElementsResult<T> {
    return boundInteractiveElements(
      elements,
      overrideMaxElements ?? this.config.maxInteractiveElements,
      overrideMaxAttrLength ?? this.config.maxAttributeLength
    );
  }

  public boundBatch(
    results: any[] | null | undefined,
    overrideMaxSteps?: number,
    overrideMaxResultSize?: number
  ): BoundBatchResult {
    return boundBatchOutputs(
      results,
      overrideMaxSteps ?? this.config.maxBatchSteps,
      overrideMaxResultSize ?? this.config.maxBatchResultSize
    );
  }

  public boundObservation<T extends { visibleText?: string; interactiveElements?: any[]; truncated?: boolean }>(
    obs: T
  ): T & { truncated: boolean; boundsMetrics: { text: BoundPageTextResult; elements: BoundElementsResult } } {
    const textResult = this.boundPageText(obs.visibleText);
    const elementsResult = this.boundElements(obs.interactiveElements);

    return {
      ...obs,
      visibleText: textResult.text,
      interactiveElements: elementsResult.elements,
      truncated: Boolean(obs.truncated || textResult.truncated || elementsResult.truncated),
      boundsMetrics: {
        text: textResult,
        elements: elementsResult
      }
    };
  }
}

export const OutputBounds = new OutputBoundsManager();
