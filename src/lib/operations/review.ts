import { z } from "zod";
import { db } from "../db";
import { SourceError } from "../lead-sources/contract";
export const reviewQuery = z
  .object({
    campaignId: z.string().uuid(),
    after: z.string().uuid().optional(),
  })
  .strict();
export function maskContact(value: string, type: string) {
  if (type === "EMAIL") return "Email address on file";
  return /^\+1\d{10}$/.test(value)
    ? `Phone ending ${value.slice(-4)}`
    : "Contact on file";
}
export async function listReviewContacts(raw: unknown) {
  const { campaignId, after } = reviewQuery.parse(raw);
  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    select: { id: true, name: true, customerId: true, status: true },
  });
  if (!campaign) throw new SourceError("TARGET_NOT_FOUND", "failed");
  const rows = await db.contact.findMany({
    where: {
      ...(after ? { id: { gt: after } } : {}),
      lead: {
        customerId: campaign.customerId,
        campaignLeads: { some: { campaignId, removedAt: null } },
      },
    },
    select: {
      id: true,
      leadId: true,
      type: true,
      normalizedValue: true,
      isValid: true,
      lead: { select: { status: true } },
    },
    orderBy: { id: "asc" },
    take: 51,
  });
  const page = rows.slice(0, 50);
  return {
    campaign,
    contacts: page.map((c) => ({
      id: c.id,
      leadId: c.leadId,
      type: c.type,
      label: maskContact(c.normalizedValue, c.type),
      isValid: c.isValid,
      leadStatus: c.lead.status,
    })),
    nextCursor: rows.length > 50 ? page[page.length - 1].id : null,
    outreachAllowed: false,
  };
}
export type ReviewContacts = Awaited<ReturnType<typeof listReviewContacts>>;
