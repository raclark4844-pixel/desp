import type { LeadSourceProviderDefinition } from "@/lib/lead-sources/types";

export function getLeadSourceProviderDefinitions(): LeadSourceProviderDefinition[] {
  return [
    {
      key: "BATCHDATA",
      leadSourceKey: "batchdata",
      name: "BatchData / BatchLeads",
      providerType: "PROPERTY_DATA",
      executionMode: "API",
      capabilities: ["PROPERTY_SEARCH", "OWNER_CONTACT_ENRICHMENT"],
      configured: Boolean(process.env.BATCHDATA_API_KEY?.trim()),
      available: true,
    },
    {
      key: "PROPWIRE",
      leadSourceKey: "propwire",
      name: "PropWire",
      providerType: "PROPERTY_DATA",
      executionMode: "MANUAL_EXPORT",
      capabilities: ["PROPERTY_SEARCH", "OWNER_CONTACT_ENRICHMENT"],
      configured: false,
      available: true,
    },
    {
      key: "PHANTOMBUSTER",
      leadSourceKey: "phantombuster",
      name: "PhantomBuster",
      providerType: "PUBLIC_BUSINESS_DATA",
      executionMode: "AUTOMATION",
      capabilities: ["BUSINESS_PROSPECTING"],
      configured: Boolean(process.env.PHANTOMBUSTER_API_KEY),
      available: true,
    },
  ];
}

export function getLeadSourceProviderStatus() {
  return getLeadSourceProviderDefinitions().map((provider) => ({
    key: provider.key,
    name: provider.name,
    providerType: provider.providerType,
    executionMode: provider.executionMode,
    configured: provider.configured,
    available: provider.available,
    capabilities: provider.capabilities,
  }));
}
