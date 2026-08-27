// Canonical Observation Contract & Snapshot Schemas (M2, M19)
import { z } from "zod";

export const ElementMetadataSchema = z.object({
  id: z.string().regex(/^el_\d+$/, "Element ID must follow el_N format"),
  role: z.string().optional(),
  type: z.string().optional(),
  visible: z.boolean(),
  enabled: z.boolean(),
  text: z.string().optional(),
  label: z.string().optional(),
  placeholder: z.string().optional(),
  href: z.string().optional(),
  boundingBox: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number()
  }).optional()
});

export type ElementMetadata = z.infer<typeof ElementMetadataSchema>;

export const ObserveResponseSchema = z.object({
  tabId: z.number(),
  windowId: z.number(),
  url: z.string(),
  title: z.string(),
  loadingState: z.enum(["loading", "complete"]),
  visibleText: z.string(),
  interactiveElements: z.array(ElementMetadataSchema),
  snapshotId: z.string(),
  truncated: z.boolean().default(false)
});

export type ObserveResponse = z.infer<typeof ObserveResponseSchema>;

export const ObservationLimits = {
  MAX_PAGE_TEXT_LENGTH: 50000,
  MAX_ELEMENTS: 150,
  MAX_ATTRIBUTE_LENGTH: 500
} as const;
