import { randomUUID, createHash } from "node:crypto";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { SourceError, asRecord } from "../lead-sources/contract";
import { getSourceJob, json } from "../lead-sources/execution";
import {
  BatchDataEnrichmentAdapter,
  enrichmentEnabled,
  lookupSchema,
  type EnrichmentAdapter,
  type Lookup,
} from "./adapter";

type Tx = Prisma.TransactionClient;
const KIND = "ENRICH_CONTACTS",
  MAX_ATTEMPTS = 3;
const include = { campaign: { include: { customer: true } } } as const;
type Job = Prisma.ProviderJobGetPayload<{ include: typeof include }>;
async function event(tx: Tx, job: Job, name: string, payload: unknown = {}) {
  await tx.auditEvent.create({
    data: {
      customerId: job.campaign.customerId,
      campaignId: job.campaignId,
      leadId: lookupSchema.parse(job.input).leadId,
      actorType: "ENRICHMENT_WORKER",
      actorId: job.id,
      eventType: `enrichment.${name}`,
      payload: json(payload),
    },
  });
}
async function locked(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM "ProviderJob" WHERE id = ${id}::uuid FOR UPDATE`;
  const job = await tx.providerJob.findUnique({ where: { id }, include });
  if (!job) throw new SourceError("JOB_NOT_FOUND", "failed");
  if (job.jobType !== KIND || job.provider !== "BATCHDATA")
    throw new SourceError("INVALID_JOB_TYPE", "failed");
  lookupSchema.parse(job.input);
  return job;
}
async function context(
  tx: Tx,
  campaignId: string,
  leadId: string,
  propertyId: string,
): Promise<Lookup> {
  await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id = ${campaignId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Lead" WHERE id = ${leadId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT c.id FROM "Customer" c JOIN "Campaign" p ON p."customerId" = c.id WHERE p.id = ${campaignId}::uuid FOR UPDATE OF c`;
  await tx.$queryRaw`SELECT id FROM "CampaignLead" WHERE "campaignId" = ${campaignId}::uuid AND "leadId" = ${leadId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Property" WHERE id = ${propertyId}::uuid AND "leadId" = ${leadId}::uuid FOR UPDATE`;
  const enrollment = await tx.campaignLead.findUnique({
    where: { campaignId_leadId: { campaignId, leadId } },
    include: { campaign: { include: { customer: true } }, lead: true },
  });
  if (
    !enrollment ||
    enrollment.removedAt ||
    enrollment.lead.customerId !== enrollment.campaign.customerId
  )
    throw new SourceError("LEAD_NOT_ENROLLED", "blocked");
  if (
    !["READY", "RUNNING"].includes(enrollment.campaign.status) ||
    enrollment.campaign.customer.status !== "ACTIVE"
  )
    throw new SourceError("CAMPAIGN_INACTIVE", "blocked");
  if (["SUPPRESSED", "INVALID", "LOST"].includes(enrollment.lead.status))
    throw new SourceError("LEAD_NOT_ENRICHABLE", "blocked");
  const suppression = await tx.suppression.findFirst({
    where: {
      AND: [
        { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        {
          OR: [
            { leadId, contactId: null, value: null },
            { campaignId, leadId: null, contactId: null, value: null },
            {
              customerId: enrollment.campaign.customerId,
              scope: "CUSTOMER",
              leadId: null,
              contactId: null,
              value: null,
            },
            { scope: "GLOBAL", leadId: null, contactId: null, value: null },
          ],
        },
      ],
    },
  });
  if (suppression) throw new SourceError("LEAD_SUPPRESSED", "blocked");
  const property = await tx.property.findFirst({
    where: { id: propertyId, leadId },
  });
  if (!property) throw new SourceError("PROPERTY_NOT_FOUND", "blocked");
  return lookupSchema.parse({
    leadId,
    propertyId,
    street: [property.address1, property.address2].filter(Boolean).join(" "),
    city: property.city,
    state: property.state.toUpperCase(),
    zip: property.postalCode,
  });
}
export async function queueEnrichment(
  campaignId: string,
  leadId: string,
  propertyId: string,
) {
  return db.$transaction(async (tx) => {
    const input = await context(tx, campaignId, leadId, propertyId);
    // One initial enrichment per permanent lead, reused across its campaigns.
    // Later refreshes require an explicit, separately budgeted feature.
    const key = `enrichment:v1:${leadId}`;
    const prior = await tx.providerJob.findUnique({
      where: { idempotencyKey: key },
    });
    if (prior) {
      if (asRecord(prior.input).propertyId !== propertyId)
        throw new SourceError("ENRICHMENT_PROPERTY_CONFLICT", "failed");
      return {
        jobId: prior.id,
        campaignId: prior.campaignId,
        leadId,
        status: prior.status,
        reused: true,
      };
    }
    const job = await tx.providerJob.create({
      data: {
        campaignId,
        provider: "BATCHDATA",
        jobType: KIND,
        idempotencyKey: key,
        input: json(input),
      },
      include,
    });
    await event(tx, job, "queued", {
      propertyId,
      requiresComplianceReview: true,
    });
    return {
      jobId: job.id,
      campaignId,
      leadId,
      status: job.status,
      reused: false,
    };
  });
}
async function block(tx: Tx, job: Job, code: string) {
  await tx.providerJob.update({
    where: { id: job.id },
    data: {
      status: "BLOCKED",
      error: code,
      leaseToken: null,
      leaseExpiresAt: null,
      nextAttemptAt: null,
    },
  });
  await event(tx, job, "blocked", { code });
}
async function claim(id: string) {
  return db.$transaction(async (tx) => {
    const job = await locked(tx, id);
    if (job.status === "RUNNING") {
      if (job.leaseExpiresAt && job.leaseExpiresAt <= new Date())
        await block(tx, job, "PROVIDER_OUTCOME_UNKNOWN");
      return null;
    }
    if (
      job.status !== "QUEUED" ||
      (job.nextAttemptAt && job.nextAttemptAt > new Date())
    )
      return null;
    if (!enrichmentEnabled()) {
      await block(tx, job, "ENRICHMENT_DISABLED");
      return null;
    }
    if (job.attemptCount >= MAX_ATTEMPTS) {
      await block(tx, job, "RETRIES_EXHAUSTED");
      return null;
    }
    const input = lookupSchema.parse(job.input);
    try {
      const current = await context(
        tx,
        job.campaignId,
        input.leadId,
        input.propertyId,
      );
      if (JSON.stringify(current) !== JSON.stringify(input))
        throw new SourceError("PROPERTY_CHANGED", "blocked");
    } catch (e) {
      if (!(e instanceof SourceError)) throw e;
      await block(tx, job, e.code);
      return null;
    }
    const token = randomUUID();
    await tx.providerJob.update({
      where: { id },
      data: {
        status: "RUNNING",
        leaseToken: token,
        leaseExpiresAt: new Date(Date.now() + 120000),
        attemptCount: { increment: 1 },
        startedAt: job.startedAt ?? new Date(),
        nextAttemptAt: null,
        error: null,
      },
    });
    await event(tx, job, "started", { attempt: job.attemptCount + 1 });
    return { ...job, leaseToken: token };
  });
}
export async function executeEnrichment(
  id: string,
  adapter: EnrichmentAdapter = new BatchDataEnrichmentAdapter(),
) {
  const job = await claim(id);
  if (!job) return getSourceJob(id);
  const input = lookupSchema.parse(job.input);
  let responseReceived = false;
  try {
    const result = await adapter.lookup(input, job.id);
    responseReceived = true;
    await db.$transaction(
      async (tx) => {
        const current = await locked(tx, id);
        if (
          current.status !== "RUNNING" ||
          current.leaseToken !== job.leaseToken
        )
          throw new SourceError("LEASE_LOST", "blocked");
        const latest = await context(
          tx,
          job.campaignId,
          input.leadId,
          input.propertyId,
        );
        if (
          !enrichmentEnabled() ||
          JSON.stringify(latest) !== JSON.stringify(input)
        )
          throw new SourceError("CONTEXT_CHANGED", "blocked");
        let added = 0;
        for (const c of result.contacts) {
          // Serialize by lead and match by normalized value across phone types.
          // Never overwrite validity, existing contact details or consent evidence.
          let contact = await tx.contact.findFirst({
            where: { leadId: input.leadId, normalizedValue: c.value },
          });
          if (!contact) {
            contact = await tx.contact.create({
              data: {
                leadId: input.leadId,
                type: c.type,
                value: c.value,
                normalizedValue: c.value,
                metadata: {
                  provider: "BATCHDATA",
                  enrichmentJobId: id,
                  requiresComplianceReview: true,
                  verificationStatus: "UNVERIFIED",
                },
              },
            });
            added++;
          }
          if (c.dnc || c.restricted) {
            const reason = c.dnc ? "DNC" : "LEGAL";
            const existing = await tx.suppression.findFirst({
              where: {
                contactId: contact.id,
                reason,
                OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
              },
            });
            if (!existing)
              await tx.suppression.create({
                data: {
                  scope: "CUSTOMER",
                  customerId: current.campaign.customerId,
                  leadId: input.leadId,
                  contactId: contact.id,
                  value: c.value,
                  reason,
                  notes: "BatchData enrichment restriction; requires review",
                },
              });
          }
        }
        const output = {
          leadId: input.leadId,
          matched: result.matched,
          contactsAdded: added,
          contactsReturned: result.contacts.length,
          rejected: result.rejected,
          requiresComplianceReview: true,
          completionReason: !result.matched
            ? "NO_PROPERTY_MATCH"
            : result.contacts.length
              ? "CONTACTS_IMPORTED"
              : "NO_CONTACT_MATCH",
        };
        await tx.sourceReceipt.create({
          data: {
            jobId: id,
            key: "enrichment:v1",
            digest: createHash("sha256")
              .update(JSON.stringify(output))
              .digest("hex"),
            result: json(output),
          },
        });
        await tx.providerJob.update({
          where: { id },
          data: {
            status: "SUCCEEDED",
            output: json(output),
            finishedAt: new Date(),
            error: null,
            leaseToken: null,
            leaseExpiresAt: null,
            nextAttemptAt: null,
          },
        });
        await event(tx, current, "succeeded", output);
      },
      { timeout: 30000 },
    );
  } catch (error) {
    const e =
      error instanceof SourceError
        ? error
        : new SourceError("ENRICHMENT_EXECUTION_ERROR", "blocked");
    await db.$transaction(async (tx) => {
      const current = await locked(tx, id);
      if (current.status !== "RUNNING" || current.leaseToken !== job.leaseToken)
        return;
      const retry =
        !responseReceived &&
        e.disposition === "retry" &&
        current.attemptCount < MAX_ATTEMPTS;
      if (!retry) {
        await block(
          tx,
          current,
          responseReceived ? "RESPONSE_NOT_COMMITTED_REVIEW_REQUIRED" : e.code,
        );
        return;
      }
      await tx.providerJob.update({
        where: { id },
        data: {
          status: "QUEUED",
          error: e.code,
          leaseToken: null,
          leaseExpiresAt: null,
          nextAttemptAt: new Date(
            Date.now() +
              Math.max(e.retryAfter, 30 * 2 ** current.attemptCount) * 1000,
          ),
        },
      });
      await event(tx, current, "retry_scheduled", {
        code: e.code,
        attempt: current.attemptCount,
      });
    });
  }
  return getSourceJob(id);
}
export async function retryEnrichment(
  id: string,
  acknowledgePossibleCharge: boolean,
) {
  await db.$transaction(async (tx) => {
    const job = await locked(tx, id);
    if (!enrichmentEnabled())
      throw new SourceError("ENRICHMENT_DISABLED", "blocked");
    if (job.status !== "BLOCKED" && job.status !== "FAILED")
      throw new SourceError("INVALID_JOB_STATUS", "failed");
    if (job.attemptCount > 0 && !acknowledgePossibleCharge)
      throw new SourceError("POSSIBLE_REPEAT_CHARGE_ACK_REQUIRED", "blocked");
    const input = lookupSchema.parse(job.input);
    const current = await context(
      tx,
      job.campaignId,
      input.leadId,
      input.propertyId,
    );
    if (JSON.stringify(current) !== JSON.stringify(input))
      throw new SourceError("PROPERTY_CHANGED", "blocked");
    await tx.providerJob.update({
      where: { id },
      data: {
        status: "QUEUED",
        error: null,
        attemptCount: 0,
        nextAttemptAt: null,
        leaseToken: null,
        leaseExpiresAt: null,
        finishedAt: null,
      },
    });
    await event(tx, job, "retry_requested", { acknowledgePossibleCharge });
  });
  return getSourceJob(id);
}
export async function runEnrichmentWorker() {
  if (!enrichmentEnabled()) return { enabled: false, job: null };
  const now = new Date();
  const job = await db.providerJob.findFirst({
    where: {
      jobType: KIND,
      provider: "BATCHDATA",
      campaign: {
        status: { in: ["READY", "RUNNING"] },
        customer: { status: "ACTIVE" },
      },
      OR: [
        {
          status: "QUEUED",
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
        { status: "RUNNING", leaseExpiresAt: { lte: now } },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return { enabled: true, job: job ? await executeEnrichment(job.id) : null };
}
