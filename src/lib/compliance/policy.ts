import { z } from "zod";

export const POLICY_VERSION = "aps-review-v1";
export const channelSchema = z.enum(["SMS", "CALL", "EMAIL"]);
export type Channel = z.infer<typeof channelSchema>;
export const checkSchema = z.enum([
  "CONTACT_OWNERSHIP",
  "DNC",
  "REASSIGNED_NUMBER",
  "EMAIL_DELIVERABILITY",
  "JURISDICTION_REVIEW",
]);
export type Check = z.infer<typeof checkSchema>;
export const targetSchema = z
  .object({
    campaignId: z.string().uuid(),
    leadId: z.string().uuid(),
    contactId: z.string().uuid(),
    channel: channelSchema,
  })
  .strict();
const recordBase = targetSchema.extend({
  requestId: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/),
  actorRef: z.string().trim().min(1).max(100),
  evidenceRef: z.string().trim().min(1).max(200),
  observedAt: z.iso.datetime(),
});
export const evidenceSchema = z.discriminatedUnion("action", [
  recordBase
    .extend({
      action: z.literal("CHECK"),
      check: checkSchema,
      outcome: z.enum(["PASS", "FAIL", "UNKNOWN"]),
      expiresAt: z.iso.datetime(),
    })
    .strict(),
  recordBase
    .extend({
      action: z.literal("CONSENT"),
      status: z.enum(["GRANTED", "REVOKED"]),
      expiresAt: z.iso.datetime().optional(),
    })
    .strict(),
  recordBase
    .extend({
      action: z.literal("SUPPRESS"),
      reason: z.enum([
        "DNC",
        "OPT_OUT",
        "WRONG_NUMBER",
        "COMPLAINT",
        "INVALID_CONTACT",
        "INTERNAL",
        "LEGAL",
        "OTHER",
      ]),
    })
    .strict(),
]);
export type EvidenceInput = z.infer<typeof evidenceSchema>;
export type CheckEvidence = {
  check: Check;
  outcome: "PASS" | "FAIL" | "UNKNOWN";
  observedAt: string;
  expiresAt: string;
};
export type ConsentEvidence = {
  status: string;
  observedAt: string;
  expiresAt: string | null;
  supported: boolean;
};
export type PolicyInput = {
  channel: Channel;
  contactType: string;
  isValid: boolean | null;
  normalizedValue: string;
  active: boolean;
  enrolled: boolean;
  leadStatus: string;
  channelRequested: boolean;
  campaignStart: Date | null;
  campaignEnd: Date | null;
  suppressed: boolean;
  checks: CheckEvidence[];
  consents: ConsentEvidence[];
  evidenceOverflow: boolean;
};
export function evaluatePolicy(input: PolicyInput, now = new Date()) {
  const reasons: string[] = [];
  if (!input.active) reasons.push("CAMPAIGN_OR_CUSTOMER_INACTIVE");
  if (!input.enrolled) reasons.push("LEAD_NOT_ENROLLED");
  if (["SUPPRESSED", "INVALID", "LOST"].includes(input.leadStatus))
    reasons.push("LEAD_STATUS_BLOCKED");
  if (!input.channelRequested) reasons.push("CHANNEL_NOT_REQUESTED");
  if (input.campaignStart && input.campaignStart > now)
    reasons.push("CAMPAIGN_NOT_STARTED");
  if (input.campaignEnd && input.campaignEnd <= now)
    reasons.push("CAMPAIGN_ENDED");
  const phone = /^\+1[2-9]\d{2}[2-9]\d{6}$/.test(input.normalizedValue);
  const compatible =
    input.channel === "EMAIL"
      ? input.contactType === "EMAIL" &&
        z.email().safeParse(input.normalizedValue).success
      : input.channel === "SMS"
        ? input.contactType === "MOBILE" && phone
        : ["MOBILE", "LANDLINE", "OTHER"].includes(input.contactType) && phone;
  if (!compatible) reasons.push("CONTACT_CHANNEL_MISMATCH");
  if (input.isValid === false) reasons.push("CONTACT_INVALID");
  if (input.suppressed) reasons.push("SUPPRESSION_ACTIVE");
  if (input.evidenceOverflow) reasons.push("EVIDENCE_LIMIT_REVIEW_REQUIRED");
  // Explicit consent on every channel is an APS conservative policy, not a
  // statement that every channel/jurisdiction legally requires identical consent.
  const consent = [...input.consents].sort(
    (a, b) =>
      Date.parse(b.observedAt) - Date.parse(a.observedAt) ||
      Number(b.status === "REVOKED") - Number(a.status === "REVOKED"),
  )[0];
  if (
    !consent ||
    consent.status !== "GRANTED" ||
    !consent.supported ||
    !Number.isFinite(Date.parse(consent.observedAt)) ||
    Date.parse(consent.observedAt) > now.getTime() ||
    !consent.expiresAt ||
    Date.parse(consent.expiresAt) <= now.getTime() ||
    !Number.isFinite(Date.parse(consent.expiresAt))
  )
    reasons.push("CONSENT_MISSING_REVOKED_OR_EXPIRED");
  const required: Check[] = [
    "CONTACT_OWNERSHIP",
    "JURISDICTION_REVIEW",
    ...(input.channel === "EMAIL"
      ? ["EMAIL_DELIVERABILITY" as const]
      : ["DNC" as const, "REASSIGNED_NUMBER" as const]),
  ];
  for (const check of required) {
    const evidence = input.checks
      .filter((e) => e.check === check)
      .sort(
        (a, b) =>
          Date.parse(b.observedAt) - Date.parse(a.observedAt) ||
          Number(b.outcome !== "PASS") - Number(a.outcome !== "PASS"),
      )[0];
    if (!evidence) {
      reasons.push(`${check}_MISSING`);
      continue;
    }
    if (evidence.outcome !== "PASS") reasons.push(`${check}_NOT_PASSED`);
    else if (
      !Number.isFinite(Date.parse(evidence.observedAt)) ||
      Date.parse(evidence.observedAt) > now.getTime() ||
      !Number.isFinite(Date.parse(evidence.expiresAt)) ||
      Date.parse(evidence.expiresAt) <= now.getTime() ||
      Date.parse(evidence.expiresAt) - Date.parse(evidence.observedAt) >
        31 * 86400000
    )
      reasons.push(`${check}_STALE`);
  }
  return {
    policyVersion: POLICY_VERSION,
    channel: input.channel,
    reviewStatus: reasons.length ? "BLOCKED" : "READY_FOR_REVIEW",
    reasons,
    outreachAllowed: false as const,
    outreachBlockReason: "OUTREACH_NOT_IMPLEMENTED",
    evaluatedAt: now.toISOString(),
  };
}
