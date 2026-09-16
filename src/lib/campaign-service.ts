import { db } from "@/lib/db";
import type { CampaignIntake } from "@/lib/campaign-schema";
import { getIndustryProfile, prohibitedTargetingNotice } from "@/lib/industry-profiles";

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

export async function createCampaignIntake(input: CampaignIntake) {
  const profile = getIndustryProfile(input.campaign.industry);
  const residential = input.campaign.propertyUse !== "COMMERCIAL";
  const commercial = input.campaign.propertyUse !== "RESIDENTIAL";

  return db.$transaction(async (tx) => {
    let customer;

    if (input.customer.id) {
      customer = await tx.customer.update({
        where: { id: input.customer.id },
        data: {
          name: input.customer.name,
          websiteUrl: input.customer.websiteUrl ?? null,
          timezone: input.customer.timezone,
        },
      });
    } else {
      const baseSlug = slugify(input.customer.name) || "aps-customer";
      customer = await tx.customer.upsert({
        where: { slug: baseSlug },
        create: {
          name: input.customer.name,
          slug: baseSlug,
          websiteUrl: input.customer.websiteUrl ?? null,
          timezone: input.customer.timezone,
        },
        update: {
          name: input.customer.name,
          websiteUrl: input.customer.websiteUrl ?? null,
          timezone: input.customer.timezone,
        },
      });
    }

    await tx.user.upsert({
      where: { email: input.customer.contactEmail.toLowerCase() },
      create: {
        customerId: customer.id,
        email: input.customer.contactEmail.toLowerCase(),
        name: input.customer.contactName,
        role: "CUSTOMER_ADMIN",
      },
      update: {
        customerId: customer.id,
        name: input.customer.contactName,
        role: "CUSTOMER_ADMIN",
        isActive: true,
      },
    });

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
        actorType: "CUSTOMER_INTAKE",
        actorId: input.customer.contactEmail.toLowerCase(),
        payload: {
          source: "campaign-builder",
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
        status: { in: ["QUEUED", "RUNNING"] },
      },
      orderBy: { createdAt: "desc" },
    });

    if (existingJob) {
      return {
        kind: "already_queued" as const,
        campaignId,
        jobId: existingJob.id,
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
      status: updated.status,
    };
  });
}
