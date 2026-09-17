import { z } from "zod";
import type { LeadSourceCampaignContext } from "./types";

export const propertyRecordSchema = z
  .object({
    externalRef: z.string().trim().min(1).max(200).optional(),
    address1: z.string().trim().min(1).max(200),
    address2: z.string().trim().max(100).optional(),
    city: z.string().trim().min(1).max(120),
    state: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2}$/)
      .transform((s) => s.toUpperCase()),
    postalCode: z
      .string()
      .trim()
      .regex(/^\d{5}(-\d{4})?$/)
      .transform((s) => s.slice(0, 5)),
    county: z.string().trim().max(120).optional(),
    propertyType: z.enum(["RESIDENTIAL", "COMMERCIAL"]).optional(),
    yearBuilt: z.number().int().min(1700).max(2100).optional(),
    ownerOccupied: z.boolean().optional(),
    estimatedValue: z.number().finite().min(0).max(999999999999.99).optional(),
  })
  .strict();
export type PropertyRecord = z.infer<typeof propertyRecordSchema>;
export type SourceContext = LeadSourceCampaignContext;
export type SourceCursor = { territory: number; skip: number; pages: number };
export interface SourcePage {
  records: unknown[];
  nextCursor: SourceCursor | null;
}
export interface LeadSourceAdapter {
  key: string;
  fetchPage(
    context: SourceContext,
    cursor: SourceCursor,
    take: number,
  ): Promise<SourcePage>;
  normalize(record: unknown): PropertyRecord;
}
export class SourceError extends Error {
  constructor(
    public code: string,
    public disposition: "retry" | "blocked" | "failed",
    public retryAfter = 0,
  ) {
    super(code);
  }
}
export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
