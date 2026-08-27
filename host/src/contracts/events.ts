// Canonical Audit Event & Stream Contract (M22, M23)
import { z } from "zod";
import { PermissionTier } from "./policy.js";
import { BrowserErrorSchema } from "./errors.js";

export const AuditEventSchema = z.object({
  eventId: z.string(),
  timestamp: z.number(),
  taskId: z.string(),
  actionId: z.string().optional(),
  agentIdentity: z.string().default("anonymous-agent"),
  origin: z.string(),
  tabId: z.number().optional(),
  actionType: z.string(),
  policyTier: z.nativeEnum(PermissionTier),
  policyDecision: z.enum(["ALLOW", "PROMPT", "DENY"]),
  approvalState: z.enum(["NOT_REQUIRED", "PENDING", "APPROVED", "REJECTED", "SUPERSEDED"]).default("NOT_REQUIRED"),
  executionResult: z.record(z.any()).optional(),
  verificationStatus: z.enum(["VERIFIED", "UNVERIFIED", "FAILED", "SKIPPED"]).default("UNVERIFIED"),
  error: BrowserErrorSchema.optional(),
  dryRun: z.boolean().default(false)
});

export type AuditEvent = z.infer<typeof AuditEventSchema>;
