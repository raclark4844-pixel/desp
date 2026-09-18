import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { CampaignIntake } from "@/lib/campaign-schema";
import {
  getIndustryProfile,
  prohibitedTargetingNotice,
} from "@/lib/industry-profiles";

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function asDate(value?: string) {
  return value ? new Date(`${value}T12:00:00.000Z`) : null;
}

export class CustomerIntakeError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function createCampaignIntake(
  input: CampaignIntake,
  allowExistingCustomer = false,
) {
  if (input.customer.id && !allowExistingCustomer) {
    throw new CustomerIntakeError(
      401,
      "Operator authorization is required to use a saved customer.",
    );
  }
  const profile = getIndustryProfile(input.campaign.industry);
  const residential = input.campaign.propertyUse !== "COMMERCIAL";
  const commercial = input.campaign.propertyUse !== "RESIDENTIAL";

  return db.$transaction(async (tx) => {
    let customer;
    if (input.customer.id) {
      await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${input.customer.id}::uuid FOR SHARE`;
      customer = await tx.customer.findUnique({
        where: { id: input.customer.id },
      });
      if (!customer)
        throw new CustomerIntakeError(
          404,
          "Saved customer was not found. Search again.",
        );
      if (customer.status !== "ACTIVE")
        throw new CustomerIntakeError(409, "This customer is not active.");
      if (
        customer.name !== input.customer.name ||
        (customer.websiteUrl ?? "") !== (input.customer.websiteUrl ?? "") ||
        customer.timezone !== input.customer.timezone ||
        customer.contactName !== input.customer.contactName ||
        customer.contactEmail?.toLowerCase() !==
          input.customer.contactEmail.toLowerCase()
      ) {
        throw new CustomerIntakeError(
          409,
          "Saved customer details changed or are incomplete. Search again before saving.",
        );
      }
    } else {
      customer = await tx.customer.create({
        data: {
          name: input.customer.name,
          slug: `${slugify(input.customer.name) || "aps-customer"}-${randomUUID()}`,
          websiteUrl: input.customer.websiteUrl || null,
          timezone: input.customer.timezone,
          contactName: input.customer.contactName,
          contactEmail: input.customer.contactEmail.toLowerCase(),
        },
      });
    }

    const campaign = await tx.campaign.create({
      data: {
        customerId: customer.id,
        name: input.campaign.name,
        industry: input.campaign.industry,
        status: "DRAFT",
        residential,
        commercial,
        desiredLeadCount: input.campaign.desiredLeadCount,
        startAt: asDate(input.campaign.startDate),
        endAt: asDate(input.campaign.endDate),
        targetingConfig: {
          industryProfile: input.campaign.industry,
          recommendedCriteria: [...profile.recommendedCriteria],
          prohibitedTargetingNotice,
          ownerOccupied: input.targeting.ownerOccupied ?? null,
          minYearBuilt: input.targeting.minYearBuilt ?? null,
          maxYearBuilt: input.targeting.maxYearBuilt ?? null,
          minEstimatedValue: input.targeting.minEstimatedValue ?? null,
          maxEstimatedValue: input.targeting.maxEstimatedValue ?? null,
          leadType: input.targeting.leadType ?? null,
          customCriteria: input.targeting.customCriteria ?? null,
        },
        outreachConfig: {
          serviceLevel: input.campaign.serviceLevel,
          requestedChannels: input.campaign.channels,
          providerConnections: {
            textGrid: "NOT_CONNECTED",
            email: "NOT_CONNECTED",
            calling: "NOT_CONNECTED",
          },
          launchState: "DRAFT_ONLY",
        },
        qualificationConfig: {
          profile: input.campaign.industry,
          fields: [...profile.qualificationFields],
          automationState: "NOT_CONFIGURED",
        },
        territories: {
          create: input.territories.map((territory) => ({
            type: territory.type,
            value: territory.value,
            state: territory.state ?? null,
            county: territory.county ?? null,
          })),
        },
      },
      include: {
        territories: true,
      },
    });

    await tx.auditEvent.create({
      data: {
        customerId: customer.id,
        campaignId: campaign.id,
        eventType: "campaign.created",
        actorType: input.customer.id ? "APS_INTERNAL" : "CUSTOMER_INTAKE",
        actorId: input.customer.contactEmail.toLowerCase(),
        payload: {
          source: "campaign-builder",
          customerSelection: input.customer.id ? "EXISTING" : "NEW",
          status: "DRAFT",
          desiredLeadCount: input.campaign.desiredLeadCount,
          industry: input.campaign.industry,
        },
      },
    });

    return {
      customerId: customer.id,
      campaignId: campaign.id,
      status: campaign.status,
      territories: campaign.territories,
    };
  });
}

export async function activateCampaign(campaignId: string) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id = ${campaignId}::uuid FOR UPDATE`;
    const campaign = await tx.campaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign) {
      return { kind: "not_found" as const };
    }

    const existingJob = await tx.providerJob.findFirst({
      where: {
        campaignId,
        provider: "APS_ORCHESTRATOR",
        jobType: "FIND_LEADS",
        status: { in: ["QUEUED", "RUNNING", "SUCCEEDED"] },
      },
      orderBy: { createdAt: "desc" },
    });

    if (existingJob) {
      return {
        kind: "already_queued" as const,
        campaignId,
        jobId: existingJob.id,
        jobStatus: existingJob.status,
        status: campaign.status,
      };
    }

    const updated = await tx.campaign.update({
      where: { id: campaignId },
      data: { status: "READY" },
    });

    const job = await tx.providerJob.create({
      data: {
        campaignId,
        provider: "APS_ORCHESTRATOR",
        jobType: "FIND_LEADS",
        status: "QUEUED",
        input: {
          campaignId,
          customerId: campaign.customerId,
          industry: campaign.industry,
          desiredLeadCount: campaign.desiredLeadCount,
        },
      },
    });

    await tx.auditEvent.create({
      data: {
        customerId: campaign.customerId,
        campaignId,
        eventType: "campaign.activated",
        actorType: "APS_INTERNAL",
        payload: {
          previousStatus: campaign.status,
          status: updated.status,
          queuedJobId: job.id,
          nextWorkflow: "FIND_LEADS",
        },
      },
    });

    return {
      kind: "queued" as const,
      campaignId,
      jobId: job.id,
      jobStatus: job.status,
      status: updated.status,
    };
  });
}
