// No vendor is declared connected until its adapter, credential and contract
// have been verified. BatchData enrichment is not consent or legal clearance.
export const verificationRequirements = [
  {
    name: "Do-not-call screening",
    capability: "DNC",
    status: "NOT_CONNECTED",
    required: "Provider name, API entitlement and server-side credential",
  },
  {
    name: "Reassigned-number screening",
    capability: "REASSIGNED_NUMBER",
    status: "NOT_CONNECTED",
    required: "Provider name, API entitlement and server-side credential",
  },
  {
    name: "Contact ownership",
    capability: "CONTACT_OWNERSHIP",
    status: "EVIDENCE_REQUIRED",
    required: "Dated evidence that the contact belongs to the intended person",
  },
  {
    name: "Email deliverability",
    capability: "EMAIL_DELIVERABILITY",
    status: "NOT_CONNECTED",
    required: "Verification provider and server-side credential",
  },
  {
    name: "Jurisdiction review",
    capability: "JURISDICTION_REVIEW",
    status: "EVIDENCE_REQUIRED",
    required: "Applicable campaign/channel review by an authorized reviewer",
  },
] as const;
