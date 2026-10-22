import { z } from "zod";

export const customerStatusValues = [
  "ACTIVE",
  "PAUSED",
  "SUSPENDED",
  "DENIED",
  "DEACTIVATED",
  "CLOSED",
] as const;

export type CustomerStatusValue = (typeof customerStatusValues)[number];

export const customerStatusLabels: Record<CustomerStatusValue, string> = {
  ACTIVE: "Active",
  PAUSED: "Paused",
  SUSPENDED: "Suspended",
  DENIED: "Denied",
  DEACTIVATED: "Deactivated",
  CLOSED: "Closed",
};

export const customerStatusDescriptions: Record<CustomerStatusValue, string> = {
  ACTIVE: "Customer can create and activate campaigns.",
  PAUSED: "Temporarily stops new campaign activation. Existing ready/running campaigns are paused.",
  SUSPENDED: "Administrative hold. New campaign activation is blocked.",
  DENIED: "Customer is not approved for service. New campaign activation is blocked.",
  DEACTIVATED: "Customer account is inactive. New campaign activation is blocked.",
  CLOSED: "Customer relationship is closed. New campaign activation is blocked.",
};

export function customerStatusLabel(value: string) {
  return customerStatusLabels[value as CustomerStatusValue] ?? value.toLowerCase().replaceAll("_", " ");
}

export const customerStatusChangeSchema = z.object({
  status: z.enum(customerStatusValues),
  reason: z.string().trim().min(3, "Add a short reason for the status change.").max(500),
  updatedAt: z.string().datetime(),
}).strict();
