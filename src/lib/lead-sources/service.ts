import { db } from "@/lib/db";
import { buildLeadSourcePlan } from "@/lib/lead-sources/router";

export async function dispatchLeadSourceJob(jobId: string) {
  return db.$transaction(async (tx) => {
    const parentJob = await tx.providerJob.findUnique({
      where: { id: jobId },
      include: {
        campaign: {
          include: {
            territories: true,
          },
        },
      },
    });

    if (!parentJob) {
      return { kind: "not_found" as const };
    }

    if (parentJob.provider !== "APS_ORCHESTRATOR" || parentJob.jobType !== "FIND_LEADS") {
      return {
        kind: "invalid_job" as const,
        jobId,
        status: parentJob.status,
      };
    }

    if (parentJob.status === "SUCCEEDED") {
      return {
        kind: "already_routed" as const,
        jobId,
        campaignId: parentJob.campaignId,
        output: parentJob.output,
      };
    }

    if (!["QUEUED", "RUNNING"].includes(parentJob.status)) {
      return {
        kind: "invalid_status" as const,
        jobId,
        status: parentJob.status,
      };
    }

    const campaign = parentJob.campaign;
    const plan = buildLeadSourcePlan({
      campaignId: campaign.id,
      customerId: campaign.customerId,
      industry: campaign.industry,
      desiredLeadCount: campaign.desiredLeadCount,
      residential: campaign.residential,
      commercial: campaign.commercial,
      targetingConfig: campaign.targetingConfig,
      territories: campaign.territories.map((territory) => ({
        type: territory.type,
        value: territory.value,
        state: territory.state,
        county: territory.county,
      })),
    });

    if (plan.selected.length === 0) {
      await tx.providerJob.update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          error: "No eligible lead source is available for this campaign.",
          finishedAt: new Date(),
          output: { plan },
        },
      });

      await tx.auditEvent.create({
        data: {
          customerId: campaign.customerId,
          campaignId: campaign.id,
          eventType: "lead_source.routing_failed",
          actorType: "APS_ORCHESTRATOR",
          actorId: jobId,
          payload: { plan },
        },
      });

      return {
        kind: "no_source" as const,
        jobId,
        campaignId: campaign.id,
        plan,
      };
    }

    await tx.providerJob.update({
      where: { id: jobId },
      data: {
        status: "RUNNING",
        error: null,
        startedAt: parentJob.startedAt ?? new Date(),
      },
    });

    const queuedJobs: Array<{
      id: string;
      provider: string;
      jobType: string;
      executionMode: string;
    }> = [];

    for (const route of plan.selected) {
      const leadSource = await tx.leadSource.upsert({
        where: { key: route.leadSourceKey },
        create: {
          key: route.leadSourceKey,
          name: route.name,
          providerType: route.providerType,
          isActive: true,
          config: {
            executionMode: route.executionMode,
            automated: route.automated,
          },
        },
        update: {
          name: route.name,
          providerType: route.providerType,
          isActive: true,
          config: {
            executionMode: route.executionMode,
            automated: route.automated,
          },
        },
      });

      const childJob = await tx.providerJob.create({
        data: {
          campaignId: campaign.id,
          leadSourceId: leadSource.id,
          provider: route.provider,
          jobType: route.executionMode === "MANUAL_EXPORT" ? "SOURCE_LEADS_MANUAL" : "SOURCE_LEADS",
          status: "QUEUED",
          input: {
            parentJobId: jobId,
            provider: route.provider,
            executionMode: route.executionMode,
            automated: route.automated,
            desiredLeadCount: route.desiredLeadCount,
            reasons: route.reasons,
            query: route.query,
          },
        },
      });

      queuedJobs.push({
        id: childJob.id,
        provider: route.provider,
        jobType: childJob.jobType,
        executionMode: route.executionMode,
      });
    }

    await tx.campaign.update({
      where: { id: campaign.id },
      data: { status: "RUNNING" },
    });

    const output = {
      plan,
      queuedJobs,
      nextWorkflow: "SOURCE_LEADS",
    };

    await tx.providerJob.update({
      where: { id: jobId },
      data: {
        status: "SUCCEEDED",
        output,
        finishedAt: new Date(),
      },
    });

    await tx.auditEvent.create({
      data: {
        customerId: campaign.customerId,
        campaignId: campaign.id,
        eventType: "lead_source.routed",
        actorType: "APS_ORCHESTRATOR",
        actorId: jobId,
        payload: output,
      },
    });

    return {
      kind: "routed" as const,
      jobId,
      campaignId: campaign.id,
      queuedJobs,
      plan,
    };
  });
}
