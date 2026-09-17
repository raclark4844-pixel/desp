import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import {
  executeSourceJob,
  importManualPage,
  manualFallback,
  retrySourceJob,
} from "../src/lib/lead-sources/execution";
import { dispatchLeadSourceJob } from "../src/lib/lead-sources/service";
import {
  propertyRecordSchema,
  SourceError,
  type LeadSourceAdapter,
} from "../src/lib/lead-sources/contract";
const enabled = process.env.APS_ISOLATED_TEST_DB === "true";
test(
  "source execution against isolated Postgres: concurrency, leases, retries, lineage and no outreach",
  { skip: !enabled },
  async () => {
    const customer = await db.customer.create({
      data: {
        name: "Step4 synthetic test",
        slug: `step4-test-${randomUUID()}`,
      },
    });
    const source = await db.leadSource.upsert({
      where: { key: "step4-test-batch" },
      update: {},
      create: {
        key: "step4-test-batch",
        name: "Synthetic Batch",
        providerType: "PROPERTY_DATA",
      },
    });
    const manual = await db.leadSource.upsert({
      where: { key: "propwire" },
      update: {},
      create: {
        key: "propwire",
        name: "PropWire",
        providerType: "PROPERTY_DATA",
      },
    });
    const campaign = await db.campaign.create({
      data: {
        customerId: customer.id,
        name: "Synthetic only",
        industry: "roofing",
        status: "RUNNING",
        desiredLeadCount: 10,
        residential: true,
        commercial: false,
        territories: { create: { type: "ZIP", value: "78704" } },
      },
    });
    const p = {
      address1: "101 Synthetic Test St",
      city: "Austin",
      state: "TX",
      postalCode: "78704",
      propertyType: "RESIDENTIAL",
    };
    const makeJob = (provider = "BATCHDATA") =>
      db.providerJob.create({
        data: {
          campaignId: campaign.id,
          leadSourceId: provider === "PROPWIRE" ? manual.id : source.id,
          provider,
          jobType:
            provider === "PROPWIRE" ? "SOURCE_LEADS_MANUAL" : "SOURCE_LEADS",
        },
      });
    let calls = 0;
    const adapter: LeadSourceAdapter = {
      key: "BATCHDATA",
      normalize: (r) => propertyRecordSchema.parse(r),
      fetchPage: async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 100));
        return {
          records: [p, p, { ...p, postalCode: "10001" }],
          nextCursor: null,
        };
      },
    };
    try {
      const job = await makeJob();
      await Promise.all([
        executeSourceJob(job.id, adapter),
        executeSourceJob(job.id, adapter),
      ]);
      assert.equal(calls, 1);
      assert.equal(
        (await executeSourceJob(job.id, adapter)).status,
        "SUCCEEDED",
      );
      assert.equal(calls, 1);
      assert.equal(
        await db.lead.count({ where: { customerId: customer.id } }),
        1,
      );
      assert.equal(
        await db.campaignLead.count({ where: { campaignId: campaign.id } }),
        1,
      );
      const lead = await db.lead.findFirstOrThrow({
        where: { customerId: customer.id },
      });
      await db.lead.update({
        where: { id: lead.id },
        data: { status: "SUPPRESSED" },
      });
      await db.suppression.create({
        data: {
          leadId: lead.id,
          customerId: customer.id,
          scope: "CUSTOMER",
          reason: "DNC",
        },
      });
      const mj = await makeJob("PROPWIRE");
      assert.equal((await executeSourceJob(mj.id)).status, "WAITING_MANUAL");
      const page = await importManualPage(mj.id, "export-0001", [p], true);
      assert.deepEqual(
        await importManualPage(mj.id, "export-0001", [p], true),
        page,
      );
      await assert.rejects(
        importManualPage(
          mj.id,
          "export-0001",
          [{ ...p, address1: "different" }],
          true,
        ),
        /IDEMPOTENCY_KEY_CONFLICT/,
      );
      assert.equal(
        (await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).status,
        "SUPPRESSED",
      );
      assert.equal(
        await db.lead.count({ where: { customerId: customer.id } }),
        1,
      );
      const secondCampaign = await db.campaign.create({
        data: {
          customerId: customer.id,
          name: "Same property, same lineage",
          industry: "roofing",
          status: "RUNNING",
          desiredLeadCount: 1,
          territories: { create: { type: "ZIP", value: "78704" } },
        },
      });
      const secondJob = await db.providerJob.create({
        data: {
          campaignId: secondCampaign.id,
          leadSourceId: manual.id,
          provider: "PROPWIRE",
          jobType: "SOURCE_LEADS_MANUAL",
        },
      });
      await importManualPage(secondJob.id, "lineage-page-001", [p], true);
      assert.equal(
        (
          await db.campaignLead.findFirstOrThrow({
            where: { campaignId: secondCampaign.id },
          })
        ).leadId,
        lead.id,
      );
      const paging = await makeJob();
      const paged: LeadSourceAdapter = {
        ...adapter,
        fetchPage: async (_c, cursor) => ({
          records: [],
          nextCursor:
            cursor.pages === 0 ? { territory: 0, skip: 100, pages: 1 } : null,
        }),
      };
      assert.equal((await executeSourceJob(paging.id, paged)).status, "QUEUED");
      assert.equal(
        (await executeSourceJob(paging.id, paged)).status,
        "SUCCEEDED",
      );
      assert.equal(
        await db.sourceReceipt.count({ where: { jobId: paging.id } }),
        2,
      );
      const paused = await makeJob();
      await db.campaign.update({
        where: { id: campaign.id },
        data: { status: "PAUSED" },
      });
      assert.equal(
        (await executeSourceJob(paused.id, adapter)).status,
        "BLOCKED",
      );
      await db.campaign.update({
        where: { id: campaign.id },
        data: { status: "RUNNING" },
      });
      const failJob = await makeJob();
      const failing: LeadSourceAdapter = {
        ...adapter,
        fetchPage: async () => {
          throw new SourceError("PROVIDER_HTTP_429", "retry", 120);
        },
      };
      assert.equal(
        (await executeSourceJob(failJob.id, failing)).status,
        "QUEUED",
      );
      const retry = await db.providerJob.findUniqueOrThrow({
        where: { id: failJob.id },
      });
      assert.ok(
        retry.nextAttemptAt && retry.nextAttemptAt.getTime() > Date.now(),
      );
      assert.equal(
        (await executeSourceJob(failJob.id, adapter)).attemptCount,
        1,
      );
      await db.providerJob.update({
        where: { id: failJob.id },
        data: { attemptCount: 4, nextAttemptAt: new Date(0) },
      });
      assert.equal(
        (await executeSourceJob(failJob.id, failing)).status,
        "FAILED",
      );
      await retrySourceJob(failJob.id);
      assert.equal(
        (await executeSourceJob(failJob.id, adapter)).status,
        "SUCCEEDED",
      );
      const lease = await makeJob();
      await db.providerJob.update({
        where: { id: lease.id },
        data: {
          status: "RUNNING",
          leaseToken: randomUUID(),
          leaseExpiresAt: new Date(0),
          attemptCount: 1,
        },
      });
      assert.equal(
        (await executeSourceJob(lease.id, adapter)).status,
        "SUCCEEDED",
      );
      const unsupported = await makeJob("PHANTOMBUSTER");
      assert.equal((await executeSourceJob(unsupported.id)).status, "BLOCKED");
      const fallback = await manualFallback(unsupported.id);
      assert.deepEqual(await manualFallback(unsupported.id), fallback);
      assert.equal(fallback.campaignId, campaign.id);
      const parent = await db.providerJob.create({
        data: {
          campaignId: campaign.id,
          provider: "APS_ORCHESTRATOR",
          jobType: "FIND_LEADS",
        },
      });
      delete process.env.BATCHDATA_API_KEY;
      delete process.env.PHANTOMBUSTER_API_KEY;
      await Promise.all([
        dispatchLeadSourceJob(parent.id),
        dispatchLeadSourceJob(parent.id),
      ]);
      assert.equal(
        await db.providerJob.count({
          where: { idempotencyKey: `source:${parent.id}:PROPWIRE` },
        }),
        1,
      );
      const fenced = await makeJob();
      const thief: LeadSourceAdapter = {
        ...adapter,
        fetchPage: async () => {
          await db.providerJob.update({
            where: { id: fenced.id },
            data: { leaseToken: randomUUID() },
          });
          return {
            records: [{ ...p, address1: "Fenced record" }],
            nextCursor: null,
          };
        },
      };
      await executeSourceJob(fenced.id, thief);
      assert.equal(
        await db.sourceReceipt.count({ where: { jobId: fenced.id } }),
        0,
      );
      assert.equal(
        await db.lead.count({ where: { customerId: customer.id } }),
        1,
      );
      assert.equal(
        await db.message.count({
          where: { conversation: { campaignId: campaign.id } },
        }),
        0,
      );
      assert.equal(
        await db.conversation.count({ where: { campaignId: campaign.id } }),
        0,
      );
      assert.equal(
        await db.consent.count({
          where: { contact: { lead: { customerId: customer.id } } },
        }),
        0,
      );
      assert.ok(
        await db.auditEvent.count({
          where: {
            campaignId: campaign.id,
            leadId: lead.id,
            eventType: "lead_source.lead_ingested",
          },
        }),
      );
    } finally {
      await db.$disconnect();
    }
  },
);
