export const industryProfiles = {
  roofing: {
    label: "Roofing",
    description: "Residential and commercial roofing repair, replacement, and storm-restoration prospecting.",
    recommendedCriteria: [
      "Owner-occupied property",
      "Property age and likely roof age",
      "Storm-affected or hail/wind-prone geography",
      "Property value and equity where lawfully available",
      "Recent purchase or ownership-change signals",
    ],
    qualificationFields: ["propertyOwner", "roofNeed", "timing", "stormRelated", "preferredContactTime"],
  },
  hvac: {
    label: "HVAC",
    description: "Heating, cooling, replacement, maintenance, and indoor-comfort campaigns.",
    recommendedCriteria: [
      "Owner-occupied property",
      "Older housing stock",
      "Single-family or selected multifamily property types",
      "Climate and seasonal service demand",
      "Property value where lawfully available",
    ],
    qualificationFields: ["propertyOwner", "systemNeed", "systemAge", "timing", "preferredContactTime"],
  },
  solar: {
    label: "Solar",
    description: "Owner-focused solar prospecting using property and suitability signals.",
    recommendedCriteria: [
      "Owner-occupied property",
      "Eligible residential property type",
      "Property value where lawfully available",
      "Roof/property suitability signals from approved providers",
      "Geographic service eligibility",
    ],
    qualificationFields: ["propertyOwner", "solarInterest", "timing", "roofCondition", "preferredContactTime"],
  },
  windows_siding: {
    label: "Windows & Siding",
    description: "Exterior remodeling campaigns for windows, siding, gutters, and related envelope work.",
    recommendedCriteria: [
      "Owner-occupied property",
      "Older housing stock",
      "Property value where lawfully available",
      "Storm-affected geography where relevant",
      "Selected residential property types",
    ],
    qualificationFields: ["propertyOwner", "projectType", "timing", "stormRelated", "preferredContactTime"],
  },
  landscaping: {
    label: "Landscaping",
    description: "Residential and commercial landscaping, hardscape, lawn, and outdoor-service campaigns.",
    recommendedCriteria: [
      "Serviceable property type",
      "Lot/property characteristics from approved providers",
      "Owner-occupied status where relevant",
      "Geographic service radius",
      "Seasonal demand",
    ],
    qualificationFields: ["propertyOwnerOrManager", "projectType", "timing", "propertyType", "preferredContactTime"],
  },
  remodeling: {
    label: "Remodeling",
    description: "Interior and exterior remodeling lead campaigns based on property-level criteria.",
    recommendedCriteria: [
      "Owner-occupied property",
      "Older housing stock",
      "Property value where lawfully available",
      "Selected property types",
      "Geographic service eligibility",
    ],
    qualificationFields: ["propertyOwner", "projectType", "budgetRange", "timing", "preferredContactTime"],
  },
  real_estate: {
    label: "Real Estate",
    description: "Property-owner prospecting for permitted real-estate outreach use cases.",
    recommendedCriteria: [
      "Absentee-owner status where lawfully available",
      "Ownership duration",
      "Property type",
      "Property value/equity where lawfully available",
      "Geographic market criteria",
    ],
    qualificationFields: ["ownerStatus", "sellInterest", "timing", "propertyCondition", "preferredContactTime"],
  },
  mortgage: {
    label: "Mortgage",
    description: "Property-based mortgage prospecting limited to lawful, non-protected targeting criteria.",
    recommendedCriteria: [
      "Property ownership",
      "Property type",
      "Property value/equity where lawfully available",
      "Loan/property data from approved compliant providers",
      "Geographic service eligibility",
    ],
    qualificationFields: ["propertyOwner", "loanNeed", "timing", "propertyType", "preferredContactTime"],
  },
  concrete: {
    label: "Concrete",
    description: "Concrete, driveway, patio, walkway, and related exterior project campaigns.",
    recommendedCriteria: [
      "Owner-occupied or managed property",
      "Property type",
      "Lot/property characteristics from approved providers",
      "Older properties where relevant",
      "Geographic service radius",
    ],
    qualificationFields: ["propertyOwnerOrManager", "projectType", "timing", "approximateSize", "preferredContactTime"],
  },
  decks_outdoor: {
    label: "Decks & Outdoor Living",
    description: "Deck, patio enclosure, porch, and outdoor-living campaign targeting.",
    recommendedCriteria: [
      "Owner-occupied property",
      "Single-family or selected residential property types",
      "Property value where lawfully available",
      "Lot/property characteristics from approved providers",
      "Geographic service eligibility",
    ],
    qualificationFields: ["propertyOwner", "projectType", "timing", "approximateSize", "preferredContactTime"],
  },
  other: {
    label: "Other Industry",
    description: "Custom campaign profile for industries not yet covered by a preset.",
    recommendedCriteria: [
      "Geographic service eligibility",
      "Lawful property or business attributes",
      "Customer-defined non-sensitive criteria",
    ],
    qualificationFields: ["need", "timing", "preferredContactTime"],
  },
} as const;

export type IndustryKey = keyof typeof industryProfiles;

export const industryOptions = Object.entries(industryProfiles).map(([value, profile]) => ({
  value: value as IndustryKey,
  label: profile.label,
}));

export function getIndustryProfile(industry: IndustryKey) {
  return industryProfiles[industry];
}

export const prohibitedTargetingNotice =
  "APS targeting must not use protected-class or sensitive-personal-data criteria. Campaign filters should remain limited to lawful property, geography, business, and service-relevance signals.";
