// Canonical Browser API Actions Contract (M6, M31)
import { z } from "zod";
import { BrowserErrorSchema } from "./errors.js";

let actionSequence = 1;

export function generateActionId(): string {
  const idStr = String(actionSequence++).padStart(6, "0");
  return `action_${idStr}`;
}

export function resetActionIdSequence(): void {
  actionSequence = 1;
}

export const ActionBaseResponseSchema = z.object({
  actionId: z.string(),
  success: z.boolean(),
  verified: z.boolean().default(false),
  error: BrowserErrorSchema.optional()
});

// Click
export const ClickRequestSchema = z.object({
  taskId: z.string(),
  elementId: z.string().optional(),
  selector: z.string().optional(),
  elementText: z.string().optional(),
  timeoutMs: z.number().default(30000).optional(),
  skipVerification: z.boolean().default(false).optional()
});

export const ClickResponseSchema = ActionBaseResponseSchema.extend({
  clickedCoordinates: z.object({ x: z.number(), y: z.number() }).optional()
});

// Type
export const TypeRequestSchema = z.object({
  taskId: z.string(),
  elementId: z.string().optional(),
  selector: z.string().optional(),
  text: z.string(),
  clearFirst: z.boolean().default(false).optional(),
  timeoutMs: z.number().default(30000).optional()
});

export const TypeResponseSchema = ActionBaseResponseSchema.extend({
  charactersTyped: z.number().optional()
});

// Clear
export const ClearRequestSchema = z.object({
  taskId: z.string(),
  elementId: z.string().optional(),
  selector: z.string().optional()
});

export const ClearResponseSchema = ActionBaseResponseSchema;

// Keypress
export const KeypressRequestSchema = z.object({
  taskId: z.string(),
  key: z.string()
});

export const KeypressResponseSchema = ActionBaseResponseSchema;

// Scroll
export const ScrollRequestSchema = z.object({
  taskId: z.string(),
  distanceY: z.number().default(400)
});

export const ScrollResponseSchema = ActionBaseResponseSchema.extend({
  distanceScrolled: z.number().optional()
});

// Navigate
export const NavigateRequestSchema = z.object({
  taskId: z.string(),
  url: z.string().url()
});

export const NavigateResponseSchema = ActionBaseResponseSchema.extend({
  navigatedUrl: z.string().optional()
});

// Wait
export const WaitRequestSchema = z.object({
  taskId: z.string(),
  condition: z.enum(["element_appears", "element_disappears", "url_changes", "navigation_completes", "timeout"]),
  target: z.string().optional(),
  timeoutMs: z.number().default(30000)
});

export const WaitResponseSchema = ActionBaseResponseSchema.extend({
  elapsedMs: z.number().optional()
});

// Tab Management
export const TabInfoSchema = z.object({
  tabId: z.number(),
  windowId: z.number(),
  url: z.string(),
  title: z.string(),
  active: z.boolean(),
  taskOwned: z.boolean().default(false)
});

export const ListTabsResponseSchema = z.object({
  tabs: z.array(TabInfoSchema)
});

export const OpenTabRequestSchema = z.object({
  taskId: z.string(),
  url: z.string().url().optional()
});

export const OpenTabResponseSchema = ActionBaseResponseSchema.extend({
  tabId: z.number().optional()
});

// Batch
export const BatchRequestSchema = z.object({
  taskId: z.string(),
  actions: z.array(z.record(z.any()))
});

export const BatchResponseSchema = ActionBaseResponseSchema.extend({
  results: z.array(z.record(z.any())).optional(),
  failedIndex: z.number().optional()
});
