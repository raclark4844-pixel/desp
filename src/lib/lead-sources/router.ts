import { getLeadSourceProviderDefinitions } from "@/lib/lead-sources/registry";
import type {
  LeadSourceCampaignContext,
  LeadSourcePlan,
  LeadSourceProviderDefinition,
  LeadSourceRoute,
} from "@/lib/lead-sources/types";

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function scoreProvider(
  provider: LeadSourceProviderDefinition,
  context: LeadSourceCampaignContext,
) {
  let score = 0;
  const reasons: string[] = [];

  if (!provider.available) {
    return { score: -1, reasons: ["Provider is unavailable."] };
  }

  if (provider.key === "BATCHDATA") {
    if (!provider.configured) {
      return { score: -1, reasons: ["BATCHDATA_API_KEY is not configured."] };
    }

    score += 100;
    reasons.push("API-first property and owner-data source is configured.");

    if (context.residential) {
      score += 15;
      reasons.push("Strong fit for residential property targeting.");
    }

    if (context.territories.length > 0) {
      score += 10;
      reasons.push("Supports territory-driven property searches.");
    }
  }

  if (provider.key === "PROPWIRE") {
    score += 55;
    reasons.push("Available as the current property-data fallback.");
    reasons.push(
      "Queued as a manual export/import workflow until approved API access is available.",
    );

    if (context.residential) {
      score += 10;
    }
  }

  if (provider.key === "PHANTOMBUSTER") {
    if (!provider.configured) {
      return {
        score: -1,
        reasons: ["PHANTOMBUSTER_API_KEY is not configured."],
      };
    }

    score += 35;
    reasons.push(
      "Automation connector is configured for supplemental public/business prospecting.",
    );

    if (context.commercial || context.industry === "other") {
      score += 35;
      reasons.push(
        "Commercial/custom campaign can benefit from business prospecting data.",
      );
    }
  }

  return { score, reasons };
}

function toRoute(
  provider: LeadSourceProviderDefinition,
  context: LeadSourceCampaignContext,
  score: number,
  reasons: string[],
): LeadSourceRoute {
  return {
    provider: provider.key,
    leadSourceKey: provider.leadSourceKey,
    name: provider.name,
    providerType: provider.providerType,
    executionMode: provider.executionMode,
    automated:
      provider.executionMode !== "MANUAL_EXPORT" && provider.configured,
    score,
    reasons,
    desiredLeadCount: context.desiredLeadCount,
    query: {
      campaignId: context.campaignId,
      customerId: context.customerId,
      industry: context.industry,
      residential: context.residential,
      commercial: context.commercial,
      territories: context.territories,
      targeting: asRecord(context.targetingConfig),
    },
  };
}

export function buildLeadSourcePlan(
  context: LeadSourceCampaignContext,
): LeadSourcePlan {
  const ranked = getLeadSourceProviderDefinitions()
    .map((provider) => {
      const ranking = scoreProvider(provider, context);
      return toRoute(provider, context, ranking.score, ranking.reasons);
    })
    .filter((route) => route.score >= 0)
    .sort((a, b) => b.score - a.score);

  const primary = ranked[0];
  const supplemental = ranked.find(
    (route) =>
      route.provider === "PHANTOMBUSTER" &&
      route.automated &&
      (context.commercial || context.industry === "other"),
  );

  const selected = primary ? [primary] : [];

  if (supplemental && supplemental.provider !== primary?.provider) {
    selected.push(supplemental);
  }

  const selectedKeys = new Set(selected.map((route) => route.provider));

  return {
    campaignId: context.campaignId,
    selected,
    alternatives: ranked.filter((route) => !selectedKeys.has(route.provider)),
    generatedAt: new Date().toISOString(),
  };
}
