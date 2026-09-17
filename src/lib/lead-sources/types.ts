import type { IndustryKey } from "@/lib/industry-profiles";

export type LeadProviderKey = "BATCHDATA" | "PROPWIRE" | "PHANTOMBUSTER";

export type LeadProviderExecutionMode = "API" | "AUTOMATION" | "MANUAL_EXPORT";

export type LeadSourceCapability =
  "PROPERTY_SEARCH" | "OWNER_CONTACT_ENRICHMENT" | "BUSINESS_PROSPECTING";

export type LeadSourceTerritory = {
  type: string;
  value: string;
  state: string | null;
  county: string | null;
};

export type LeadSourceCampaignContext = {
  campaignId: string;
  customerId: string;
  industry: IndustryKey | string;
  desiredLeadCount: number | null;
  residential: boolean;
  commercial: boolean;
  targetingConfig: unknown;
  territories: LeadSourceTerritory[];
};

export type LeadSourceProviderDefinition = {
  key: LeadProviderKey;
  leadSourceKey: string;
  name: string;
  providerType: string;
  executionMode: LeadProviderExecutionMode;
  capabilities: LeadSourceCapability[];
  configured: boolean;
  available: boolean;
};

export type LeadSourceRoute = {
  provider: LeadProviderKey;
  leadSourceKey: string;
  name: string;
  providerType: string;
  executionMode: LeadProviderExecutionMode;
  automated: boolean;
  score: number;
  reasons: string[];
  desiredLeadCount: number | null;
  query: {
    campaignId: string;
    customerId: string;
    industry: string;
    residential: boolean;
    commercial: boolean;
    territories: LeadSourceTerritory[];
    targeting: Record<string, unknown>;
  };
};

export type LeadSourcePlan = {
  campaignId: string;
  selected: LeadSourceRoute[];
  alternatives: LeadSourceRoute[];
  generatedAt: string;
};
