import { createHash } from "node:crypto";
import { db } from "../db";
import type { Prisma } from "../../generated/prisma/client";
import { asRecord, SourceError } from "../lead-sources/contract";
import { json } from "../lead-sources/execution";
import {
  evidenceSchema,
  targetSchema,
  evaluatePolicy,
  POLICY_VERSION,
  type CheckEvidence,
} from "./policy";
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
type Tx = Prisma.TransactionClient;
type Target = ReturnType<typeof targetSchema.parse>;
async function context(tx: Tx, target: Target) {
  const campaign = await tx.campaign.findUnique({
    where: { id: target.campaignId },
    include: { customer: true, territories: { orderBy: { id: "asc" } } },
  });
  const contact = await tx.contact.findUnique({
    where: { id: target.contactId },
    include: { lead: true },
  });
  if (
    !campaign ||
    !contact ||
    contact.leadId !== target.leadId ||
    contact.lead.customerId !== campaign.customerId
  )
    throw new SourceError("TARGET_NOT_FOUND", "failed");
  const enrollment = await tx.campaignLead.findUnique({
    where: {
      campaignId_leadId: { campaignId: campaign.id, leadId: target.leadId },
    },
  });
  const fingerprint = digest({
    contactId: contact.id,
    type: contact.type,
    value: contact.normalizedValue,
    campaignId: campaign.id,
    customerId: campaign.customerId,
    industry: campaign.industry,
    targeting: campaign.targetingConfig,
    outreach: campaign.outreachConfig,
    territories: campaign.territories,
  });
  return { campaign, contact, enrollment, fingerprint };
}
export async function recordEvidence(raw: unknown) {
  const input = evidenceSchema.parse(raw);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(728411901)`;
    // Serialize retries globally by request ID; hash collisions only serialize extra requests.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.requestId}, 0))`;
    await tx.$queryRaw`SELECT id FROM "Contact" WHERE id = ${input.contactId}::uuid FOR UPDATE`;
    const { campaign, contact, fingerprint } = await context(tx, input);
    const requestDigest = digest(input);
    const existing = await tx.auditEvent.findFirst({
      where: {
        eventType: "compliance.evidence",
        payload: { path: ["requestId"], equals: input.requestId },
      },
    });
    if (existing) {
      if (asRecord(existing.payload).requestDigest !== requestDigest)
        throw new SourceError("IDEMPOTENCY_CONFLICT", "failed");
      return {
        evidenceId: existing.id,
        replayed: true,
        outreachAllowed: false,
      };
    }
    const now = new Date();
    const observed = new Date(input.observedAt);
    if (observed > now) throw new SourceError("FUTURE_EVIDENCE", "failed");
    if (
      input.action === "CHECK" ||
      (input.action === "CONSENT" && input.status === "GRANTED")
    ) {
      const expires =
        "expiresAt" in input && input.expiresAt
          ? new Date(input.expiresAt)
          : null;
      if (
        !expires ||
        expires <= now ||
        expires <= observed ||
        (input.action === "CHECK" && +expires - +observed > 31 * 86400000)
      )
        throw new SourceError("INVALID_EVIDENCE_EXPIRY", "failed");
    }
    if (input.action === "CONSENT")
      await tx.consent.create({
        data: {
          contactId: contact.id,
          channel: input.channel,
          status: input.status,
          source: "APS_REVIEW",
          grantedAt: input.status === "GRANTED" ? observed : null,
          revokedAt: input.status === "REVOKED" ? observed : null,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          evidence: json({
            policyVersion: POLICY_VERSION,
            fingerprint,
            evidenceRef: input.evidenceRef,
            requestId: input.requestId,
          }),
        },
      });
    if (
      input.action === "SUPPRESS" ||
      (input.action === "CONSENT" && input.status === "REVOKED")
    )
      await tx.suppression.create({
        data: {
          scope: "CUSTOMER",
          customerId: campaign.customerId,
          value: contact.normalizedValue,
          reason: input.action === "SUPPRESS" ? input.reason : "OPT_OUT",
        },
      });
    const event = await tx.auditEvent.create({
      data: {
        customerId: campaign.customerId,
        campaignId: campaign.id,
        leadId: input.leadId,
        eventType: "compliance.evidence",
        actorType: "INTERNAL_OPERATOR",
        actorId: input.actorRef,
        payload: json({
          ...input,
          policyVersion: POLICY_VERSION,
          fingerprint,
          requestDigest,
        }),
      },
    });
    return { evidenceId: event.id, replayed: false, outreachAllowed: false };
  });
}
export async function evaluateReadinessInTransaction(tx: Tx, raw: unknown) {
  const target = targetSchema.parse(raw);
  const { campaign, contact, enrollment, fingerprint } = await context(
    tx,
    target,
  );
  const now = new Date();
  const [events, consents, suppression] = await Promise.all([
    tx.auditEvent.findMany({
      where: {
        campaignId: campaign.id,
        leadId: target.leadId,
        eventType: "compliance.evidence",
        AND: [
          { payload: { path: ["contactId"], equals: contact.id } },
          { payload: { path: ["channel"], equals: target.channel } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 501,
    }),
    tx.consent.findMany({
      where: { contactId: contact.id, channel: target.channel },
      orderBy: { createdAt: "desc" },
      take: 501,
    }),
    tx.suppression.findFirst({
      where: {
        AND: [
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          {
            OR: [
              { scope: "GLOBAL" },
              { scope: "CUSTOMER", customerId: campaign.customerId },
              { scope: "CAMPAIGN", campaignId: campaign.id },
            ],
          },
          {
            OR: [
              { leadId: target.leadId },
              { contactId: contact.id },
              { value: contact.normalizedValue },
              { leadId: null, contactId: null, value: null },
            ],
          },
        ],
      },
    }),
  ]);
  const checks: CheckEvidence[] = [];
  for (const event of events) {
    const payload = asRecord(event.payload);
    if (
      payload.fingerprint !== fingerprint ||
      payload.policyVersion !== POLICY_VERSION
    )
      continue;
    const {
      fingerprint: _f,
      policyVersion: _p,
      requestDigest: _d,
      ...original
    } = payload;
    const parsed = evidenceSchema.safeParse(original);
    if (parsed.success && parsed.data.action === "CHECK")
      checks.push(parsed.data);
  }
  const config = asRecord(asRecord(campaign.outreachConfig).requestedChannels);
  const result = evaluatePolicy(
    {
      channel: target.channel,
      contactType: contact.type,
      isValid: contact.isValid,
      normalizedValue: contact.normalizedValue,
      active:
        campaign.customer.status === "ACTIVE" &&
        ["READY", "RUNNING"].includes(campaign.status),
      enrolled: !!enrollment && !enrollment.removedAt,
      leadStatus: contact.lead.status,
      channelRequested:
        config[
          target.channel === "SMS"
            ? "sms"
            : target.channel === "CALL"
              ? "calling"
              : "email"
        ] === true,
      campaignStart: campaign.startAt,
      campaignEnd: campaign.endAt,
      suppressed: !!suppression,
      checks,
      evidenceOverflow: events.length > 500 || consents.length > 500,
      consents: consents.map((c) => ({
        status: c.status,
        observedAt: (c.revokedAt ?? c.grantedAt ?? c.createdAt).toISOString(),
        expiresAt: c.expiresAt?.toISOString() ?? null,
        supported:
          c.source === "APS_REVIEW" &&
          asRecord(c.evidence).fingerprint === fingerprint &&
          asRecord(c.evidence).policyVersion === POLICY_VERSION &&
          typeof asRecord(c.evidence).evidenceRef === "string",
      })),
    },
    now,
  );
  await tx.auditEvent.create({
    data: {
      customerId: campaign.customerId,
      campaignId: campaign.id,
      leadId: target.leadId,
      eventType: "compliance.evaluated",
      actorType: "COMPLIANCE_REVIEW",
      payload: json({ ...target, ...result }),
    },
  });
  return { ...target, ...result };
}
export async function evaluateReadiness(raw: unknown) {
  const target = targetSchema.parse(raw);
  return db.$transaction((tx) => evaluateReadinessInTransaction(tx, target), {
    isolationLevel: "RepeatableRead",
  });
}
