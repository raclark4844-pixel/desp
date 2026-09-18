import { z } from "zod";
import { db } from "../db";
import { enrichmentEnabled } from "../enrichment/adapter";
export const operationsQuery = z
  .object({
    search: z.string().trim().max(100).default(""),
    customerId: z.string().uuid().optional(),
    campaignId: z.string().uuid().optional(),
  })
  .strict();
export async function getOperations(raw: unknown) {
  const query = operationsQuery.parse(raw);
  const customers = await db.customer.findMany({
    where: query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: "insensitive" } },
            { slug: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {},
    select: { id: true, name: true, slug: true, status: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 51,
  });
  const customerId = query.customerId ?? customers[0]?.id;
  const customer = customerId
    ? await db.customer.findUnique({
        where: { id: customerId },
        select: { id: true, name: true, status: true, timezone: true },
      })
    : null;
  if (query.customerId && !customer) throw new Error("CUSTOMER_NOT_FOUND");
  const campaigns = customer
    ? await db.campaign.findMany({
        where: { customerId: customer.id },
        select: {
          id: true,
          name: true,
          status: true,
          industry: true,
          desiredLeadCount: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 51,
      })
    : [];
  const campaignId = query.campaignId ?? campaigns[0]?.id;
  const campaign =
    customer && campaignId
      ? await db.campaign.findFirst({
          where: { id: campaignId, customerId: customer.id },
          select: { id: true, name: true, status: true, industry: true },
        })
      : null;
  if (query.campaignId && !campaign) throw new Error("CAMPAIGN_NOT_FOUND");
  const [leadCount, contactCount, jobs, audits, jobCounts] = campaign
    ? await Promise.all([
        db.campaignLead.count({
          where: { campaignId: campaign.id, removedAt: null },
        }),
        db.contact.count({
          where: {
            lead: {
              campaignLeads: {
                some: { campaignId: campaign.id, removedAt: null },
              },
            },
          },
        }),
        db.providerJob.findMany({
          where: { campaignId: campaign.id },
          select: {
            id: true,
            provider: true,
            jobType: true,
            status: true,
            attemptCount: true,
            nextAttemptAt: true,
            createdAt: true,
            finishedAt: true,
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 25,
        }),
        db.auditEvent.findMany({
          where: { campaignId: campaign.id },
          select: { id: true, eventType: true, createdAt: true },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 15,
        }),
        db.providerJob.groupBy({
          by: ["status"],
          where: { campaignId: campaign.id },
          _count: { _all: true },
        }),
      ])
    : [0, 0, [], [], []];
  return {
    updatedAt: new Date().toISOString(),
    customers: customers.slice(0, 50),
    moreCustomers: customers.length > 50,
    customer,
    campaigns: campaigns.slice(0, 50),
    moreCampaigns: campaigns.length > 50,
    campaign,
    leadCount,
    contactCount,
    jobs,
    audits,
    jobCounts: jobCounts.map((g) => ({
      status: g.status,
      count: g._count._all,
    })),
    setup: {
      propertySearchKey: !!process.env.BATCHDATA_API_KEY?.trim(),
      enrichmentKey: !!process.env.BATCHDATA_ENRICHMENT_API_KEY?.trim(),
      enrichmentEnabled: enrichmentEnabled(),
      schedulerKey: !!process.env.CRON_SECRET?.trim(),
      outreachEnabled: false,
      externalVerificationConnected: false,
    },
  };
}
export type OperationsData = Awaited<ReturnType<typeof getOperations>>;
