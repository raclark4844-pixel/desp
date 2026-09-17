import { randomUUID, createHash } from "node:crypto";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { BatchDataAdapter } from "./adapters/batchdata";
import {
  asRecord,
  propertyRecordSchema,
  SourceError,
  type LeadSourceAdapter,
  type PropertyRecord,
  type SourceContext,
  type SourceCursor,
} from "./contract";
import {
  matchesTarget,
  propertyIdentity,
  validateTargeting,
} from "./normalization";

type Tx = Prisma.TransactionClient;
export const json = (v: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(v));
const include = {
  campaign: { include: { territories: true, customer: true } },
  leadSource: true,
} as const;
type Job = Prisma.ProviderJobGetPayload<{ include: typeof include }>;
const MAX_ATTEMPTS = 5,
  MAX_PAGES = 100,
  PAGE_SIZE = 100;
function sourceContext(job: Job): SourceContext {
  const c = job.campaign;
  return {
    campaignId: c.id,
    customerId: c.customerId,
    industry: c.industry,
    desiredLeadCount: c.desiredLeadCount,
    residential: c.residential,
    commercial: c.commercial,
    targetingConfig: c.targetingConfig,
    territories: c.territories.map((t) => ({
      type: t.type,
      value: t.value,
      state: t.state,
      county: t.county,
    })),
  };
}
function isActive(job: Job) {
  return (
    ["READY", "RUNNING"].includes(job.campaign.status) &&
    job.campaign.customer.status === "ACTIVE" &&
    job.leadSource?.isActive === true
  );
}
function assertSource(job: Job) {
  if (!["SOURCE_LEADS", "SOURCE_LEADS_MANUAL"].includes(job.jobType))
    throw new SourceError("INVALID_JOB_TYPE", "failed");
}
async function audit(
  tx: Tx,
  job: Job,
  eventType: string,
  payload: unknown = {},
  leadId?: string,
) {
  await tx.auditEvent.create({
    data: {
      customerId: job.campaign.customerId,
      campaignId: job.campaignId,
      leadId,
      actorType: "SOURCE_WORKER",
      actorId: job.id,
      eventType,
      payload: json(payload),
    },
  });
}
async function lockedJob(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM "ProviderJob" WHERE id = ${id}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT c.id FROM "Campaign" c JOIN "ProviderJob" j ON j."campaignId" = c.id WHERE j.id = ${id}::uuid FOR UPDATE OF c`;
  const job = await tx.providerJob.findUnique({ where: { id }, include });
  if (!job) throw new SourceError("JOB_NOT_FOUND", "failed");
  assertSource(job);
  return job;
}
function progress(job: Job) {
  const output = asRecord(job.output),
    c = asRecord(output.cursor);
  return {
    cursor: {
      territory: Number(c.territory ?? 0),
      skip: Number(c.skip ?? 0),
      pages: Number(c.pages ?? 0),
    } as SourceCursor,
    ingested: Number(output.ingested ?? 0),
    rejected: Number(output.rejected ?? 0),
    scanned: Number(output.scanned ?? 0),
  };
}
export async function getSourceJob(id: string) {
  const job = await db.providerJob.findUnique({
    where: { id },
    select: {
      id: true,
      campaignId: true,
      provider: true,
      jobType: true,
      status: true,
      attemptCount: true,
      nextAttemptAt: true,
      leaseExpiresAt: true,
      error: true,
      output: true,
      startedAt: true,
      finishedAt: true,
    },
  });
  if (!job) throw new SourceError("JOB_NOT_FOUND", "failed");
  return job;
}
async function claim(id: string) {
  return db.$transaction(async (tx) => {
    const job = await lockedJob(tx, id);
    if (
      job.status === "SUCCEEDED" ||
      job.status === "CANCELLED" ||
      job.status === "FAILED" ||
      job.status === "BLOCKED" ||
      job.status === "WAITING_MANUAL"
    )
      return null;
    if (!isActive(job)) {
      await tx.providerJob.update({
        where: { id },
        data: { status: "BLOCKED", error: "CAMPAIGN_OR_SOURCE_INACTIVE" },
      });
      await audit(tx, job, "lead_source.blocked", {
        code: "CAMPAIGN_OR_SOURCE_INACTIVE",
      });
      return null;
    }
    if (
      job.status === "RUNNING" &&
      (!job.leaseExpiresAt || job.leaseExpiresAt > new Date())
    )
      return null;
    if (job.nextAttemptAt && job.nextAttemptAt > new Date()) return null;
    if (job.attemptCount >= MAX_ATTEMPTS) {
      await tx.providerJob.update({
        where: { id },
        data: {
          status: "FAILED",
          error: "RETRIES_EXHAUSTED",
          finishedAt: new Date(),
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      await audit(tx, job, "lead_source.failed", { code: "RETRIES_EXHAUSTED" });
      return null;
    }
    if (job.provider === "PROPWIRE") {
      await tx.providerJob.update({
        where: { id },
        data: { status: "WAITING_MANUAL", error: null },
      });
      await audit(tx, job, "lead_source.manual_required");
      return null;
    }
    if (job.provider !== "BATCHDATA") {
      await tx.providerJob.update({
        where: { id },
        data: { status: "BLOCKED", error: "PROVIDER_NOT_IMPLEMENTED" },
      });
      await audit(tx, job, "lead_source.blocked", {
        code: "PROVIDER_NOT_IMPLEMENTED",
      });
      return null;
    }
    const enrolled = await tx.campaignLead.count({
      where: { campaignId: job.campaignId },
    });
    if (enrolled >= (job.campaign.desiredLeadCount ?? 100)) {
      await tx.providerJob.update({
        where: { id },
        data: {
          status: "SUCCEEDED",
          finishedAt: new Date(),
          output: json({
            ...asRecord(job.output),
            completionReason: "TARGET_REACHED",
          }),
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      await audit(tx, job, "lead_source.succeeded", {
        completionReason: "TARGET_REACHED",
      });
      return null;
    }
    const token = randomUUID();
    await tx.providerJob.update({
      where: { id },
      data: {
        status: "RUNNING",
        leaseToken: token,
        leaseExpiresAt: new Date(Date.now() + 120000),
        startedAt: job.startedAt ?? new Date(),
        attemptCount: { increment: 1 },
        nextAttemptAt: null,
        error: null,
      },
    });
    await audit(tx, job, "lead_source.started", {
      attempt: job.attemptCount + 1,
      recovered: job.status === "RUNNING",
    });
    return { ...job, leaseToken: token, attemptCount: job.attemptCount + 1 };
  });
}
async function ingest(tx: Tx, job: Job, records: PropertyRecord[]) {
  // Serialize all jobs for a campaign so combined provider results respect its cap.
  await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id = ${job.campaignId}::uuid FOR UPDATE`;
  let enrolled = await tx.campaignLead.count({
    where: { campaignId: job.campaignId },
  });
  let added = 0;
  for (const p of records) {
    if (enrolled >= (job.campaign.desiredLeadCount ?? 100)) break;
    const identityKey = propertyIdentity(p);
    const { externalRef, ...property } = p;
    const lead = await tx.lead.upsert({
      where: {
        customerId_identityKey: {
          customerId: job.campaign.customerId,
          identityKey,
        },
      },
      update: {},
      create: {
        customerId: job.campaign.customerId,
        leadSourceId: job.leadSourceId,
        identityKey,
        externalRef: p.externalRef,
        status: "NEW",
        sourcePayload: json({ provider: job.provider, jobId: job.id }),
        properties: {
          create: { ...property, attributes: { identityVersion: 1 } },
        },
      },
    });
    // Never reset an existing lead's status, consents or suppressions.
    const result = await tx.campaignLead.createMany({
      data: [
        {
          campaignId: job.campaignId,
          leadId: lead.id,
          metadata: json({
            sourceJobId: job.id,
            provider: job.provider,
            externalRef: p.externalRef,
            requiresComplianceReview: true,
          }),
        },
      ],
      skipDuplicates: true,
    });
    if (result.count) {
      enrolled++;
      added++;
      await audit(
        tx,
        job,
        "lead_source.lead_ingested",
        { provider: job.provider, requiresComplianceReview: true },
        lead.id,
      );
    }
  }
  return { added, enrolled };
}
async function fail(job: Job, error: unknown) {
  const e =
    error instanceof SourceError
      ? error
      : new SourceError("SOURCE_EXECUTION_ERROR", "retry");
  await db.$transaction(async (tx) => {
    const current = await lockedJob(tx, job.id);
    if (current.status !== "RUNNING" || current.leaseToken !== job.leaseToken)
      return;
    const retry =
      e.disposition === "retry" && current.attemptCount < MAX_ATTEMPTS;
    const status = retry
      ? "QUEUED"
      : e.disposition === "blocked"
        ? "BLOCKED"
        : "FAILED";
    const delay = Math.max(
      e.retryAfter,
      Math.min(900, 30 * 2 ** (current.attemptCount - 1)),
    );
    await tx.providerJob.update({
      where: { id: job.id },
      data: {
        status,
        error: e.code,
        leaseToken: null,
        leaseExpiresAt: null,
        nextAttemptAt: retry ? new Date(Date.now() + delay * 1000) : null,
        finishedAt: status === "FAILED" ? new Date() : null,
      },
    });
    await audit(
      tx,
      current,
      retry
        ? "lead_source.retry_scheduled"
        : `lead_source.${status.toLowerCase()}`,
      {
        code: e.code,
        attempt: current.attemptCount,
        retryAfterSeconds: retry ? delay : null,
      },
    );
  });
}
export async function executeSourceJob(
  id: string,
  adapter: LeadSourceAdapter = new BatchDataAdapter(),
) {
  const job = await claim(id);
  if (!job) return getSourceJob(id);
  try {
    if (adapter.key !== job.provider)
      throw new SourceError("ADAPTER_MISMATCH", "failed");
    const context = sourceContext(job);
    validateTargeting(context);
    const p = progress(job);
    if (p.cursor.pages >= MAX_PAGES)
      throw new SourceError(
        "PAGE_BUDGET_REACHED_USE_MANUAL_FALLBACK",
        "blocked",
      );
    const page = await adapter.fetchPage(context, p.cursor, PAGE_SIZE);
    const normalized: PropertyRecord[] = [];
    let rejected = 0,
      valid = 0;
    for (const raw of page.records) {
      try {
        const r = adapter.normalize(raw);
        valid++;
        if (matchesTarget(r, context)) normalized.push(r);
        else rejected++;
      } catch {
        rejected++;
      }
    }
    if (page.records.length && !valid)
      throw new SourceError("INVALID_PROVIDER_RECORDS", "blocked");
    await db.$transaction(
      async (tx) => {
        const current = await lockedJob(tx, id);
        if (
          current.status !== "RUNNING" ||
          current.leaseToken !== job.leaseToken
        )
          throw new SourceError("LEASE_LOST", "failed");
        if (!isActive(current))
          throw new SourceError("CAMPAIGN_OR_SOURCE_INACTIVE", "blocked");
        if (JSON.stringify(sourceContext(current)) !== JSON.stringify(context))
          throw new SourceError("CAMPAIGN_CHANGED_DURING_EXECUTION", "blocked");
        const key = `page:${p.cursor.territory}:${p.cursor.skip}`;
        const existing = await tx.sourceReceipt.findUnique({
          where: { jobId_key: { jobId: id, key } },
        });
        if (existing)
          throw new SourceError("CURSOR_ALREADY_COMMITTED", "failed");
        const result = await ingest(tx, current, normalized);
        const done =
          !page.nextCursor ||
          result.enrolled >= (job.campaign.desiredLeadCount ?? 100);
        const output = {
          cursor: page.nextCursor,
          ingested: p.ingested + result.added,
          rejected: p.rejected + rejected,
          scanned: p.scanned + page.records.length,
          completionReason: done
            ? page.nextCursor
              ? "TARGET_REACHED"
              : "SOURCE_EXHAUSTED"
            : null,
        };
        await tx.sourceReceipt.create({
          data: {
            jobId: id,
            key,
            digest: createHash("sha256")
              .update(JSON.stringify(normalized))
              .digest("hex"),
            result: json(output),
          },
        });
        await tx.providerJob.update({
          where: { id },
          data: {
            status: done ? "SUCCEEDED" : "QUEUED",
            output: json(output),
            error: null,
            attemptCount: 0,
            leaseToken: null,
            leaseExpiresAt: null,
            nextAttemptAt: null,
            finishedAt: done ? new Date() : null,
          },
        });
        await audit(
          tx,
          current,
          done ? "lead_source.succeeded" : "lead_source.page_ingested",
          output,
        );
      },
      { timeout: 30000 },
    );
  } catch (error) {
    await fail(job, error);
  }
  return getSourceJob(id);
}
export async function importManualPage(
  id: string,
  key: string,
  raw: unknown[],
  final: boolean,
) {
  const records = raw.map((r) => propertyRecordSchema.parse(r));
  const digest = createHash("sha256")
    .update(JSON.stringify({ records, final }))
    .digest("hex");
  return db.$transaction(
    async (tx) => {
      const job = await lockedJob(tx, id);
      if (job.provider !== "PROPWIRE")
        throw new SourceError("NOT_MANUAL_PROVIDER", "failed");
      const prior = await tx.sourceReceipt.findUnique({
        where: { jobId_key: { jobId: id, key: `manual:${key}` } },
      });
      if (prior) {
        if (prior.digest !== digest)
          throw new SourceError("IDEMPOTENCY_KEY_CONFLICT", "failed");
        return prior.result;
      }
      if (!["QUEUED", "WAITING_MANUAL"].includes(job.status))
        throw new SourceError("INVALID_JOB_STATUS", "failed");
      if (!isActive(job))
        throw new SourceError("CAMPAIGN_OR_SOURCE_INACTIVE", "blocked");
      const context = sourceContext(job);
      validateTargeting(context);
      const eligible = records.filter((r) => matchesTarget(r, context));
      const result = await ingest(tx, job, eligible),
        p = progress(job);
      const done =
        final || result.enrolled >= (job.campaign.desiredLeadCount ?? 100);
      const output = {
        ingested: p.ingested + result.added,
        rejected: p.rejected + records.length - eligible.length,
        scanned: p.scanned + records.length,
        completionReason: done
          ? final
            ? "MANUAL_EXPORT_COMPLETE"
            : "TARGET_REACHED"
          : null,
      };
      await tx.sourceReceipt.create({
        data: { jobId: id, key: `manual:${key}`, digest, result: json(output) },
      });
      await tx.providerJob.update({
        where: { id },
        data: {
          status: done ? "SUCCEEDED" : "WAITING_MANUAL",
          output: json(output),
          error: null,
          startedAt: job.startedAt ?? new Date(),
          finishedAt: done ? new Date() : null,
        },
      });
      await audit(
        tx,
        job,
        done ? "lead_source.succeeded" : "lead_source.manual_imported",
        output,
      );
      return output;
    },
    { timeout: 30000 },
  );
}
export async function retrySourceJob(id: string) {
  await db.$transaction(async (tx) => {
    const job = await lockedJob(tx, id);
    if (!["BLOCKED", "FAILED"].includes(job.status))
      throw new SourceError("INVALID_JOB_STATUS", "failed");
    if (!isActive(job))
      throw new SourceError("CAMPAIGN_OR_SOURCE_INACTIVE", "blocked");
    await tx.providerJob.update({
      where: { id },
      data: {
        status: "QUEUED",
        attemptCount: 0,
        error: null,
        nextAttemptAt: null,
        leaseToken: null,
        leaseExpiresAt: null,
        finishedAt: null,
      },
    });
    await audit(tx, job, "lead_source.retry_requested");
  });
  return getSourceJob(id);
}
export async function manualFallback(id: string) {
  return db.$transaction(async (tx) => {
    const job = await lockedJob(tx, id);
    const prior = await tx.providerJob.findUnique({
      where: { idempotencyKey: `fallback:${id}` },
    });
    if (prior)
      return {
        jobId: prior.id,
        campaignId: prior.campaignId,
        status: prior.status,
      };
    if (
      job.provider === "PROPWIRE" ||
      !["QUEUED", "BLOCKED", "FAILED"].includes(job.status)
    )
      throw new SourceError("INVALID_JOB_STATUS", "failed");
    if (!isActive(job))
      throw new SourceError("CAMPAIGN_OR_SOURCE_INACTIVE", "blocked");
    const source = await tx.leadSource.upsert({
      where: { key: "propwire" },
      update: {},
      create: {
        key: "propwire",
        name: "PropWire",
        providerType: "PROPERTY_DATA",
        config: { executionMode: "MANUAL_EXPORT" },
      },
    });
    if (!source.isActive)
      throw new SourceError("CAMPAIGN_OR_SOURCE_INACTIVE", "blocked");
    const fallback = await tx.providerJob.create({
      data: {
        campaignId: job.campaignId,
        leadSourceId: source.id,
        provider: "PROPWIRE",
        jobType: "SOURCE_LEADS_MANUAL",
        status: "WAITING_MANUAL",
        idempotencyKey: `fallback:${id}`,
        input: { parentJobId: id },
      },
    });
    await tx.providerJob.update({
      where: { id },
      data: {
        status: "CANCELLED",
        finishedAt: new Date(),
        leaseToken: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
      },
    });
    await audit(tx, job, "lead_source.manual_fallback_created", {
      fallbackJobId: fallback.id,
    });
    return {
      jobId: fallback.id,
      campaignId: fallback.campaignId,
      status: fallback.status,
    };
  });
}
